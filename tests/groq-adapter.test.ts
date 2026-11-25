import { test } from "node:test";
import assert from "node:assert/strict";
import { APICallError, generateText, tool, ToolChoiceViolationError } from "ai";
import { z } from "zod";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
test("Groq uses direct completion route with the expected request options", async () => {
  let called = false;
  const runtime = createGroqRuntime(
    {
      baseURL: "http://127.0.0.1:8787/v1",
      modelId: "openai/gpt-oss-120b",
      apiKey: "fixture-only",
    },
    async (input, init) => {
      called = true;
      assert.equal(
        String(input),
        "http://127.0.0.1:8787/v1/chat/completions",
      );
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("X-Balancer-Client"), null);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 1024);
      assert.equal(body.reasoning_effort, "low");
      assert.equal(body.include_reasoning, false);
      assert.equal(body.parallel_tool_calls, false);
      assert.equal(body.response_format, undefined);
      return Response.json({
        id: "test",
        model: body.model,
        created: 0,
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: '{"tool":"refuse","input":{}}',
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  );
  await generateText({
    model: runtime.model,
    prompt: "test",
    maxOutputTokens: runtime.maxOutputTokens,
    providerOptions: runtime.providerOptions,
  });
  assert.ok(called);
  assert.throws(
    () =>
      createGroqRuntime({
        baseURL: "https://api.groq.com/openai/v1",
        modelId: "test",
      }),
    /GROQ_API_KEY/,
  );
});

const config = {
  baseURL: "https://fixture.invalid/v1",
  modelId: "fixture-model",
  apiKey: "fixture-only",
};
const completion = () =>
  Response.json({
    id: "fixture",
    model: "fixture-model",
    created: 0,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Ready." },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
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
async function expectLimited(
  promise: ReturnType<typeof run>,
  retryAfter?: string,
  diagnostic?: {
    metric: string;
    window: string;
    limit: string;
    used: string;
    requested: string;
  },
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(APICallError.isInstance(error));
    assert.equal(error.statusCode, 429);
    assert.equal(error.responseHeaders?.["retry-after"], retryAfter);
    assert.doesNotMatch(error.message, /private fixture body/);
    if (diagnostic)
      for (const [key, value] of Object.entries(diagnostic))
        assert.equal(error.responseHeaders?.[`x-aurelle-quota-${key}`], value);
    assert.doesNotMatch(
      JSON.stringify(error.responseHeaders),
      /org-secret|model-secret|secret-prompt|fixture-only/,
    );
    return true;
  });
}

test("upstream Retry-After blocks recreated runtimes until expiry", async () => {
  let time = 1_800_000_000_000;
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return calls === 1
      ? Response.json(
          { error: { message: "private fixture body" } },
          { status: 429, headers: { "retry-after": "30" } },
        )
      : completion();
  };
  const create = () => createGroqRuntime(config, fetcher, () => time);
  await expectLimited(run(create()), "30");
  assert.equal(calls, 1);
  time += 1250;
  await expectLimited(run(create()), "29");
  assert.equal(calls, 1, "Cooldown must not call upstream");
  time += 28_749;
  await expectLimited(run(create()), "1");
  assert.equal(calls, 1);
  time += 1;
  assert.equal((await run(create())).text, "Ready.");
  assert.equal(calls, 2);
});

test("successful token headers pace a later request across recreated runtimes", async () => {
  let time = 1_800_000_000_000;
  const waits: number[] = [],
    bodies: any[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const response = completion();
    if (bodies.length === 1) {
      response.headers.set("x-ratelimit-limit-tokens", "2000");
      response.headers.set("x-ratelimit-remaining-tokens", "100");
      response.headers.set("x-ratelimit-reset-tokens", "19s");
    }
    return response;
  };
  const wait = async (ms: number, signal?: AbortSignal | null) => {
    signal?.throwIfAborted();
    waits.push(ms);
    time += ms;
  };
  await run(createGroqRuntime(config, fetcher, () => time, wait));
  const second = createGroqRuntime(config, fetcher, () => time, wait);
  const progress: number[] = [];
  second.setWaitListener?.((ms) => progress.push(ms));
  await run(second);
  assert.equal(bodies.length, 2);
  const body = bodies[1];
  const prompt = JSON.stringify({
    messages: body.messages,
    tools: body.tools ?? [],
    tool_choice: body.tool_choice,
  });
  const estimate =
    Math.ceil(new TextEncoder().encode(prompt).length / 4) + body.max_tokens;
  assert.deepEqual(waits, [Math.ceil((Math.min(estimate, 2000) - 100) / 0.1)]);
  assert.deepEqual(progress, waits);
  second.setWaitListener?.(undefined);
});

