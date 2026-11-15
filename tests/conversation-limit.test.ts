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
