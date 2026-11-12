import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLlamaModel,
  LLAMA_PROVIDER,
} from "../src/infrastructure/chat/llama-model";
import { narrateResults } from "../src/infrastructure/chat/narration";
import { conversationContext } from "../src/application/chat/conversation";
import { products } from "../src/data/products";
test("optional natural wording accepts a customer-language question, but rejects invented numeric facts", async () => {
  const messages = [
    { role: "user" as const, content: "szukam czegoś do domu" },
  ];
  const context = conversationContext(messages);
  async function run(reply: { opening: string; followUp: string }) {
    const model = createLlamaModel("http://fixture/v1", "test", async () =>
      Response.json({
        id: "fixture",
        object: "chat.completion",
        created: 0,
        model: "test",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(reply) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    return narrateResults(
      model,
      messages,
      products.slice(0, 2),
      context,
      {
        providerOptions: {
          [LLAMA_PROVIDER]: { response_format: { type: "json_object" } },
        },
        maxOutputTokens: 3000,
      },
      new AbortController().signal,
      true,
    );
  }
  const valid = {
    opening: "Możemy zacząć od czegoś przydatnego na co dzień.",
    followUp: "Wolisz dekoracje czy coś do kuchni?",
  };
  assert.deepEqual(await run(valid), valid);
  assert.equal(
    await run({
      opening: "Ten produkt kosztuje 99 EUR.",
      followUp: "Chcesz go kupić?",
    }),
    undefined,
  );
  assert.equal(
    await run({ opening: "Nie mam produktów.", followUp: "Co dalej?" }),
    undefined,
  );
});