test("cancelling a quota wait prevents the next upstream request", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    const response = completion();
    response.headers.set("x-ratelimit-limit-tokens", "2000");
    response.headers.set("x-ratelimit-remaining-tokens", "1");
    response.headers.set("x-ratelimit-reset-tokens", "10s");
    return response;
  };
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = (_ms: number, signal?: AbortSignal | null) =>
    new Promise<void>((_resolve, reject) => {
      started();
      if (signal?.aborted) reject(signal.reason);
      else
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
    });
  const runtime = createGroqRuntime(config, fetcher, () => 1000, wait);
  const progress: number[] = [];
  runtime.setWaitListener?.((ms) => progress.push(ms));
  await run(runtime);
  const controller = new AbortController();
  const pending = run(runtime, controller.signal);
  await startedPromise;
  controller.abort();
  await assert.rejects(pending);
  assert.equal(calls, 1);
  assert.equal(progress.length, 1);
  assert.ok(progress[0] > 0);
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(run(runtime, alreadyAborted.signal));
  assert.equal(progress.length, 1);
});

test("concurrent requests reserve shared token capacity before calling upstream", async () => {
  let time = 1000,
    calls = 0;
  const waits: number[] = [];
  let release!: () => void, started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 1) {
      const response = completion();
      response.headers.set("x-ratelimit-limit-tokens", "2000");
      response.headers.set("x-ratelimit-remaining-tokens", "1200");
      response.headers.set("x-ratelimit-reset-tokens", "8s");
      return response;
    }
    if (calls === 2) {
      started();
      await held;
    }
    return completion();
  };
  const wait = async (ms: number, signal?: AbortSignal | null) => {
    signal?.throwIfAborted();
    waits.push(ms);
    time += ms;
  };
  const runtime = () => createGroqRuntime(config, fetcher, () => time, wait);
  await run(runtime());
  const first = run(runtime());
  await startedPromise;
  const second = run(runtime());
  await second;
  assert.equal(calls, 3);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 0);
  release();
  await first;
});

test("malformed token quota headers do not trigger pacing", async () => {
  for (const headers of [
    {
      "x-ratelimit-limit-tokens": "bad",
      "x-ratelimit-remaining-tokens": "1",
      "x-ratelimit-reset-tokens": "3s",
    },
    {
      "x-ratelimit-limit-tokens": "1000",
      "x-ratelimit-remaining-tokens": "2000",
      "x-ratelimit-reset-tokens": "3s",
    },
    {
      "x-ratelimit-limit-tokens": "2000",
      "x-ratelimit-remaining-tokens": "1",
      "x-ratelimit-reset-tokens": "invalid",
    },
    {
      "x-ratelimit-limit-tokens": "2000",
      "x-ratelimit-remaining-tokens": "1",
      "x-ratelimit-reset-tokens": "0s",
    },
  ]) {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      const response = completion();
      for (const [name, value] of Object.entries(headers))
        response.headers.set(name, value);
      return response;
    };
    const runtime = createGroqRuntime(
      config,
      fetcher,
      () => 1000,
      async () => {
        throw new Error("unexpected quota wait");
      },
    );
    await run(runtime);
    await run(runtime);
    assert.equal(calls, 2);
  }
});

test("HTTP-date cooldown and independent transports and models", async () => {
  let time = Date.UTC(2027, 0, 1);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return calls === 1
      ? Response.json(
          { error: { message: "private fixture body" } },
          {
            status: 429,
            headers: { "retry-after": new Date(time + 10_000).toUTCString() },
          },
        )
      : completion();
  };
  const same = () => createGroqRuntime(config, fetcher, () => time);
  await expectLimited(run(same()), "10");
  time += 3000;
  await expectLimited(run(same()), "7");
  assert.equal(calls, 1);
  assert.equal(
    (
      await run(
        createGroqRuntime(
          { ...config, modelId: "another" },
          fetcher,
          () => time,
        ),
      )
    ).text,
    "Ready.",
  );
  let independentCalls = 0;
  const other: typeof fetch = async () => {
    independentCalls++;
    return completion();
  };
  assert.equal(
    (await run(createGroqRuntime(config, other, () => time))).text,
    "Ready.",
  );
  assert.equal(independentCalls, 1);
  assert.equal(calls, 2);
  time += 7000;
  assert.equal((await run(same())).text, "Ready.");
  assert.equal(calls, 3);
});

