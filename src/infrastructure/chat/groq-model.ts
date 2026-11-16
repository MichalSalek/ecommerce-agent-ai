import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ChatRuntime, ModelUsage } from "./runtime";
import { windowsFetch } from "./windows-fetch";
import { createHash } from "node:crypto";
import { makeGroqFailover } from "./groq-failover";
export interface GroqConfig {
  baseURL: string;
  modelId: string;
  apiKey?: string;
  balancer: boolean;
  windowsTransport: boolean;
  fallback?: { modelId: string; apiKey: string };
}
// Runtime objects are created per request. Share only by underlying transport and
// endpoint/model identity, without retaining credentials in the cooldown key.
type Cooldown = { deadline: number; diagnostic?: QuotaDiagnostic };
const cooldowns = new WeakMap<typeof fetch, Map<string, Cooldown>>();
type TokenBucket = {
  limit: number;
  remaining: number;
  refillPerMs: number;
  updatedAt: number;
  inFlight: number;
};
const tokenBuckets = new WeakMap<typeof fetch, Map<string, TokenBucket>>();
const learnedMinuteLimits = new WeakMap<typeof fetch, Map<string, number>>();
type Waiter = (
  milliseconds: number,
  signal?: AbortSignal | null,
) => Promise<void>;

const waitForTokens: Waiter = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });

function resetDuration(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = value
    .trim()
    .match(
      /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/,
    );
  if (!match || !match.slice(1).some(Boolean)) return undefined;
  const ms =
    Number(match[1] ?? 0) * 3_600_000 +
    Number(match[2] ?? 0) * 60_000 +
    Number(match[3] ?? 0) * 1000 +
    Number(match[4] ?? 0);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function estimatedTokens(
  body: BodyInit | null | undefined,
): number | undefined {
  if (typeof body !== "string") return undefined;
  try {
    const parsed = JSON.parse(body);
    if (
      !Array.isArray(parsed.messages) ||
      !Number.isFinite(parsed.max_tokens) ||
      parsed.max_tokens < 0
    )
      return undefined;
    const prompt = JSON.stringify({
      messages: parsed.messages,
      tools: parsed.tools ?? [],
      tool_choice: parsed.tool_choice,
    });
    return (
      Math.ceil(new TextEncoder().encode(prompt).length / 4) +
      Math.ceil(parsed.max_tokens)
    );
  } catch {
    return undefined;
  }
}

function isNonStreamRequest(body: BodyInit | null | undefined): boolean {
  if (typeof body !== "string") return false;
  try {
    const request: unknown = JSON.parse(body);
    return (
      !!request &&
      typeof request === "object" &&
      !("stream" in request && request.stream === true)
    );
  } catch {
    return false;
  }
}

function refill(bucket: TokenBucket, now: number) {
  bucket.remaining = Math.min(
    bucket.limit,
    bucket.remaining + Math.max(0, now - bucket.updatedAt) * bucket.refillPerMs,
  );
  bucket.updatedAt = Math.max(bucket.updatedAt, now);
}

function readTokenQuota(
  headers: Headers,
  now: number,
): TokenBucket | undefined {
  const limitText = headers.get("x-ratelimit-limit-tokens");
  const remainingText = headers.get("x-ratelimit-remaining-tokens");
  const duration = resetDuration(headers.get("x-ratelimit-reset-tokens"));
  if (
    !limitText ||
    !remainingText ||
    !/^\d+$/.test(limitText) ||
    !/^\d+$/.test(remainingText) ||
    !duration
  )
    return undefined;
  const limit = Number(limitText),
    remaining = Number(remainingText);
  if (
    !Number.isSafeInteger(limit) ||
    !Number.isSafeInteger(remaining) ||
    limit <= 0 ||
    remaining < 0 ||
    remaining >= limit
  )
    return undefined;
  return {
    limit,
    remaining,
    refillPerMs: (limit - remaining) / duration,
    updatedAt: now,
    inFlight: 0,
  };
}

function retryDeadline(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const text = value.trim();
  let deadline: number;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    const seconds = Number(text);
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
    deadline = now + seconds * 1000;
  } else {
    if (
      !/^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/.test(
        text,
      )
    )
      return undefined;
    deadline = Date.parse(text);
  }
  return Number.isFinite(deadline) && deadline > now ? deadline : undefined;
}

