import { test } from "node:test";
import assert from "node:assert/strict";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import { runAgent } from "../src/infrastructure/chat/native-agent";
import { initialAgentState } from "../src/application/chat/shopping-v3";
import { getShop } from "../src/composition/shop";
function runtimeFor(answers: { text: string; productIds: string[] }[]) {
  let calls = 0;
  const runtime = createGroqRuntime(
    {
      baseURL: "http://fixture/v1",
      modelId: "fixture",
      apiKey: "fixture",
      balancer: false,
      windowsTransport: false,
    },
    async () => {
      const answer = answers[calls++];
      assert.ok(answer, "Unexpected inference");
      return Response.json({
        id: "cart",
        object: "chat.completion",
        model: "fixture",
        created: 0,
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "present",
                  type: "function",
                  function: {
                    name: "presentAnswer",
                    arguments: JSON.stringify({
                      text: answer.text,
                      productIds: answer.productIds,
                      language: "en",
                      view: "none",
                      evidenceIds: ["cart"],
                    }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  );
  return { runtime, calls: () => calls };
}
test("device cart quantities and current catalog totals are verified application evidence", async () => {
  const mock = runtimeFor([
    {
      text: "Your cart has 2 units of Glass carafe, with a total of EUR 38.",
      productIds: ["carafe"],
    },
  ]);
  const result = await runAgent(
    mock.runtime.model,
    getShop().catalog,
    {
      text: "What quantity is saved in my cart?",
      userMessageId: crypto.randomUUID(),
      state: initialAgentState(),
      cart: [{ productId: "carafe", quantity: 2 }],
    },
    new AbortController().signal,
    mock.runtime,
  );
  assert.equal(result.status.status, "complete");
  assert.match(result.answer, /2 units/);
  assert.equal(result.cart, undefined);
  assert.equal(mock.calls(), 1);
});
test("cart context changes invalidate answers without changing the stable user-turn identity", async () => {
  const mock = runtimeFor([
    { text: "Your cart has 1 item.", productIds: ["carafe"] },
    { text: "Your cart has 2 items.", productIds: ["carafe"] },
  ]);
  const turn = {
    text: "How many items are in my cart?",
    userMessageId: crypto.randomUUID(),
    state: initialAgentState(),
  };
  const first = await runAgent(
    mock.runtime.model,
    getShop().catalog,
    { ...turn, cart: [{ productId: "carafe", quantity: 1 }] },
    new AbortController().signal,
    mock.runtime,
  );
  const second = await runAgent(
    mock.runtime.model,
    getShop().catalog,
    { ...turn, cart: [{ productId: "carafe", quantity: 2 }] },
    new AbortController().signal,
    mock.runtime,
  );
  assert.match(first.answer, /1 item/);
  assert.match(second.answer, /2 items/);
  assert.equal(mock.calls(), 2);
});
test("an empty device cart is not treated as absent store inventory", async () => {
  const mock = runtimeFor([
    { text: "There are no products in your cart.", productIds: [] },
  ]);
  const result = await runAgent(
    mock.runtime.model,
    getShop().catalog,
    {
      text: "What is in my cart?",
      userMessageId: crypto.randomUUID(),
      state: initialAgentState(),
      cart: [],
    },
    new AbortController().signal,
    mock.runtime,
  );
  assert.equal(result.status.status, "complete");
  assert.equal(result.cart, undefined);
});