test("invalid, nonpositive and past Retry-After values do not create cooldowns", async () => {
  const time = Date.UTC(2027, 0, 1);
  for (const header of [
    "garbage",
    "0",
    "-10",
    new Date(time - 1000).toUTCString(),
  ]) {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return calls === 1
        ? Response.json(
            { error: { message: "private fixture body" } },
            { status: 429, headers: { "retry-after": header } },
          )
        : completion();
    };
    const runtime = createGroqRuntime(config, fetcher, () => time);
    await expectLimited(run(runtime));
    assert.equal((await run(runtime)).text, "Ready.", header);
    assert.equal(calls, 2, header);
  }
});

test("billed usage survives an SDK tool-choice violation and drains once", async () => {
  const fetcher: typeof fetch = async () =>
    Response.json({
      id: "invalid-tool-choice",
      model: "fixture-model",
      created: 0,
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "A plain answer." },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 431,
        completion_tokens: 47,
        prompt_tokens_details: { cached_tokens: 120 },
      },
    });
  const runtime = createGroqRuntime(config, fetcher);
  await assert.rejects(
    generateText({
      model: runtime.model,
      prompt: "test",
      tools: { expected: tool({ inputSchema: z.object({}) }) },
      toolChoice: "required",
      maxOutputTokens: runtime.maxOutputTokens,
      providerOptions: runtime.providerOptions,
      maxRetries: 0,
    }),
    (error: unknown) => ToolChoiceViolationError.isInstance(error),
  );
  assert.deepEqual(runtime.takeUsage?.(), [
    { inputTokens: 431, outputTokens: 47, cachedInputTokens: 120 },
  ]);
  assert.deepEqual(runtime.takeUsage?.(), []);
});

test("malformed provider usage is ignored and captured usage is bounded", async () => {
  for (const usage of [
    { prompt_tokens: -1, completion_tokens: 3 },
    { prompt_tokens: 1.5, completion_tokens: 3 },
    {
      prompt_tokens: 4,
      completion_tokens: 3,
      prompt_tokens_details: { cached_tokens: 5 },
    },
    {
      prompt_tokens: 4,
      completion_tokens: 3,
      prompt_tokens_details: { cached_tokens: "2" },
    },
  ]) {
    const fetcher: typeof fetch = async () => {
      const body = await completion().json();
      return Response.json({ ...body, usage });
    };
    const runtime = createGroqRuntime(config, fetcher);
    await run(runtime).catch(() => undefined);
    assert.deepEqual(runtime.takeUsage?.(), []);
  }
  const runtime = createGroqRuntime(config, async () => completion());
  for (let i = 0; i < 9; i++) await run(runtime);
  assert.equal(runtime.takeUsage?.().length, 8);
  assert.deepEqual(runtime.takeUsage?.(), []);
});

test("429 quota diagnostics log only recognized numeric metadata", async () => {
  const captured: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    captured.push(args);
  };
  try {
    const message =
      "Rate limit reached for model model-secret in organization org-secret on tokens per day (TPD): Limit 100,000, Used 99,500, Requested 2,000. Prompt secret-prompt. Please try again in 148 seconds.";
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return Response.json(
        { error: { message } },
        { status: 429, headers: { "retry-after": "148" } },
      );
    };
    const diagnostic = {
      metric: "tokens",
      window: "day",
      limit: "100000",
      used: "99500",
      requested: "2000",
    };
    const runtime = createGroqRuntime(config, fetcher, () => 1000);
    await expectLimited(run(runtime), "148", diagnostic);
    await expectLimited(
      run(createGroqRuntime(config, fetcher, () => 1000)),
      "148",
      diagnostic,
    );
    assert.equal(calls, 1);
    const quotaLogs = captured.filter(
      (args) => args[0] === "[GROQ] provider quota",
    );
    assert.equal(quotaLogs.length, 1);
    assert.deepEqual(quotaLogs[0][1], {
      metric: "tokens",
      window: "day",
      limit: 100000,
      used: 99500,
      requested: 2000,
      retryAfterSeconds: 148,
    });
    assert.doesNotMatch(
      JSON.stringify(captured),
      /org-secret|model-secret|secret-prompt|fixture-only/,
    );
  } finally {
    console.info = original;
  }
});