function rateLimitResponse(
  seconds?: number,
  upstream?: Headers,
  diagnostic?: QuotaDiagnostic,
): Response {
  return Response.json(
    { error: { message: "The model provider is temporarily rate limited." } },
    {
      status: 429,
      headers: {
        ...Object.fromEntries(
          [...(upstream ?? new Headers())].filter(([name]) =>
            /^(?:x-ratelimit-|ratelimit-)/i.test(name),
          ),
        ),
        "cache-control": "no-store",
        ...(seconds === undefined ? {} : { "retry-after": String(seconds) }),
        ...(diagnostic
          ? {
              "x-aurelle-quota-metric": diagnostic.metric,
              "x-aurelle-quota-window": diagnostic.window,
              "x-aurelle-quota-limit": String(diagnostic.limit),
              "x-aurelle-quota-used": String(diagnostic.used),
              "x-aurelle-quota-requested": String(diagnostic.requested),
            }
          : {}),
      },
    },
  );
}

type QuotaDiagnostic = {
  metric: "tokens" | "requests";
  window: "day" | "minute";
  limit: number;
  used: number;
  requested: number;
};

async function quotaDiagnostic(
  response: Response,
): Promise<QuotaDiagnostic | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const error =
      body && typeof body === "object" && "error" in body
        ? body.error
        : undefined;
    const message =
      error && typeof error === "object" && "message" in error
        ? error.message
        : undefined;
    if (typeof message !== "string") return undefined;
    const metrics = [
      ...message.matchAll(/\b(tokens|requests)\s+per\s+(day|minute)\b/gi),
    ];
    if (metrics.length !== 1) return undefined;
    const numeric = (field: string) => {
      const matches = [
        ...message.matchAll(
          new RegExp(
            `\\b${field}\\s*:?\\s*(\\d{1,3}(?:,\\d{3})+|\\d+)(?!\\d|[.,]\\d)`,
            "gi",
          ),
        ),
      ];
      if (matches.length !== 1) return undefined;
      const value = Number(matches[0][1].replaceAll(",", ""));
      return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    };
    const limit = numeric("limit"),
      used = numeric("used"),
      requested = numeric("requested");
    if (limit === undefined || used === undefined || requested === undefined)
      return undefined;
    return {
      metric: metrics[0][1].toLowerCase() as QuotaDiagnostic["metric"],
      window: metrics[0][2].toLowerCase() as QuotaDiagnostic["window"],
      limit,
      used,
      requested,
    };
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

