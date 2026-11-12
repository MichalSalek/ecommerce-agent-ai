import { test } from "node:test";
import assert from "node:assert/strict";
import { generateText } from "ai";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
test("Groq balancer uses the background route and preserves purpose attribution", async () => {
  let called = false;
  const runtime = createGroqRuntime(
    {
      baseURL: "http://127.0.0.1:8787/v1",
      modelId: "openai/gpt-oss-120b",
      balancer: true,
      windowsTransport: false,
    },
    async (input, init) => {
      called = true;
      assert.equal(
        String(input),
        "http://127.0.0.1:8787/v1/background/chat/completions",
      );
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("X-Balancer-Client"), "aurelle-demo");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 3000);
      assert.deepEqual(body.response_format, { type: "json_object" });
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
        balancer: false,
        windowsTransport: false,
      }),
    /GROQ_API_KEY/,
  );
});
