import { test } from "node:test";
import assert from "node:assert/strict";
import { createLlamaModel } from "../src/infrastructure/chat/llama-model";
import { createJsonAgentStream } from "../src/infrastructure/chat/json-agent-stream";
import { CatalogService } from "../src/application/catalog/catalog-service";
import { createShopTools } from "../src/application/chat/tools";

test("the JSON agent sends JSON mode to the HTTP server and executes the validated tool", async () => {
  const requests: Record<string, unknown>[] = [];
  let searched = false;
  const tools = createShopTools(
    new CatalogService({
      browse: async () => [],
      search: async (input) => {
        assert.equal(input.query, "coffee");
        searched = true;
        return [];
      },
      findById: async () => undefined,
    }),
  );
  const fakeFetch: typeof fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const content =
      requests.length === 1
        ? JSON.stringify({ tool: "searchProducts", input: { query: "coffee" } })
        : JSON.stringify({ text: "No products found." });
    return Response.json({
      id: "test",
      object: "chat.completion",
      created: 0,
      model: "test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };
  const stream = createJsonAgentStream(
    createLlamaModel("http://fixture/v1", "bielik-test", fakeFetch),
    [{ role: "user", content: "coffee" }],
    tools,
    new AbortController().signal,
  );
  const parts = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  assert.equal(searched, true);
  assert.equal(requests.length, 1);
  for (const request of requests) {
    assert.deepEqual(request.response_format, { type: "json_object" });
    assert.equal(request.model, "bielik-test");
  }
  assert.ok(parts.some((part) => part.type === "tool-output-available"));
  assert.ok(
    parts.some(
      (part) =>
        part.type === "text-delta" &&
        part.delta.startsWith("No matching products"),
    ),
  );
});

test("budget-only browsing does not ask the LLM to invent a product intent", async () => {
  let browsed = false;
  const tools = createShopTools(
    new CatalogService({
      search: async () => {
        throw Error("Semantic search should not run");
      },
      browse: async (maxPrice) => {
        assert.equal(maxPrice, 25);
        browsed = true;
        return [];
      },
      findById: async () => undefined,
    }),
  );
  const model = createLlamaModel("http://fixture/v1", "test", async () => {
    throw Error("LLM should not be called for a structured budget");
  });
  const stream = createJsonAgentStream(
    model,
    [{ role: "user", content: "What can I buy under EUR 25?" }],
    tools,
    new AbortController().signal,
  );
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    assert.notEqual(value.type, "error");
  }
  assert.ok(browsed);
});
