import { test } from "node:test";
import assert from "node:assert/strict";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import { runAgent } from "../src/infrastructure/chat/native-agent";
import { initialAgentState } from "../src/application/chat/shopping-v3";
import { asksReturnShippingCost, getStorePolicy, resolvePolicyTopic } from "../src/domain/catalog/policies";
import { directlyAnsweredByPolicy } from "../src/application/chat/policy-question";
import type { CatalogService } from "../src/application/catalog/catalog-service";

const scenarios = [
  ["How much is delivery and how long do I have to return an item?", "delivery", "en", "delivery-and-returns"],
  ["Ile kosztuje dostawa i ile mam czasu na zwrot?", "returns", "pl", "delivery-and-returns"],
  ["Ile kosztuje dostawa i ile mam czasu na zwrot produktu?", "delivery", "pl", "delivery-and-returns"],
  ["Can I return an item within 14 days of delivery?", "delivery", "en", "returns"],
  ["Czy mogę zwrócić produkt w ciągu 14 dni od dostawy?", "delivery", "pl", "returns"],
  ["Who pays for return shipping?", "delivery", "en", "return-shipping"],
  ["Who pays for shipping if I return it?", "delivery", "en", "return-shipping"],
  ["Who pays for return shipping and how long do I have to return an item?", "delivery", "en", "return-shipping-and-returns"],
  ["Ile kosztuje dostawa i kto płaci za odesłanie produktu przy zwrocie?", "returns", "pl", "delivery-and-return-shipping"],
  ["Ile mam czasu na zwrot i kto płaci za odesłanie produktu przy zwrocie?", "delivery", "pl", "return-shipping-and-returns"],
  ["How much is delivery and how long do I have to return an item and who pays for return shipping?", "delivery", "en", "delivery-and-returns-and-return-shipping"],
  ["Can I return an item within fourteen days of delivery?", "delivery", "en", "returns"],
  ["Czy mogę zwrócić produkt w ciągu czternastu dni od dostawy?", "delivery", "pl", "returns"],
  ["How much does return shipping cost?", "returns", "en", "return-shipping"],
  ["Jaki jest koszt zwrotu?", "delivery", "pl", "return-shipping"],
  ["Kto płaci za odesłanie produktu przy zwrocie?", "returns", "pl", "return-shipping"],
] as const;

for (const [text, modelTopic, language, expected] of scenarios) {
  test(`typed policy uses canonical ${expected} for ${language} question despite a single model topic`, async () => {
    let calls = 0;
    const runtime = createGroqRuntime({ baseURL: "http://fixture/v1", modelId: "fixture", apiKey: "fixture-only" }, async () => {
      calls++;
      return Response.json({
        id: "fixture", model: "fixture", created: 1,
        choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call", type: "function", function: { name: "getPolicy", arguments: JSON.stringify({ topic: modelTopic }) } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    });
    const result = await runAgent(runtime.model, {} as CatalogService, { text, userMessageId: `policy-${language}-${expected}`, conversationId: `policy-${language}-${expected}`, state: initialAgentState() }, new AbortController().signal, runtime);
    assert.equal(result.status.status, "complete");
    assert.equal(result.advice.status, "not-requested");
    assert.equal(result.answer, getStorePolicy(expected, language));
    assert.equal(calls, 1);
    assert.deepEqual(result.checkpoint.readResult, { kind: "policy", topic: expected });
    if (expected === "return-shipping") assert.doesNotMatch(result.answer, /\b4\b/);
  });
}

test("delivery as return window reference does not request the delivery policy", () => {
  for (const question of ["Can I return an item within 14 days of delivery?", "Czy mogę zwrócić produkt w ciągu 14 dni od dostawy?"]) {
    assert.equal(resolvePolicyTopic(question), "returns");
    assert.doesNotMatch(getStorePolicy(question), /EUR 4/);
  }
  assert.equal(resolvePolicyTopic("How much is delivery?"), "delivery");
  assert.equal(resolvePolicyTopic("How long do I have to return an item?"), "returns");
});

test("unrelated additional questions do not skip model continuation", () => {
  assert.equal(directlyAnsweredByPolicy("How much is delivery and can I return an item from abroad?", "delivery-and-returns"), false);
  assert.equal(directlyAnsweredByPolicy("Who pays for return shipping and can I return an item from abroad?", "return-shipping-and-returns"), false);
});


test("unrelated payments and return windows are not return-postage questions", () => {
  for (const question of ["I paid cash. Can I return an item within 14 days?", "Will you refund what I paid?", "Zapłaciłem gotówką. Czy mogę zwrócić produkt w ciągu 14 dni od dostawy?"]) {
    assert.equal(asksReturnShippingCost(question), false, question);
    assert.equal(resolvePolicyTopic(question), "returns", question);
  }
  assert.equal(resolvePolicyTopic("Who pays for shipping if I decide to return an item?"), "return-shipping");
  for (const question of ["How much does return shipping cost?", "Who pays for return shipping?", "Kto płaci za odesłanie produktu przy zwrocie?", "Jaki jest koszt zwrotu?"]) {
    assert.equal(asksReturnShippingCost(question), true, question);
  }
});
