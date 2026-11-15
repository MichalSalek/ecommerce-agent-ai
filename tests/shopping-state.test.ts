import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { products } from "../src/data/products";
import {
  conversationContext,
  isCategoriesRequest,
} from "../src/application/chat/conversation";
import {
  interpretNeed,
  mergeNeed,
  shoppingState,
} from "../src/application/chat/shopping-state";
import type { ProductSearch } from "../src/domain/catalog/product";

function call(
  input: ProductSearch & { newSearch?: boolean },
  id = "call",
): ModelMessage {
  return {
    role: "assistant",
    content: [
      { type: "tool-call", toolCallId: id, toolName: "searchProducts", input },
    ],
  };
}
function result(ids: string[], legacy = false, id = "call"): ModelMessage {
  const rows = ids.map((id) => {
    const product = products.find((p) => p.id === id)!;
    // Historic cards predate the new metadata. Canonical IDs remain sufficient to recover them.
    return legacy
      ? {
          id: product.id,
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl,
        }
      : product;
  });
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: id,
        toolName: "searchProducts",
        output: { type: "json", value: rows },
      },
    ],
  };
}

function next(text: string, history: ModelMessage[]) {
  const state = shoppingState(history);
  const need = interpretNeed(text, state);
  return {
    state,
    need,
    criteria: mergeNeed(state, need.patch, need.newSearch, need.more),
  };
}

test("Polish garden refinement and correction rebuild constraints from legacy results", () => {
  const history: ModelMessage[] = [
    { role: "user", content: "Pisz po polsku" },
    { role: "user", content: "Jakie kategorie macie?" },
  ];
  assert.ok(isCategoriesRequest("Jakie kategorie macie?"));
  history.push({ role: "user", content: "Co macie do ogrodu?" });
  const garden = next("Co macie do ogrodu?", history);
  assert.equal(garden.criteria.useEnvironment, "outdoor");
  assert.equal(garden.criteria.category, undefined);
  history.push(
    call(garden.criteria, "garden"),
    result(["planters", "oak-side-table"], true, "garden"),
  );
  history.push({ role: "user", content: "A jakieś meble?" });
  const furniture = next("A jakieś meble?", history);
  assert.equal(furniture.criteria.useEnvironment, "outdoor");
  assert.equal(furniture.criteria.productKind, "furniture");
  assert.equal(furniture.criteria.category, undefined);
  history.push(
    call(furniture.criteria, "furniture"),
    result(["planters", "oak-side-table"], true, "furniture"),
  );
  history.push({
    role: "user",
    content: "Pokaż proszę coś innego, doniczka to nie mebel",
  });
  const correction = next(
    "Pokaż proszę coś innego, doniczka to nie mebel",
    history,
  );
  assert.equal(correction.need.more, true);
  assert.equal(correction.criteria.productKind, "furniture");
  assert.equal(correction.criteria.useEnvironment, "outdoor");
  assert.ok(correction.criteria.excludeTypes?.includes("planter"));
  assert.ok(correction.criteria.excludeIds?.includes("planters"));
  assert.ok(correction.criteria.excludeIds?.includes("oak-side-table"));
  assert.equal(conversationContext(history).language, "pl");
});

test("alternatives exclude every previously shown card and a new topic resets garden constraints", () => {
  const history: ModelMessage[] = [
    { role: "user", content: "Pisz po polsku" },
    call(
      {
        query: "",
        productKind: "furniture",
        useEnvironment: "outdoor",
        newSearch: true,
      },
      "first",
    ),
    result(["outdoor-bistro-table", "folding-garden-chair"], false, "first"),
  ];
  const second = next("A coś innego?", history);
  assert.deepEqual(
    new Set(second.criteria.excludeIds),
    new Set(["outdoor-bistro-table", "folding-garden-chair"]),
  );
  history.push(
    call(second.criteria, "second"),
    result(["garden-bench", "sun-lounger"], false, "second"),
  );
  const third = next("Poproszę kolejne propozycje", history);
  assert.deepEqual(
    new Set(third.criteria.excludeIds),
    new Set([
      "outdoor-bistro-table",
      "folding-garden-chair",
      "garden-bench",
      "sun-lounger",
    ]),
  );
  history.push({ role: "user", content: "Zamiast tego szukam słuchawek" });
  const headphones = next("Zamiast tego szukam słuchawek", history);
  assert.equal(headphones.need.newSearch, true);
  assert.equal(headphones.criteria.productType, "headphones");
  assert.equal(headphones.criteria.productKind, "electronics");
  assert.equal(headphones.criteria.useEnvironment, undefined);
  assert.deepEqual(headphones.criteria.excludeIds, []);
  assert.equal(conversationContext(history).language, "pl");
});

test("negated product types remain exclusions and unsupported products remain explicit", () => {
  const state = shoppingState([]);
  const negative = interpretNeed("Garden furniture without planters", state);
  assert.equal(negative.patch.productKind, "furniture");
  assert.equal(negative.patch.useEnvironment, "outdoor");
  assert.ok(negative.patch.excludeTypes?.includes("planter"));
  for (const [query, type] of [
    ["a grill for the garden", "grill"],
    ["żywe rośliny do ogrodu", "living-plant"],
  ]) {
    assert.equal(interpretNeed(query, state).patch.productType, type);
  }
});

test("an explicit category and conflicting type remain a conflict, and refinements do not repeat cards", () => {
  const state = shoppingState([]);
  const need = interpretNeed("Show furniture in category Garden", state);
  assert.equal(isCategoriesRequest("Show furniture in category Garden"), false);
  assert.equal(need.patch.category, "Garden");
  const criteria = mergeNeed(state, need.patch, need.newSearch, need.more);
  assert.equal(criteria.category, "Garden");
  assert.equal(criteria.categoryExplicit, true);
  assert.equal(criteria.productKind, "furniture");
  state.criteria = {
    query: "",
    category: "Garden",
    categoryExplicit: true,
    useEnvironment: "outdoor",
  };
  const refine = interpretNeed("A jakieś meble?", state);
  assert.equal(mergeNeed(state, refine.patch, false, false).category, "Garden");
  state.shownIds = ["folding-garden-chair"];
  assert.ok(
    mergeNeed(state, { inStockOnly: true }, false, false).excludeIds?.includes(
      "folding-garden-chair",
    ),
  );
});

test("an explicit Polish category keeps the same conflict as its English equivalent", () => {
  const need = interpretNeed(
    "Szukam mebli w kategorii Ogród",
    shoppingState([]),
  );
  assert.equal(need.patch.category, "Garden");
  assert.equal(need.patch.categoryExplicit, true);
  assert.equal(need.patch.productKind, "furniture");
  assert.equal(isCategoriesRequest("Szukam mebli w kategorii Ogród"), false);
});
