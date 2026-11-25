import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { products } from "../src/data/products";
import { functionalRefinement } from "../src/application/chat/explicit-facets";
import { CatalogService } from "../src/application/catalog/catalog-service";
import { initialAgentState, type AgentState } from "../src/application/chat/shopping-v3";
import { LanceProductRepository } from "../src/infrastructure/catalog/lance-product-repository";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import { runAgent } from "../src/infrastructure/chat/native-agent";
import type { ProductSearch } from "../src/domain/catalog/product";

type Call = { name: string; input: object };
const fakeVectors = {
  identity: "structural-refinement-test-v1", dimensions: 2,
  embedDocuments: async (texts: string[]) => texts.map(() => [1, 0]),
  embedQuery: async () => [1, 0],
};
const state = (): AgentState => ({
  ...initialAgentState(), language: "pl", languageChosen: true,
  criteria: { query: "", maxPrice: 150, productKind: "furniture", useEnvironment: "outdoor", inStockOnly: true },
  shownIds: ["folding-garden-chair", "outdoor-bistro-table", "sun-lounger", "garden-bench"],
  lastIds: ["folding-garden-chair", "outdoor-bistro-table", "sun-lounger", "garden-bench"],
  resultIds: ["folding-garden-chair", "outdoor-bistro-table", "sun-lounger", "garden-bench"],
});
const badPresentation = (language: "pl" | "en"): Call => ({ name: "presentAnswer", input: {
  claim: "none", evidenceIds: ["selection"], language,
  productIds: ["folding-garden-chair", "sun-lounger", "garden-bench"], view: "products",
  text: language === "pl" ? "Oto trzy meble ogrodowe do siedzenia w cenie do 150 EUR: składane krzesło (49 EUR), leżak (119 EUR) i ławka (129 EUR)." : "Here are seats for your garden, including a chair for 49 EUR.",
} });
const advice = (language: "pl" | "en"): Call => ({ name: "presentAnswer", input: {
  text: language === "pl" ? "Mogę pomóc Ci wybrać spośród tych propozycji." : "I can help you choose from these options.",
} });
function scripted(steps: Call[]) {
  const requests: { messages: unknown[]; tools?: unknown[] }[] = [];
  const runtime = createGroqRuntime({ baseURL: "http://127.0.0.1:8787/v1", modelId: "fixture", apiKey: "fixture-only" }, async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const next = steps[requests.length - 1];
    assert.ok(next, `unexpected inference ${requests.length}`);
    const plain = !body.tools?.length;
    return Response.json({ id: `fixture-${requests.length}`, object: "chat.completion", created: 0, model: "fixture", choices: [{ index: 0, finish_reason: plain ? "stop" : "tool_calls", message: plain ? { role: "assistant", content: (next.input as {text: string}).text } : { role: "assistant", content: null, tool_calls: [{ id: `call-${requests.length}`, type: "function", function: { name: next.name, arguments: JSON.stringify(next.input) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  return { runtime, requests };
}
const searchCall = (extra: Record<string, unknown>): Call => ({ name: "searchProducts", input: { mode: "recommend", operation: "refine", language: "pl", criteria: { functionalGroup: "seating", ...(extra.criteria as object ?? {}) }, explicitFilters: extra.explicitFilters ?? [], continueWith: "presentAnswer" } });

test("functional refinements require a real catalog search before a product presentation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "aurelle-refinement-"));
  const catalog = new CatalogService(new LanceProductRepository(directory, fakeVectors, products));
  const searches: ProductSearch[] = [];
  const searchResult = catalog.searchResult.bind(catalog);
  catalog.searchResult = (criteria) => { searches.push(structuredClone(criteria)); return searchResult(criteria); };
  let serial = 0;
  async function run(text: string, calls: Call[], previous = state()) {
    searches.length = 0;
    const mock = scripted(calls);
    const result = await runAgent(mock.runtime.model, catalog, { text, state: previous, userMessageId: `u-${++serial}`, conversationId: `refinement-${serial}` }, new AbortController().signal, mock.runtime);
    return { result, requests: mock.requests, searches: structuredClone(searches) };
  }
  try {
    for (const [prompt, language] of [["Szukam czegoś do siedzenia.", "pl"], ["I need something to sit on.", "en"], ["Looking for seating.", "en"]] as const) {
      await t.test(prompt, async () => {
        const previous = { ...state(), language };
        const { result, searches, requests } = await run(prompt, [badPresentation(language), advice(language)], previous);
        assert.equal(result.operation.status, "completed");
        assert.equal(result.operation.kind, "search");
        assert.equal(searches.length, 1);
        assert.equal(searches[0].functionalGroup, "seating");
        assert.equal(searches[0].maxPrice, 150);
        assert.equal(searches[0].productKind, "furniture");
        assert.equal(searches[0].useEnvironment, "outdoor");
        assert.equal(searches[0].inStockOnly, true);
        assert.deepEqual(new Set(result.search?.products.map((p) => p.id)), new Set(["folding-garden-chair", "sun-lounger", "garden-bench"]));
        assert.equal(result.checkpoint.after.criteria.maxPrice, 150);
        assert.equal(requests.length, 2);
      });
    }
    await t.test("negative constraints are interpreted by the model and retained in the real search", async () => {
      const { result, searches, requests } = await run("I need seating without benches.", [badPresentation("en"), searchCall({ explicitFilters: [{ facet: "excludeType", value: "bench", userQuote: "without benches" }] }), advice("en")]);
      assert.match(JSON.stringify(requests[1].messages), /additional requirements/);
      assert.equal(searches.length, 1);
      assert.deepEqual(searches[0].excludeTypes, ["bench"]);
      assert.equal(searches[0].maxPrice, 150);
      assert.ok(!result.search?.products.some((p) => p.id === "garden-bench"));
      assert.equal(result.operation.status, "completed");
    });
    await t.test("an attempted correction cannot omit the additional requirement", async () => {
      const { result, searches } = await run("Szukam czegoś do siedzenia z księżycowego tytanu.", [badPresentation("pl"), searchCall({ criteria: { maxPrice: 150, useEnvironment: "outdoor" } })]);
      assert.equal(searches.length, 0);
      assert.equal(result.operation.status, "failed");
      assert.equal(result.search, undefined);
    });
    await t.test("an unconfirmed extra feature is not silently dropped", async () => {
      const { result, searches } = await run("Szukam czegoś do siedzenia z księżycowego tytanu.", [badPresentation("pl"), searchCall({ criteria: { requiredFeatures: ["lunar titanium"] } }), advice("pl")]);
      assert.ok(searches.length >= 1);
      assert.deepEqual(searches[0].requiredFeatures, ["lunar titanium"]);
      assert.equal(searches[0].maxPrice, 150);
      assert.equal(result.search?.outcome, "unconfirmed-feature");
      assert.deepEqual(result.search?.products, []);
    });
    await t.test("detail, comparison, cart, negative-only and incompatible type requests are not rewritten", () => {
      for (const prompt of ["Compare seating with tables", "Tell me more about this seating", "Add seating to my cart", "Nie chcę niczego do siedzenia.", "Czy to siedzenie jest z drewna?"]) assert.equal(functionalRefinement(prompt, state()), undefined, prompt);
      assert.equal(functionalRefinement("Szukam czegoś do siedzenia.", { ...state(), criteria: { productType: "table" } }), undefined);
      assert.equal(functionalRefinement("Szukam czegoś do siedzenia bez ławek.", state())?.simple, false);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
