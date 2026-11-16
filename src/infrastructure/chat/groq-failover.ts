import { createHash } from "node:crypto";
import { APICallError } from "ai";
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
} from "@ai-sdk/provider";
import type { ChatRuntime } from "./runtime";
import type { GroqConfig } from "./groq-model";

type Circuit = { until: number; version: number; probe: boolean };
const circuits = new WeakMap<typeof fetch, Map<string, Circuit>>();
type Timing = { primaryTimeoutMs?: number; fallbackTimeoutMs?: number };

function eligible(error: unknown): boolean {
  if (APICallError.isInstance(error))
    return (
      error.statusCode === 429 ||
      error.statusCode === undefined ||
      error.statusCode >= 500
    );
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "TypeError")
  );
}
function retryMs(error: unknown, floor: number): number {
  const value = APICallError.isInstance(error)
    ? Number(error.responseHeaders?.["retry-after"])
    : NaN;
  return Number.isFinite(value) && value > 0
    ? Math.max(floor, value * 1000)
    : floor;
}
function circuitDuration(error: unknown): number {
  const quotaWindow = APICallError.isInstance(error)
    ? error.responseHeaders?.["x-aurelle-quota-window"]
    : undefined;
  const floor =
    APICallError.isInstance(error) &&
    error.statusCode === 429 &&
    quotaWindow !== "minute"
      ? 600_000
      : 60_000;
  return retryMs(error, floor);
}
async function attempt(
  model: LanguageModelV4,
  params: LanguageModelV4CallOptions,
  ms: number,
  fallback: boolean,
): Promise<LanguageModelV4GenerateResult> {
  params.abortSignal?.throwIfAborted();
  const timeout = new AbortController();
  const signal = params.abortSignal
    ? AbortSignal.any([params.abortSignal, timeout.signal])
    : timeout.signal;
  let abort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  const timer = setTimeout(
    () =>
      timeout.abort(
        new DOMException("Model attempt timed out", "TimeoutError"),
      ),
    ms,
  );
  try {
    return await Promise.race([
      model.doGenerate({
        ...params,
        abortSignal: signal,
        ...(fallback
          ? {
              providerOptions: {
                ...params.providerOptions,
                groq: {
                  ...params.providerOptions?.groq,
                  reasoningEffort: "none",
                  include_reasoning: false,
                  parallel_tool_calls: false,
                },
              },
            }
          : {}),
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export function makeGroqFailover(
  primary: ChatRuntime,
  alternative: ChatRuntime,
  config: GroqConfig,
  transport: typeof fetch,
  now: () => number,
  timing?: Timing,
): ChatRuntime {
  const fallbackId = config.fallback!.modelId;
  let entries = circuits.get(transport);
  if (!entries) {
    entries = new Map();
    circuits.set(transport, entries);
  }
  const profile = createHash("sha256")
    .update(config.apiKey ?? "")
    .digest("hex");
  const key = JSON.stringify([
    config.baseURL.replace(/\/+$/, ""),
    config.modelId,
    config.balancer,
    profile,
  ]);
  let state = entries.get(key);
  if (!state) {
    state = { until: 0, version: 0, probe: false };
    entries.set(key, state);
  }
  const circuit = state;
  const first = primary.model as LanguageModelV4,
    second = alternative.model as LanguageModelV4;
  let listener: ((modelId: string) => void) | undefined;
  let selected = config.modelId;
  const notify = (modelId: string) => {
    if (selected !== modelId) {
      selected = modelId;
      try {
        listener?.(modelId);
      } catch {
        /* UI progress is optional. */
      }
    }
    console.info("[GROQ] model route", JSON.stringify({ modelId }));
  };
  const model: LanguageModelV4 = {
    specificationVersion: "v4",
    provider: first.provider,
    modelId: first.modelId,
    supportedUrls: first.supportedUrls,
    async doGenerate(params) {
      params.abortSignal?.throwIfAborted();
      let useFallback = circuit.probe || circuit.until > now();
      let probe = false;
      if (!useFallback && circuit.until > 0) {
        circuit.probe = true;
        probe = true;
      }
      const version = circuit.version;
      if (!useFallback) {
        notify(config.modelId);
        try {
          const result = await attempt(
            first,
            params,
            timing?.primaryTimeoutMs ?? 10_000,
            false,
          );
          if (circuit.version === version) {
            circuit.until = 0;
            if (probe) circuit.probe = false;
          }
          return result;
        } catch (error) {
          if (params.abortSignal?.aborted) {
            if (probe && circuit.version === version) circuit.probe = false;
            throw params.abortSignal.reason;
          }
          if (!eligible(error)) {
            if (probe && circuit.version === version) circuit.probe = false;
            throw error;
          }
          circuit.version++;
          circuit.until = Math.max(
            circuit.until,
            now() + circuitDuration(error),
          );
          circuit.probe = false;
          useFallback = true;
        }
      }
      if (useFallback) {
        params.abortSignal?.throwIfAborted();
        notify(fallbackId);
        try {
          return await attempt(
            second,
            params,
            timing?.fallbackTimeoutMs ?? 15_000,
            true,
          );
        } catch (error) {
          if (params.abortSignal?.aborted) throw params.abortSignal.reason;
          if (
            !eligible(error) ||
            (APICallError.isInstance(error) && error.statusCode === 429)
          )
            throw error;
          throw new APICallError({
            message: "The model provider is temporarily unavailable.",
            url: config.baseURL,
            requestBodyValues: {},
            statusCode: 429,
            responseHeaders: {
              "retry-after": "60",
              "x-aurelle-error-code": "provider-unavailable",
            },
            isRetryable: false,
          });
        }
      }
      throw new Error("No model route available.");
    },
    doStream: (params) => first.doStream(params),
  };
  return {
    ...primary,
    model,
    takeUsage: () => [
      ...(primary.takeUsage?.() ?? []),
      ...(alternative.takeUsage?.() ?? []),
    ],
    setWaitListener: (fn) => {
      primary.setWaitListener?.(fn);
      alternative.setWaitListener?.(fn);
    },
    setSwitchListener: (fn) => {
      listener = fn;
    },
  };
}
