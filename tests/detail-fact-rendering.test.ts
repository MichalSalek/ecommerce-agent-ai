import assert from "node:assert/strict";
import { test } from "node:test";
import { products } from "../src/data/products";
import { resolveLanguage } from "../src/application/chat/assistant-text";
import { initialAgentState } from "../src/application/chat/shopping-v3";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import { runAgent } from "../src/infrastructure/chat/native-agent";
import type { CatalogService } from "../src/application/catalog/catalog-service";

let sequence = 0;
async function ask(request: string, productId: string, detail: object, finish = "tool_calls") {
  let calls = 0;
  const runtime = createGroqRuntime({ baseURL: "http://127.0.0.1:8787/v1", modelId: "test", apiKey: "fixture-only" }, async () => {
    calls++;
    const first = calls === 1;
    const name = first ? "getProductDetails" : "answerProductQuestion";
    const input = first ? { productId } : detail;
    return Response.json({ id: `detail-render-${calls}`, model: "test", created: 0, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: `call-${calls}`, type: "function", function: { name, arguments: JSON.stringify(input) } }] }, finish_reason: first ? "tool_calls" : finish }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
  });
  const catalog = { details: async (id: string) => products.find((product) => product.id === id) } as unknown as CatalogService;
  const result = await runAgent(runtime.model, catalog, { text: request, userMessageId: `fact-render-${++sequence}`, state: initialAgentState() }, new AbortController().signal, runtime);
  return { result, calls };
}
const supported = (answer: string, quote = "handles for hot drinks") => ({ status: "supported", source: "features", quote, answer });

test("verified source fragments answer handle presence naturally in Polish and English", async () => {
  for (const [request, draft, expected] of [
    ["A czy Ceramic mugs mają uchwyty?", "handles for hot drinks", "Tak, w katalogu dla produktu Ceramic mugs podano uchwyt."],
    ["Do Ceramic mugs have handles?", "handles for hot drinks", "Yes, the catalog lists a handle for Ceramic mugs."],
    ["Czy Ceramic mugs mają uchwyty?", "handles for hot drinks.", "Tak, w katalogu dla produktu Ceramic mugs podano uchwyt."],
    ["Do Ceramic mugs have handles?", "handles for hot drinks.", "Yes, the catalog lists a handle for Ceramic mugs."],
    ["Czy Ceramic mugs mają uchwyty?", "Yes, Ceramic mugs have handles.", "Tak, w katalogu dla produktu Ceramic mugs podano uchwyt."],
    ["A czy te kubki mają uchwyty?", "handles", "Tak, w katalogu dla produktu Ceramic mugs podano uchwyt."],
  ] as const) {
    const { result, calls } = await ask(request, "mugs", supported(draft));
    assert.equal(calls, 2);
    assert.equal(result.status.status, "complete");
    assert.equal(result.operation.status, "completed");
    assert.equal(result.answer, expected);
    assert.deepEqual(result.presentation.productIds, ["mugs"]);
  }
});

test("same presence question about carafe does not infer a handle from unrelated facts", async () => {
  for (const detail of [supported("handles for hot drinks"), supported("narrow neck", "narrow neck"), supported("narrow neck.", "narrow neck"), { status: "missing", answer: "" }]) {
    const { result } = await ask("Czy Glass carafe ma uchwyt?", "carafe", detail);
    assert.match(result.answer, /nie potrafię potwierdzić/i);
    assert.doesNotMatch(result.answer, /podano uchwyt/i);
    assert.deepEqual(result.presentation.productIds, ["carafe"]);
  }
});

test("contradictory, unrelated or more qualified claims never get repaired as a positive fact", async () => {
  const cases = [
    ["Czy Ceramic mugs mają uchwyty?", supported("No, Ceramic mugs have no handles.")],
    ["Czy Ceramic mugs mają uchwyty?", supported("set of two", "set of two")],
    ["Czy Ceramic mugs mają uchwyty odporne na wysoką temperaturę?", supported("handles for hot drinks")],
    ["Czy Ceramic mugs nie mają uchwytów?", supported("handles for hot drinks")],
    ["Czy Ceramic mugs mają uchwyty i pokrywkę?", supported("handles for hot drinks")],
  ] as const;
  for (const [request, detail] of cases) {
    const { result } = await ask(request, "mugs", detail);
    assert.match(result.answer, /nie potrafię potwierdzić/i);
    assert.doesNotMatch(result.answer, /podano uchwyt/i);
  }
});

test("a truncated provider response is not repaired", async () => {
  const { result } = await ask("Do Ceramic mugs have handles?", "mugs", supported("handles for hot drinks"), "length");
  assert.match(result.answer, /cannot confirm/i);
  assert.doesNotMatch(result.answer, /catalog lists a handle/i);
});


test("fresh Polish and English question markers set language while explicit choices win", () => {
  assert.equal(resolveLanguage("Czy Glass carafe ma uchwyt?", "en"), "pl");
  assert.equal(resolveLanguage("A czy Glass carafe ma uchwyt?", "en"), "pl");
  assert.equal(resolveLanguage("Does Glass carafe have a handle?", "pl"), "en");
  assert.equal(resolveLanguage("Czy Glass carafe ma uchwyt? In English.", "pl"), "en");
  assert.equal(resolveLanguage("Does Glass carafe have a handle? Po polsku.", "en"), "pl");
  assert.equal(resolveLanguage("Czy Glass carafe ma uchwyt?", "en", true), "en");
});