export function createGroqRuntime(
  config: GroqConfig,
  fetchImplementation: typeof fetch = config.windowsTransport
    ? windowsFetch
    : fetch,
  now: () => number = Date.now,
  wait: Waiter = waitForTokens,
  options?: {
    quotaWaitMaxMs?: number;
    primaryTimeoutMs?: number;
    fallbackTimeoutMs?: number;
  },
): ChatRuntime {
  if (!config.balancer && !config.apiKey)
    throw new Error("GROQ_API_KEY is required for direct Groq access.");
  if (config.fallback) {
    const { fallback, ...primaryConfig } = config;
    const primary = createGroqRuntime(
      primaryConfig,
      fetchImplementation,
      now,
      wait,
      { quotaWaitMaxMs: 0 },
    );
    const alternative = createGroqRuntime(
      { ...primaryConfig, modelId: fallback.modelId, apiKey: fallback.apiKey },
      fetchImplementation,
      now,
      wait,
      { quotaWaitMaxMs: 10_000 },
    );
    return makeGroqFailover(
      primary,
      alternative,
      config,
      fetchImplementation,
      now,
      options,
    );
  }
  const capturedUsage: ModelUsage[] = [];
  let waitListener: ((milliseconds: number) => void) | undefined;
  let transportCooldowns = cooldowns.get(fetchImplementation);
  if (!transportCooldowns) {
    transportCooldowns = new Map();
    cooldowns.set(fetchImplementation, transportCooldowns);
  }
  const deadlines = transportCooldowns;
  let transportBuckets = tokenBuckets.get(fetchImplementation);
  if (!transportBuckets) {
    transportBuckets = new Map();
    tokenBuckets.set(fetchImplementation, transportBuckets);
  }
  const buckets = transportBuckets;
  let transportLimits = learnedMinuteLimits.get(fetchImplementation);
  if (!transportLimits) {
    transportLimits = new Map();
    learnedMinuteLimits.set(fetchImplementation, transportLimits);
  }
  const limits = transportLimits;
  const key = JSON.stringify([
    config.baseURL.replace(/\/+$/, ""),
    config.modelId,
    config.balancer,
    createHash("sha256")
      .update(config.apiKey ?? "")
      .digest("hex"),
  ]);
  const transport: typeof fetch = async (input, init) => {
    const attemptSignal = AbortSignal.timeout(15_000);
    init = {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, attemptSignal])
        : attemptSignal,
    };
    init?.signal?.throwIfAborted();
    const cooldown = deadlines.get(key);
    const remaining = (cooldown?.deadline ?? 0) - now();
    if (remaining > 0) {
      console.info("[GROQ] provider cooldown: upstream Retry-After");
      return rateLimitResponse(
        Math.ceil(remaining / 1000),
        undefined,
        cooldown?.diagnostic,
      );
    }
    deadlines.delete(key);
    const estimate = estimatedTokens(init?.body);
    let reserved: TokenBucket | undefined;
    let waited = 0;
    while (estimate !== undefined) {
      init?.signal?.throwIfAborted();
      const bucket = buckets.get(key);
      if (!bucket) break;
      refill(bucket, now());
      const needed = Math.min(estimate, bucket.limit);
      if (bucket.remaining >= needed) {
        bucket.remaining -= needed;
        bucket.inFlight++;
        reserved = bucket;
        break;
      }
      const delay = Math.ceil((needed - bucket.remaining) / bucket.refillPerMs);
      if (
        waited + delay > (options?.quotaWaitMaxMs ?? 10_000)
      ) {
        return Response.json(
          {
            error: {
              message: "The model provider is temporarily rate limited.",
            },
          },
          {
            status: 429,
            headers: {
              "retry-after": String(Math.ceil(delay / 1000)),
              "x-aurelle-local-capacity": "1",
              "x-aurelle-quota-metric": "tokens",
              "x-aurelle-quota-window": "minute",
              "x-aurelle-quota-limit": String(bucket.limit),
              "x-aurelle-quota-requested": String(estimate),
              "x-aurelle-quota-estimated": "1",
            },
          },
        );
      }
      console.info(
        "[GROQ] waiting for reported token quota",
        JSON.stringify({ milliseconds: delay }),
      );
      init?.signal?.throwIfAborted();
      try {
        waitListener?.(delay);
      } catch {
        /* Progress reporting must not break transport. */
      }
      await wait(delay, init?.signal);
      waited += delay;
    }
    init?.signal?.throwIfAborted();
    const cooldownAfterWait = deadlines.get(key);
    const cooldownRemaining = (cooldownAfterWait?.deadline ?? 0) - now();
    if (cooldownRemaining > 0) {
      if (reserved) reserved.inFlight--;
      return rateLimitResponse(
        Math.ceil(cooldownRemaining / 1000),
        undefined,
        cooldownAfterWait?.diagnostic,
      );
    }
    // Background traffic preserves the balancer's dictation reservation; never use its cleanup route.
    const url = String(input).replace(
      /\/chat\/completions$/,
      config.balancer ? "/background/chat/completions" : "/chat/completions",
    );
    let response: Response;
    try {
      response = await fetchImplementation(url, init);
    } finally {
      if (reserved) reserved.inFlight--;
    }
    if (response.ok) {
      const quota = readTokenQuota(response.headers, now());
      if (quota) {
        const current = buckets.get(key);
        const learned = limits.get(key);
        if (learned !== undefined) {
          const consumed = quota.limit - quota.remaining;
          quota.limit = Math.min(quota.limit, learned);
          quota.remaining = Math.max(0, quota.limit - consumed);
          quota.refillPerMs = Math.min(quota.refillPerMs, learned / 60_000);
        }
        if (current) {
          if (current.inFlight > 0 || learned !== undefined) {
            refill(current, now());
            quota.remaining = Math.min(quota.remaining, current.remaining);
          }
          Object.assign(current, quota, { inFlight: current.inFlight });
        } else buckets.set(key, quota);
      }
      // Cloning leaves the response untouched for the SDK, including when its
      // subsequent tool-choice validation rejects an otherwise billed response.
      if (
        isNonStreamRequest(init?.body) &&
        /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        try {
          const body: unknown = await response.clone().json();
          const usage =
            body && typeof body === "object" && "usage" in body
              ? body.usage
              : undefined;
          if (
            usage &&
            typeof usage === "object" &&
            "prompt_tokens" in usage &&
            "completion_tokens" in usage
          ) {
            const details =
              "prompt_tokens_details" in usage
                ? usage.prompt_tokens_details
                : undefined;
            const cached =
              details == null
                ? 0
                : typeof details === "object"
                  ? "cached_tokens" in details
                    ? details.cached_tokens
                    : 0
                  : undefined;
            const input = usage.prompt_tokens;
            const output = usage.completion_tokens;
            if (
              typeof input === "number" &&
              Number.isSafeInteger(input) &&
              input >= 0 &&
              typeof output === "number" &&
              Number.isSafeInteger(output) &&
              output >= 0 &&
              typeof cached === "number" &&
              Number.isSafeInteger(cached) &&
              cached >= 0 &&
              cached <= input
            ) {
              if (capturedUsage.length === 8) capturedUsage.shift();
              capturedUsage.push({
                inputTokens: input,
                outputTokens: output,
                cachedInputTokens: cached,
              });
            }
          }
        } catch {
          // Malformed or unreadable usage never changes the provider response.
        }
      }
    }
    if (response.status !== 429) return response;
    const upstreamHeaders = new Headers(response.headers);
    const current = now();
    const deadline = retryDeadline(
      response.headers.get("retry-after"),
      current,
    );
    let ownCooldown: Cooldown | undefined;
    if (deadline !== undefined) {
      const existing = deadlines.get(key);
      if (!existing || deadline >= existing.deadline) {
        ownCooldown = { deadline };
        deadlines.set(key, ownCooldown);
      }
      console.info("[GROQ] provider cooldown recorded: upstream Retry-After");
    }
    const diagnostic = await quotaDiagnostic(response);
    if (diagnostic) {
      if (
        diagnostic.metric === "tokens" &&
        diagnostic.window === "minute" &&
        diagnostic.limit > 0
      ) {
        const limit = Math.min(limits.get(key) ?? diagnostic.limit, diagnostic.limit);
        limits.set(key, limit);
        const current = buckets.get(key);
        const available = Math.max(0, limit - diagnostic.used);
        if (current) {
          refill(current, now());
          current.limit = Math.min(current.limit, limit);
          current.remaining = Math.min(current.remaining, available, current.limit);
          current.refillPerMs = Math.min(current.refillPerMs, limit / 60_000);
        } else {
          buckets.set(key, {
            limit,
            remaining: available,
            refillPerMs: limit / 60_000,
            updatedAt: now(),
            inFlight: 0,
          });
        }
      }
      if (ownCooldown && deadlines.get(key) === ownCooldown) {
        ownCooldown.diagnostic = diagnostic;
      }
      const retry = (deadlines.get(key)?.deadline ?? 0) - now();
      console.info("[GROQ] provider quota", {
        ...diagnostic,
        ...(retry > 0 ? { retryAfterSeconds: Math.ceil(retry / 1000) } : {}),
      });
    }
    await response.body?.cancel().catch(() => undefined);
    const existing = (deadlines.get(key)?.deadline ?? 0) - now();
    return rateLimitResponse(
      existing > 0 ? Math.ceil(existing / 1000) : undefined,
      upstreamHeaders,
      diagnostic,
    );
  };
  const provider = createOpenAICompatible({
    name: "groq",
    baseURL: config.baseURL,
    apiKey: config.apiKey ?? "not-needed",
    fetch: transport,
    headers: config.balancer
      ? {
          "X-Balancer-Client": "aurelle-demo",
          "X-Balancer-Purpose": "shopping-assistant",
        }
      : undefined,
  });
  return {
    model: provider(config.modelId),
    label: `Groq / ${config.modelId}`,
    providerOptions: {
      groq: {
        reasoningEffort: "low",
        include_reasoning: false,
        parallel_tool_calls: false,
      },
    },
    maxOutputTokens: 1024,
    currentRoute: () => ({ modelId: config.modelId, reason: "primary" }),
    takeUsage: () => capturedUsage.splice(0),
    setWaitListener: (listener) => {
      waitListener = listener;
    },
  };
}
