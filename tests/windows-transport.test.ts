import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWindowsCurlResponse } from "../src/infrastructure/chat/windows-fetch";
test("Windows curl preserves actual provider cooldown and rate headers", async () => {
  const response = parseWindowsCurlResponse(
    '{"error":"limited"}\nAURELLE_STATUS:429\nAURELLE_HEADERS:{"content-type":["application/json"],"retry-after":["7"],"x-ratelimit-remaining-tokens":["0"],"set-cookie":["ignored"]}',
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "7");
  assert.equal(response.headers.get("x-ratelimit-remaining-tokens"), "0");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(await response.text(), '{"error":"limited"}');
});
test("malformed status or header payload is not accepted as a provider response", () => {
  assert.throws(() =>
    parseWindowsCurlResponse("{}\nAURELLE_STATUS:0\nAURELLE_HEADERS:{}"),
  );
  assert.throws(() =>
    parseWindowsCurlResponse("{}\nAURELLE_STATUS:200\nAURELLE_HEADERS:broken"),
  );
});

test("llama transport disables thinking in the serialized chat request", async () => {
  const { generateText } = await import("ai");
  const { createLlamaModel } = await import("../src/infrastructure/chat/llama-model");
  let request: any;
  const model = createLlamaModel("http://localhost:8090/v1", "fixture", async (_input, init) => {
    request = JSON.parse(String(init?.body));
    return Response.json({ id: "test", model: "fixture", created: 0, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "Ready." }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  await generateText({ model, prompt: "test", maxRetries: 0 });
  assert.deepEqual(request.chat_template_kwargs, { enable_thinking: false });
});
