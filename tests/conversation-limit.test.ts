import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conversationUsage,
  MAX_CONVERSATION_TURNS,
  MAX_CONVERSATION_CHARACTERS,
} from "../src/application/chat/conversation-limit";
import type { ChatMessage } from "../src/types/shop";
test("conversation closes predictably before unbounded history reaches a provider", () => {
  const messages: ChatMessage[] = Array.from(
    { length: MAX_CONVERSATION_TURNS },
    (_, i) => ({
      id: String(i),
      role: "user",
      parts: [{ type: "text", text: "test" }],
    }),
  );
  assert.equal(conversationUsage(messages.slice(0, -1)).closed, false);
  assert.equal(conversationUsage(messages).closed, true);
  assert.equal(
    conversationUsage([
      {
        id: "big",
        role: "user",
        parts: [
          { type: "text", text: "x".repeat(MAX_CONVERSATION_CHARACTERS) },
        ],
      },
    ]).closed,
    true,
  );
  assert.equal(conversationUsage([]).closed, false);
});

test("material durability follow-up stays grounded in documented evidence without a provider dependency", async () => {
  const { createJsonAgentStream } =
    await import("../src/infrastructure/chat/json-agent-stream");
  const { createLlamaModel } =
    await import("../src/infrastructure/chat/llama-model");
  const { createShopTools } = await import("../src/application/chat/tools");
  const { CatalogService } =
    await import("../src/application/catalog/catalog-service");
  const model = createLlamaModel("http://fixture/v1", "unused", async () => {
    throw Error("Must not claim unrecorded product durability from an LLM");
  });
  const tools = createShopTools(
    new CatalogService({
      search: async () => [],
      browse: async () => [],
      categories: async () => [],
      findById: async () => undefined,
    }),
  );
  const stream = createJsonAgentStream(
    model,
    [
      { role: "user", content: "szukam wazonu" },
      { role: "assistant", content: "Co jest najważniejsze?" },
      { role: "user", content: "trwałość materiału" },
    ],
    tools,
    new AbortController().signal,
  );
  const reader = stream.getReader();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    assert.notEqual(value.type, "error");
    if (value.type === "text-delta") text += value.delta;
  }
  assert.match(text, /nie zawiera testów odporności/);
  assert.match(text, /ryzyko upadku/);
});