test("ambiguous or malformed quota messages are not classified", async () => {
  const captured: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    captured.push(args);
  };
  try {
    for (const message of [
      "tokens per day and requests per minute: Limit 100, Used 90, Requested 20",
      "tokens per day: Limit 1.5, Used 1, Requested 1",
      "tokens per minute: Limit 100, Used 90",
    ]) {
      const fetcher: typeof fetch = async () =>
        Response.json({ error: { message } }, { status: 429 });
      await expectLimited(run(createGroqRuntime(config, fetcher)));
    }
    assert.equal(
      captured.filter((args) => args[0] === "[GROQ] provider quota").length,
      0,
    );
  } finally {
    console.info = original;
  }
});

test("classifies each supported provider metric and window", async () => {
  const captured: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    captured.push(args);
  };
  try {
    for (const metric of ["tokens", "requests"]) {
      for (const window of ["day", "minute"]) {
        const fetcher: typeof fetch = async () =>
          Response.json(
            {
              error: {
                message: `${metric} per ${window}: Limit 1000, Used 900, Requested 200`,
              },
            },
            { status: 429 },
          );
        await expectLimited(run(createGroqRuntime(config, fetcher)));
        const entry = captured
          .filter((args) => args[0] === "[GROQ] provider quota")
          .at(-1);
        assert.deepEqual(entry?.[1], {
          metric,
          window,
          limit: 1000,
          used: 900,
          requested: 200,
        });
      }
    }
  } finally {
    console.info = original;
  }
});

test("lower minute token limit learned from 429 persists across generic success headers", async () => {
  let time = 1000, calls = 0;
  const waits: number[] = [];
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 1) return Response.json(
      { error: { message: "tokens per minute: Limit 7000, Used 7000, Requested 1200" } },
      { status: 429 },
    );
    const response = completion();
    response.headers.set("x-ratelimit-limit-tokens", "8000");
    response.headers.set("x-ratelimit-remaining-tokens", "7999");
    response.headers.set("x-ratelimit-reset-tokens", "1s");
    return response;
  };
  const wait = async (ms: number) => { waits.push(ms); time += ms; };
  const runtime = () => createGroqRuntime(config, fetcher, () => time, wait, { quotaWaitMaxMs: 0 });
  await expectLimited(run(runtime()));
  await assert.rejects(run(runtime()), (error: unknown) => {
    assert.ok(APICallError.isInstance(error));
    assert.equal(error.responseHeaders?.["x-aurelle-quota-limit"], "7000");
    return true;
  });
  assert.equal(calls, 1);
  time += 60_000;
  await run(runtime());
  for (let i = 0; i < 5; i++) await run(runtime());
  await assert.rejects(run(runtime()), (error: unknown) => {
    assert.ok(APICallError.isInstance(error));
    assert.equal(error.responseHeaders?.["x-aurelle-quota-limit"], "7000");
    return true;
  });
  assert.deepEqual(waits, []);
});

test("standalone Groq does not wait for multi-minute token recovery", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    const response = completion();
    response.headers.set("x-ratelimit-limit-tokens", "2000");
    response.headers.set("x-ratelimit-remaining-tokens", "1");
    response.headers.set("x-ratelimit-reset-tokens", "10m");
    return response;
  };
  const runtime = createGroqRuntime(config, fetcher, () => 1000, async () => {
    throw new Error("must not wait");
  });
  await run(runtime);
  await assert.rejects(run(runtime), (error: unknown) =>
    APICallError.isInstance(error) && error.statusCode === 429 &&
    error.responseHeaders?.["x-aurelle-local-capacity"] === "1",
  );
  assert.equal(calls, 1);
});

