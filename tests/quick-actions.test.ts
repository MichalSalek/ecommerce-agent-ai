import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { env } from "@huggingface/transformers";
import { products } from "../src/data/products";
import { getStorePolicy, storePolicy } from "../src/domain/catalog/policies";
import { functionalGroups } from "../src/domain/catalog/functional-groups";
import { CatalogService } from "../src/application/catalog/catalog-service";
import { initialAgentState, shoppingExamples, shoppingStarters } from "../src/application/chat/shopping-v3";
import type { AgentState, ShoppingAction } from "../src/application/chat/shopping-v3";
import { runAgent, stateFromMessages } from "../src/infrastructure/chat/native-agent";
import { LanceProductRepository } from "../src/infrastructure/catalog/lance-product-repository";
import { TransformerEmbedding, embeddingProfiles } from "../src/infrastructure/embeddings/transformer-embedding";
import type { ChatMessage } from "../src/types/shop";

env.allowRemoteModels = false;
let seq = 0;
const byId = (id: string) => products.find((product) => product.id === id)!;

test("all quick actions match their visible requests on a real local catalog", async (t) => {
  const path = await mkdtemp(join(tmpdir(), "aurelle-quick-actions-"));
  const embedding = new TransformerEmbedding(".data/models", "minilm");
  const catalog = new CatalogService(new LanceProductRepository(path, embedding, products, embeddingProfiles.minilm.maxDistance));
  const run = (item: { text: string; action: ShoppingAction }, state: AgentState = initialAgentState(), conversationId?: string) => runAgent("offline/unused", catalog, {
    text: item.text, action: item.action, state, userMessageId: `quick-${++seq}`, conversationId: conversationId ?? `quick-session-${seq}`,
  }, new AbortController().signal);
  const at = (label: string) => shoppingExamples.find((item) => item.label === label)!;
  try {
    assert.equal(shoppingStarters.length, 4);
    assert.equal(shoppingExamples.length, 10);
    const garden = await run(shoppingStarters[1]);
    assert.equal(garden.operation.status, "completed");
    assert.ok(garden.search?.products.length);
    const gardenState = garden.checkpoint.after;

    for (const [group, items] of [["starter", shoppingStarters], ["example", shoppingExamples]] as const) {
      for (const item of items) {
        await t.test(`${group}: ${item.label}, fresh and after garden search`, async () => {
          for (const prior of [initialAgentState(), gardenState]) {
            const value = await run(item, prior);
            const action = item.action;
            if (action.type === "more" || action.type === "availability") {
              assert.equal(value.operation.status, prior === gardenState ? "completed" : "needs-input");
              if (prior === gardenState) {
                assert.equal(value.operation.kind, "search");
                assert.equal(value.checkpoint.after.criteria.productKind, "furniture");
                assert.equal(value.checkpoint.after.criteria.maxPrice, 150);
                if (action.type === "availability") assert.equal(value.checkpoint.after.criteria.inStockOnly, true);
                if (action.type === "more") assert.ok(value.search!.products.every((row) => !prior.shownIds.includes(row.id)));
              } else assert.equal(value.search, undefined);
            } else if (action.type === "cart") {
              assert.equal(value.operation.status, "needs-input");
              assert.equal(value.cart, undefined);
            } else {
              assert.equal(value.operation.status, "completed");
            }
            if (action.type === "search") {
              assert.ok(value.search?.products.length, `${group} ${item.label} should show catalog products`);
              const rows = value.search!.products.map((row) => byId(row.id));
              if (action.preset === "coffee") {
                assert.equal(value.checkpoint.after.criteria.functionalGroup, "coffee");
                assert.ok(rows.every((row) => functionalGroups.coffee.types.includes(row.productType)));
              }
              if (action.preset === "garden" || action.preset === "outdoor") {
                assert.ok(rows.every((row) => row.productKind === "furniture" && ["outdoor", "both"].includes(row.useEnvironment) && row.productType !== "planter"));
                if (action.preset === "garden") assert.ok(rows.every((row) => row.price <= 150));
                else assert.deepEqual(value.checkpoint.after.criteria.excludeTypes, ["planter"]);
              }
              if (action.preset === "seating") {
                assert.ok(rows.every((row) => functionalGroups.seating.types.includes(row.productType)));
                if (prior === gardenState) assert.ok(rows.every((row) => row.productKind === "furniture" && ["outdoor", "both"].includes(row.useEnvironment) && row.price <= 150));
              }
              if (action.preset === "budget" || action.preset === "gift") assert.ok(rows.every((row) => row.price <= 25));
              if (action.preset === "gift-home-fragrance") {
                assert.ok(rows.every((row) => row.price < 25));
                assert.deepEqual(new Set(rows.map((row) => row.id)), new Set(["candle", "diffuser"]));
                assert.deepEqual(new Set(rows.map((row) => row.price)), new Set([14, 18]));
                assert.deepEqual(value.checkpoint.after.criteria.productTypes, ["candle", "diffuser"]);
              }
            }
            if (action.type === "compare") {
              assert.deepEqual(value.comparison?.productIds, ["mugs", "carafe"]);
              assert.deepEqual(value.comparison?.cheapestIds, ["carafe"]);
            }
            if (action.type === "policy") assert.equal(value.answer, getStorePolicy(action.topic, value.checkpoint.after.language));
          }
        });
      }
    }

    await t.test("legacy generic gift action remains valid for old stored messages", async () => {
      const value = await run({ text: "Find a gift under EUR 25", action: { type: "search", preset: "gift" } });
      assert.equal(value.operation.status, "completed");
      assert.equal(value.checkpoint.after.criteria.query, "gift");
      assert.equal(value.checkpoint.after.criteria.maxPrice, 25);
    });
    await t.test("the inclusive budget quick action can return every real product priced exactly EUR 25", async () => {
      let page = await run(shoppingStarters[2]);
      const seen = new Set(page.search?.products.map((row) => row.id));
      for (let i = 0; i < products.length && (page.search?.remainingMatches ?? 0) > 0; i++) {
        page = await run(at("Alternatives"), page.checkpoint.after);
        for (const row of page.search?.products ?? []) seen.add(row.id);
      }
      const boundary = products.filter((product) => product.price === 25);
      assert.ok(boundary.length > 0);
      assert.ok(boundary.every((product) => seen.has(product.id)), JSON.stringify(boundary.map((product) => product.id)));
    });
    await t.test("catalog prices use whole euro cents for the strict gift ceiling", () => {
      assert.ok(products.every((product) => Math.abs(product.price * 100 - Math.round(product.price * 100)) < 1e-7));
      assert.ok(products.some((product) => product.price === 25));
    });
    await t.test("welcome delivery and returns composes both policies without changing delivery-only example", async () => {
      const both = await run(shoppingStarters[3]);
      assert.equal(both.answer, `${getStorePolicy("delivery", "en")} ${getStorePolicy("returns", "en")}`);
      assert.match(both.answer, new RegExp(`\\b${storePolicy.deliveryPriceEUR}\\b`));
      assert.match(both.answer, new RegExp(`\\b${storePolicy.returnDays}\\b`));
      const only = await run(at("Delivery"));
      assert.equal(only.answer, getStorePolicy("delivery", "en"));
      assert.doesNotMatch(only.answer, /\breturn\b/i);
    });
    await t.test("seating removes an unrelated search and its stale constraints", async () => {
      const unrelated = { ...initialAgentState(), scope: "coffee mugs", criteria: { category: "Kitchen", categoryExplicit: true, productKind: "kitchenware", productType: "mug", query: "coffee", maxPrice: 25 } };
      const value = await run(at("Refine"), unrelated);
      assert.equal(value.checkpoint.after.criteria.functionalGroup, "seating");
      assert.equal(value.checkpoint.after.criteria.maxPrice, undefined);
      assert.equal(value.checkpoint.after.criteria.category, undefined);
      assert.equal(value.checkpoint.after.criteria.productKind, undefined);
      assert.equal(value.checkpoint.after.criteria.query, undefined);
      assert.ok(value.search?.products.every((row) => functionalGroups.seating.types.includes(byId(row.id).productType)));
    });
    await t.test("seating refinement keeps compatible furniture constraints", async () => {
      const constrained = { ...initialAgentState(), scope: "outdoor chairs", criteria: { productKind: "furniture", productType: "chair", useEnvironment: "outdoor" as const, query: "chair", maxPrice: 150, requiredFeatures: ["wood"], excludeTypes: ["bench"] } };
      const value = await run(at("Refine"), constrained);
      assert.equal(value.checkpoint.after.criteria.productType, "chair");
      assert.deepEqual(value.checkpoint.after.criteria.requiredFeatures, ["wood"]);
      assert.deepEqual(value.checkpoint.after.criteria.excludeTypes, ["bench"]);
      assert.equal(value.checkpoint.after.criteria.useEnvironment, "outdoor");
      assert.equal(value.checkpoint.after.criteria.maxPrice, 150);
    });
    await t.test("outdoor correction retains relevant furniture material and exclusions", async () => {
      const constrained = { ...initialAgentState(), scope: "wood furniture", criteria: { productKind: "furniture", requiredFeatures: ["wood"], excludeTypes: ["chair"], maxPrice: 150 } };
      const value = await run(at("Correction"), constrained);
      assert.deepEqual(value.checkpoint.after.criteria.requiredFeatures, ["wood"]);
      assert.deepEqual(value.checkpoint.after.criteria.excludeTypes, ["chair", "planter"]);
    });
    await t.test("outdoor correction recognizes a prior furniture type even without a kind facet", async () => {
      const constrained = { ...initialAgentState(), scope: "chairs", criteria: { productType: "chair", maxPrice: 150, requiredFeatures: ["wood"] } };
      const value = await run(at("Correction"), constrained);
      assert.equal(value.checkpoint.after.criteria.productType, undefined);
      assert.equal(value.checkpoint.after.criteria.productKind, "furniture");
      assert.equal(value.checkpoint.after.criteria.maxPrice, 150);
      assert.deepEqual(value.checkpoint.after.criteria.requiredFeatures, ["wood"]);
    });
    await t.test("outdoor correction clears unrelated subject, budget and stock filters", async () => {
      const stale = { ...initialAgentState(), scope: "coffee mugs", criteria: { category: "Kitchen", categoryExplicit: true, productKind: "kitchenware", productType: "mug", functionalGroup: "coffee" as const, query: "coffee", maxPrice: 150, inStockOnly: true } };
      const value = await run(at("Correction"), stale);
      const criteria = value.checkpoint.after.criteria;
      assert.equal(criteria.category, undefined);
      assert.equal(criteria.productType, undefined);
      assert.equal(criteria.functionalGroup, undefined);
      assert.equal(criteria.query, undefined);
      assert.equal(criteria.productKind, "furniture");
      assert.equal(criteria.useEnvironment, "outdoor");
      assert.equal(criteria.maxPrice, undefined);
      assert.equal(criteria.inStockOnly, undefined);
      assert.deepEqual(criteria.excludeTypes, ["planter"]);
      assert.ok(value.search?.products.length);
    });
    await t.test("switching from the gift example to outdoor or seating does not retain its gift ceiling", async () => {
      const gift = await run(at("Gift"));
      for (const label of ["Correction", "Refine"]) {
        const changed = await run(at(label), gift.checkpoint.after);
        assert.equal(changed.checkpoint.after.criteria.maxPrice, undefined, label);
        assert.ok(changed.search?.products.length, label);
        assert.ok(changed.search?.products.every((row) => label === "Refine" ? functionalGroups.seating.types.includes(byId(row.id).productType) : byId(row.id).productKind === "furniture"), label);
      }
    });
    await t.test("alternatives and stock cannot reuse an unrelated or absent search", async () => {
      const onlyComparison = await run(at("Compare"));
      for (const label of ["Alternatives", "Availability"]) {
        const absent = await run(at(label), onlyComparison.checkpoint.after);
        assert.equal(absent.operation.status, "needs-input");
        assert.equal(absent.search, undefined);
      }
      const afterGardenComparison = await run(at("Compare"), gardenState);
      for (const label of ["Alternatives", "Availability"]) {
        const stale = await run(at(label), afterGardenComparison.checkpoint.after);
        assert.equal(stale.operation.status, "needs-input");
        assert.equal(stale.search, undefined);
      }
    });
    await t.test("legacy tool history cannot make old search filters apply to a different comparison", async () => {
      const legacy = [
        { id: "legacy-user-search", role: "user", parts: [{ type: "text", text: "Garden furniture" }] },
        { id: "legacy-search", role: "assistant", parts: [{ type: "tool-searchProducts", state: "output-available", toolCallId: "legacy-search-call", input: { query: "", productKind: "furniture", useEnvironment: "outdoor", maxPrice: 150, limit: 5 }, output: garden.search!.products.map((row) => byId(row.id)) }] },
        { id: "legacy-user-compare", role: "user", parts: [{ type: "text", text: "Compare mugs and carafe" }] },
        { id: "legacy-comparison", role: "assistant", parts: [{ type: "tool-compareProducts", state: "output-available", toolCallId: "legacy-compare-call", input: { productIds: ["mugs", "carafe"] }, output: { products: [byId("mugs"), byId("carafe")], missingIds: [] } }] },
        { id: "legacy-current", role: "user", parts: [{ type: "text", text: at("Alternatives").text }] },
      ] as ChatMessage[];
      const restored = stateFromMessages(legacy, "legacy-current");
      assert.deepEqual(restored.lastIds, ["mugs", "carafe"]);
      const value = await run(at("Alternatives"), restored);
      assert.equal(value.operation.status, "needs-input");
      assert.equal(value.search, undefined);
    });
    await t.test("cheaper pair handles a real pair, a tie and a larger group without unintended writes", async () => {
      const comparison = await run(at("Compare"));
      const value = await run(at("Add"), comparison.checkpoint.after);
      assert.equal(value.operation.status, "awaiting-device");
      assert.deepEqual(value.cart?.items, [{ productId: "carafe", quantity: 2 }]);
      const ties = { ...initialAgentState(), lastIds: ["mugs", "wine-glasses"], resultIds: ["mugs", "wine-glasses"], comparisonIds: ["mugs", "wine-glasses"] };
      const conversationId = "quick-tied-choice";
      const tied = await run(at("Add"), ties, conversationId);
      assert.equal(tied.operation.status, "needs-input");
      assert.match(tied.answer, /same/i);
      assert.equal(tied.cart, undefined);
      if (tied.operation.status === "needs-input") assert.deepEqual(tied.operation.choices, ["mugs", "wine-glasses"]);
      const selected = await run({ text: "Add Ceramic mugs to my cart", action: { type: "cart", productId: "mugs", selection: "selected", quantity: 1 } }, tied.checkpoint.after, conversationId);
      assert.equal(selected.operation.status, "awaiting-device");
      assert.deepEqual(selected.cart?.items, [{ productId: "mugs", quantity: 2 }]);
      const many = { ...initialAgentState(), lastIds: ["mugs", "carafe", "wine-glasses"], resultIds: ["mugs", "carafe", "wine-glasses"] };
      const ambiguous = await run(at("Add"), many);
      assert.equal(ambiguous.operation.status, "needs-input");
      assert.equal(ambiguous.cart, undefined);
    });
    await t.test("verified conversation checkpoint restores enough context for a contextual quick action", async () => {
      const firstUser: ChatMessage = { id: garden.checkpoint.userMessageId, role: "user", parts: [{ type: "text", text: garden.checkpoint.text }] };
      const reply: ChatMessage = { id: "quick-history-reply", role: "assistant", parts: [{ type: "data-shoppingState", data: garden.checkpoint }] };
      const current: ChatMessage = { id: "quick-history-current", role: "user", parts: [{ type: "text", text: at("Refine").text }] };
      const restored = stateFromMessages([firstUser, reply, current], current.id);
      const result = await run(at("Refine"), restored);
      assert.equal(result.checkpoint.after.criteria.productKind, "furniture");
      assert.equal(result.checkpoint.after.criteria.useEnvironment, "outdoor");
      assert.equal(result.checkpoint.after.criteria.maxPrice, 150);
      assert.equal(result.checkpoint.after.criteria.functionalGroup, "seating");
    });
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
