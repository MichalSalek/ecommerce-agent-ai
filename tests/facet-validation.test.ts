import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialAgentState,
  transitionState,
} from "../src/application/chat/shopping-v3";
import { resolveExplicitFacets } from "../src/application/chat/explicit-facets";
const before = initialAgentState();
test("hard facet proofs reject implicit subtype narrowing and decorative adjectives", () => {
  const previous = {
    ...before,
    criteria: {
      productTypes: ["chair", "bench", "sofa", "stool", "lounger"],
      productKind: "furniture",
    },
  };
  const bad = resolveExplicitFacets(
    "I need something to sit on",
    previous,
    { operation: "refine", language: "en", criteria: {} },
    [
      { facet: "type", value: "sofa" },
      { facet: "type", value: "stool" },
    ],
  );
  assert.ok("error" in bad);
  for (const text of [
    "something decorative",
    "coś dekoracyjnego",
    "coś ozdobnego",
  ]) {
    assert.ok(
      "error" in
        resolveExplicitFacets(
          text,
          before,
          { operation: "new", language: "en", criteria: {} },
          [{ facet: "kind", value: "decor" }],
        ),
    );
  }
  const real = resolveExplicitFacets(
    "only sofas",
    before,
    { operation: "new", language: "en", criteria: {} },
    [{ facet: "type", value: "sofa", userQuote: "sofas" }],
  );
  assert.ok("change" in real);
  assert.deepEqual(real.change?.criteria.productTypes, ["sofa"]);
});
test("canonical groups preserve scope and unrelated groups cannot leak into a new kind", () => {
  const coffee = {
    ...before,
    criteria: { functionalGroup: "coffee" as const, query: "morning coffee" },
  };
  const changed = resolveExplicitFacets(
    "A jakieś meble?",
    coffee,
    { operation: "refine", language: "pl", criteria: {} },
    [{ facet: "kind", value: "furniture", userQuote: "meble" }],
  );
  assert.ok("change" in changed);
  const after = transitionState(coffee, changed.change!);
  assert.equal(after.criteria.functionalGroup, undefined);
  assert.equal(after.criteria.query, "");
  assert.equal(after.criteria.productKind, "furniture");
  const group = resolveExplicitFacets(
    "Chcę coś do siedzenia",
    before,
    {
      operation: "new",
      language: "pl",
      criteria: { functionalGroup: "seating" },
    },
    [],
  );
  assert.ok("change" in group);
  const unasked = resolveExplicitFacets(
    "Show garden furniture",
    before,
    {
      operation: "new",
      language: "en",
      criteria: { functionalGroup: "seating" },
    },
    [{ facet: "kind", value: "furniture" }],
  );
  assert.ok("error" in unasked);
  const category = resolveExplicitFacets(
    "W kategorii Kuchnia",
    before,
    { operation: "new", language: "pl", criteria: {} },
    [{ facet: "category", value: "Kitchen", userQuote: "Kuchnia" }],
  );
  assert.ok("change" in category);
});
