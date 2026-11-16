import { test } from "node:test";
import assert from "node:assert/strict";
import { APICallError, generateText, tool } from "ai";
import { z } from "zod";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";

const config = {
  baseURL: "https://fixture.invalid/v1",
  modelId: "primary-model",
  apiKey: "primary-fixture",
  balancer: false,
  windowsTransport: false,
  fallback: { modelId: "fallback-model", apiKey: "fallback-fixture" },
};
const completion = (model: string, toolCall = false) =>
  Response.json({
    id: "test",
    model,
    created: 0,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: toolCall
          ? {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "finish", arguments: "{}" },
                },
              ],
            }
          : { role: "assistant", content: "Ready." },
        finish_reason: toolCall ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
  });
const limited = (window: "day" | "minute", seconds: number) =>
  Response.json(
    {
      error: {
        message: `tokens per ${window}: Limit 1000, Used 900, Requested 200`,
      },
    },
    { status: 429, headers: { "retry-after": String(seconds) } },
  );
const run = (
  runtime: ReturnType<typeof createGroqRuntime>,
  signal?: AbortSignal,
) =>
  generateText({
    model: runtime.model,
    prompt: "test",
    maxOutputTokens: runtime.maxOutputTokens,
    providerOptions: runtime.providerOptions,
    maxRetries: 0,
    abortSignal: signal,
  });
const body = (init?: RequestInit) => JSON.parse(String(init?.body));

test("daily 429 falls back once and stays open across runtimes until a single half-open probe", async () => {
  let time = 1000,
    primaryCalls = 0,
    fallbackCalls = 0;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const probeStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher: typeof fetch = async (_input, init) => {
    const request = body(init);
    if (request.model === config.modelId) {
      primaryCalls++;
      if (primaryCalls === 1) return limited("day", 479);
      started();
      await gate;
      return completion(request.model);
    }
    fallbackCalls++;
    assert.equal(request.model, config.fallback.modelId);
    assert.equal(request.reasoning_effort, "none");
    assert.equal(request.include_reasoning, false);
    assert.equal(request.parallel_tool_calls, false);
    return completion(request.model);
  };
  const create = () => createGroqRuntime(config, fetcher, () => time);
  const switches: string[] = [];
  const first = create();
  first.setSwitchListener?.((id) => switches.push(id));
  assert.equal((await run(first)).text, "Ready.");
  assert.deepEqual(switches, [config.fallback.modelId]);
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);
  time += 479_000;
  await run(create());
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 2);
  time += 120_999;
  await run(create());
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 3);
  time += 1;
  const probe = run(create());
  await probeStarted;
  await run(create());
  assert.equal(primaryCalls, 2);
  assert.equal(fallbackCalls, 4);
  release();
  await probe;
  await run(create());
  assert.equal(primaryCalls, 3);
});

test("a stale successful primary call cannot close a circuit opened by a later 429", async () => {
  let time = 1000,
    calls = 0,
    fallbackCalls = 0;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher: typeof fetch = async (_input, init) => {
    const request = body(init);
    if (request.model !== config.modelId) {
      fallbackCalls++;
      return completion(request.model);
    }
    calls++;
    if (calls === 1) {
      started();
      await gate;
      return completion(request.model);
    }
    return limited("day", 600);
  };
  const create = () => createGroqRuntime(config, fetcher, () => time);
  const earlier = run(create());
  await startedPromise;
  await run(create());
  release();
  await earlier;
  await run(create());
  assert.equal(calls, 2);
  assert.equal(fallbackCalls, 2);
});

test("minute 429 waits at least one minute before probing", async () => {
  let time = 1000,
    primaryCalls = 0,
    fallbackCalls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    const request = body(init);
    if (request.model === config.modelId) {
      primaryCalls++;
      return primaryCalls === 1
        ? limited("minute", 12)
        : completion(request.model);
    }
    fallbackCalls++;
    return completion(request.model);
  };
  const create = () => createGroqRuntime(config, fetcher, () => time);
  await run(create());
  time += 59_999;
  await run(create());
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 2);
  time += 1;
  await run(create());
  assert.equal(primaryCalls, 2);
});

test("daily Retry-After longer than ten minutes is never shortened", async () => {
  let time = 1000,
    primaryCalls = 0,
    fallbackCalls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    const request = body(init);
    if (request.model === config.modelId) {
      primaryCalls++;
      return primaryCalls === 1
        ? limited("day", 1800)
        : completion(request.model);
    }
    fallbackCalls++;
    return completion(request.model);
  };
  const create = () => createGroqRuntime(config, fetcher, () => time);
  await run(create());
  time += 600_000;
  await run(create());
  assert.equal(primaryCalls, 1);
  time += 1_199_999;
  await run(create());
  assert.equal(primaryCalls, 1);
  time += 1;
  await run(create());
  assert.equal(primaryCalls, 2);
  assert.equal(fallbackCalls, 3);
});

test("5xx and per-attempt timeout switch once; global cancellation does not switch", async () => {
  for (const failure of ["server", "timeout"] as const) {
    let primaryCalls = 0,
      fallbackCalls = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      const request = body(init);
      if (request.model !== config.modelId) {
        fallbackCalls++;
        return completion(request.model);
      }
      primaryCalls++;
      if (failure === "server")
        return Response.json(
          { error: { message: "unavailable" } },
          { status: 503 },
        );
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        ),
      );
    };
    const runtime = createGroqRuntime(config, fetcher, Date.now, undefined, {
      primaryTimeoutMs: 15,
      fallbackTimeoutMs: 1000,
    });
    assert.equal((await run(runtime)).text, "Ready.");
    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);
  }
  let fallbackCalls = 0,
    started!: () => void;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher: typeof fetch = async (_input, init) => {
    const request = body(init);
    if (request.model !== config.modelId) {
      fallbackCalls++;
      return completion(request.model);
    }
    started();
    return new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        { once: true },
      ),
    );
  };
  const runtime = createGroqRuntime(config, fetcher);
  const controller = new AbortController();
  const pending = run(runtime, controller.signal);
  await start;
  controller.abort();
  await assert.rejects(pending);
  assert.equal(fallbackCalls, 0);
});