test("Retry-After permits one reserved probe of the same request despite a conservative local estimate", async () => {
  let time = 1000, calls = 0;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 1) return Response.json(
      { error: { message: "tokens per minute: Limit 8000, Used 7980, Requested 900" } },
      { status: 429, headers: { "retry-after": "2" } },
    );
    started();
    await gate;
    return completion();
  };
  const runtime = () => createGroqRuntime(config, fetcher, () => time, undefined, { quotaWaitMaxMs: 0 });
  await expectLimited(run(runtime()), "2");
  time += 2000;
  const probe = run(runtime());
  // The pending provider call makes a concurrent identical retry contend for the shared bucket.
  await Promise.race([startedPromise, probe.then(() => { throw new Error("probe unexpectedly completed"); })]);
  await assert.rejects(run(runtime()), (error: unknown) =>
    APICallError.isInstance(error) && error.statusCode === 429 &&
    error.responseHeaders?.["x-aurelle-local-capacity"] === "1",
  );
  assert.equal(calls, 2);
  release();
  assert.equal((await probe).text, "Ready.");
});

test("provider classifies input and output token quotas without merging their capacities", async () => {
  for (const kind of ["input", "output"]) {
    let calls = 0, time = 1000;
    const logs: unknown[][] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => { logs.push(args); };
    try {
      const fetcher: typeof fetch = async () => {
        calls++;
        return calls === 1
          ? Response.json({ error: { message: `private-secret ${kind} tokens per minute (${kind === "input" ? "ITPM" : "OTPM"}): Limit 8000, Used 7980, Requested 900` } }, { status: 429, headers: { "retry-after": "2" } })
          : completion();
      };
      const runtime = () => createGroqRuntime(config, fetcher, () => time, undefined, { quotaWaitMaxMs: 0 });
      await assert.rejects(run(runtime()), (error: unknown) => {
        assert.ok(APICallError.isInstance(error));
        assert.equal(error.responseHeaders?.["x-aurelle-quota-metric"], "tokens");
        assert.equal(error.responseHeaders?.["x-aurelle-quota-token-kind"], kind);
        assert.equal(error.responseHeaders?.["retry-after"], "2");
        return true;
      });
      const diagnostic = logs.find(([name]) => name === "[GROQ] provider quota")?.[1] as Record<string, unknown>;
      assert.equal(diagnostic.tokenKind, kind);
      assert.doesNotMatch(JSON.stringify(logs), /private-secret/);
      time += 2000;
      await run(runtime());
      assert.equal(calls, 2);
    } finally { console.info = original; }
  }
});

test("the Retry-After probe applies only to the original payload and keeps learned lower limits", async () => {
  let time = 1000, calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 1) return Response.json(
      { error: { message: "tokens per minute: Limit 7000, Used 7000, Requested 900" } },
      { status: 429, headers: { "retry-after": "2" } },
    );
    const response = completion();
    response.headers.set("x-ratelimit-limit-tokens", "8000");
    response.headers.set("x-ratelimit-remaining-tokens", "7999");
    response.headers.set("x-ratelimit-reset-tokens", "1s");
    return response;
  };
  const runtime = () => createGroqRuntime(config, fetcher, () => time, undefined, { quotaWaitMaxMs: 0 });
  await expectLimited(run(runtime()), "2");
  time += 2000;
  const other = runtime();
  await assert.rejects(generateText({ model: other.model, prompt: "a different request", maxOutputTokens: other.maxOutputTokens, providerOptions: other.providerOptions, maxRetries: 0 }), (error: unknown) =>
    APICallError.isInstance(error) && error.responseHeaders?.["x-aurelle-local-capacity"] === "1",
  );
  assert.equal(calls, 1);
  await run(runtime());
  assert.equal(calls, 2);
  await assert.rejects(run(runtime()), (error: unknown) =>
    APICallError.isInstance(error) && error.responseHeaders?.["x-aurelle-quota-limit"] === "7000",
  );
  assert.equal(calls, 2);
});

test("input-token Retry-After admits only one unmetered probe at a time", async () => {
  let time = 1000, calls = 0;
  let started!: () => void, release!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 1) return Response.json(
      { error: { message: "input tokens per minute (ITPM): Limit 8000, Used 7980, Requested 900" } },
      { status: 429, headers: { "retry-after": "2" } },
    );
    started();
    await gate;
    return completion();
  };
  const runtime = () => createGroqRuntime(config, fetcher, () => time, undefined, { quotaWaitMaxMs: 0 });
  await expectLimited(run(runtime()), "2");
  time += 2000;
  const probe = run(runtime());
  await startedPromise;
  await assert.rejects(run(runtime()), (error: unknown) =>
    APICallError.isInstance(error) && error.responseHeaders?.["x-aurelle-local-capacity"] === "1",
  );
  assert.equal(calls, 2);
  release();
  await probe;
});
