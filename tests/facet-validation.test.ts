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

test("explicit bilingual kind survives when omitted from model facets", () => {
  for (const [text, language] of [
    ["Show me garden furniture under EUR 150", "en"],
    ["Could you show me garden furniture under EUR 150?", "en"],
    ["I would like garden furniture under EUR 150", "en"],
    ["I am looking for furniture under EUR 150", "en"],
    ["Pokaż meble ogrodowe do 150 EUR", "pl"],
  ] as const) {
    const result = resolveExplicitFacets(
      text,
      before,
      {
        operation: "new",
        language,
        criteria: {
          query: "garden furniture",
          maxPrice: 150,
          useEnvironment: "outdoor",
        },
      },
      [],
    );
    assert.ok("change" in result && result.change);
    assert.deepEqual(result.change.criteria, {
      query: "garden furniture",
      maxPrice: 150,
      useEnvironment: "outdoor",
      productKind: "furniture",
    });
    assert.equal(result.change.criteria.functionalGroup, undefined);
    assert.equal(result.change.criteria.productTypes, undefined);
  }
});

test("implicit kind recovery requires positive, unambiguous current evidence", () => {
  const run = (text: string, query = "garden furniture") =>
    resolveExplicitFacets(
      text,
      before,
      { operation: "new", language: "en", criteria: { query } },
      [],
    );
  for (const text of [
    'Show garden products; "furniture" was just an example',
    "If I wanted furniture, what would I choose?",
    "Show garden products, not furniture",
    "I don't want furniture",
    "Furniture is not wanted",
    "A plant pot is not furniture.",
    "A cover for furniture",
  ]) {
    const result = run(text);
    assert.ok(
      "error" in result || result.change.criteria.productKind === undefined,
      text,
    );
  }
  for (const text of [
    "Show furniture and mugs",
    "Show furniture and lighting",
  ]) {
    const result = run(text);
    assert.ok(
      "error" in result || result.change.criteria.productKind === undefined,
      text,
    );
  }
  const corrected = run(
    "A plant pot is not furniture. Show outdoor furniture.",
  );
  assert.ok("change" in corrected && corrected.change);
  assert.equal(corrected.change.criteria.productKind, "furniture");
  const bare = run("Show garden products", "garden");
  assert.ok("change" in bare && bare.change);
  assert.equal(bare.change.criteria.productKind, undefined);
  const decorative = run("Show something decorative", "decorative");
  assert.ok("change" in decorative && decorative.change);
  assert.equal(decorative.change.criteria.productKind, undefined);
});

test("existing or explicit type scopes are not overwritten by inferred kind", () => {
  const active = { ...before, criteria: { productKind: "gardening" } };
  const result = resolveExplicitFacets(
    "Find furniture",
    active,
    { operation: "refine", language: "en", criteria: { query: "furniture" } },
    [],
  );
  assert.ok("change" in result && result.change);
  assert.equal(result.change.criteria.productKind, undefined);
  const conflict = resolveExplicitFacets(
    "Furniture and mugs",
    before,
    { operation: "new", language: "en", criteria: { query: "furniture mugs" } },
    [{ facet: "type", value: "mug" }],
  );
  assert.ok("error" in conflict);
});