test("both unavailable return a clean 429 and replay only one model inference", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = body(init);
    calls.push(request.model);
    return limited("minute", 30);
  };
  await assert.rejects(
    run(createGroqRuntime(config, fetcher)),
    (error: unknown) =>
      APICallError.isInstance(error) &&
      error.statusCode === 429 &&
      !error.message.includes("fixture"),
  );
  assert.deepEqual(calls, [config.modelId, config.fallback.modelId]);
});

test("fallback server failure returns a safe temporary-unavailable countdown", async () => {
  const fetcher: typeof fetch = async (_input, init) => {
    const request = body(init);
    return request.model === config.modelId
      ? limited("day", 600)
      : Response.json(
          { error: { message: "private upstream details" } },
          { status: 503 },
        );
  };
  await assert.rejects(
    run(createGroqRuntime(config, fetcher)),
    (error: unknown) => {
      assert.ok(APICallError.isInstance(error));
      assert.equal(error.statusCode, 429);
      assert.equal(error.responseHeaders?.["retry-after"], "60");
      assert.equal(
        error.responseHeaders?.["x-aurelle-error-code"],
        "provider-unavailable",
      );
      assert.doesNotMatch(error.message, /private/);
      return true;
    },
  );
});

test("fallback returns native tool calls and captures billed usage without executing tools", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = body(init);
    calls.push(request.model);
    return request.model === config.modelId
      ? limited("day", 600)
      : completion(request.model, true);
  };
  const runtime = createGroqRuntime(config, fetcher);
  const result = await generateText({
    model: runtime.model,
    prompt: "test",
    maxOutputTokens: runtime.maxOutputTokens,
    providerOptions: runtime.providerOptions,
    maxRetries: 0,
    tools: { finish: tool({ inputSchema: z.object({}) }) },
    toolChoice: "required",
  });
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].toolName, "finish");
  assert.deepEqual(calls, [config.modelId, config.fallback.modelId]);
  assert.deepEqual(runtime.takeUsage?.(), [
    { inputTokens: 50, outputTokens: 5, cachedInputTokens: 0 },
  ]);
  assert.deepEqual(runtime.takeUsage?.(), []);
});

test("known primary capacity switches immediately and fallback capacity is bounded", async () => {
  let time = 1000;
  const calls: string[] = [],
    waits: number[] = [],
    switched: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = body(init);
    calls.push(request.model);
    const response = completion(request.model);
    response.headers.set("x-ratelimit-limit-tokens", "2000");
    response.headers.set("x-ratelimit-remaining-tokens", "1");
    response.headers.set("x-ratelimit-reset-tokens", "30s");
    return response;
  };
  const wait = async (ms: number) => {
    waits.push(ms);
    time += ms;
  };
  const runtime = createGroqRuntime(config, fetcher, () => time, wait);
  runtime.setSwitchListener?.((modelId) => switched.push(modelId));
  await run(runtime);
  await run(runtime);
  await assert.rejects(
    run(runtime),
    (error: unknown) =>
      APICallError.isInstance(error) &&
      error.statusCode === 429 &&
      error.responseHeaders?.["x-aurelle-quota-window"] === "minute" &&
      error.responseHeaders?.["x-aurelle-quota-estimated"] === "1",
  );
  assert.deepEqual(calls, [config.modelId, config.fallback.modelId]);
  assert.deepEqual(waits, []);
  assert.deepEqual(switched, [config.fallback.modelId]);
  time += 59_999;
  await run(runtime);
  assert.deepEqual(calls, [
    config.modelId,
    config.fallback.modelId,
    config.fallback.modelId,
  ]);
  time += 1;
  await run(runtime);
  assert.deepEqual(calls, [
    config.modelId,
    config.fallback.modelId,
    config.fallback.modelId,
    config.modelId,
  ]);
  assert.deepEqual(runtime.takeUsage?.(), [
    { inputTokens: 50, outputTokens: 5, cachedInputTokens: 0 },
    { inputTokens: 50, outputTokens: 5, cachedInputTokens: 0 },
    { inputTokens: 50, outputTokens: 5, cachedInputTokens: 0 },
    { inputTokens: 50, outputTokens: 5, cachedInputTokens: 0 },
  ]);
});

test("fallback may wait more than three seconds and up to ten seconds for known capacity", async () => {
  let time = 1000;
  const waits: number[] = [],
    calls: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = body(init);
    calls.push(request.model);
    if (request.model === config.modelId) return limited("day", 600);
    const response = completion(request.model);
    response.headers.set("x-ratelimit-limit-tokens", "2000");
    response.headers.set("x-ratelimit-remaining-tokens", "400");
    response.headers.set("x-ratelimit-reset-tokens", "8s");
    return response;
  };
  const runtime = createGroqRuntime(
    config,
    fetcher,
    () => time,
    async (ms) => {
      waits.push(ms);
      time += ms;
    },
  );
  await run(runtime);
  await run(runtime);
  assert.deepEqual(calls, [
    config.modelId,
    config.fallback.modelId,
    config.fallback.modelId,
  ]);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 3000 && waits[0] <= 10_000);
});
