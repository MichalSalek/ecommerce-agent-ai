import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialAgentState,
  transitionState,
} from "../src/application/chat/shopping-v3";
import { resolveExplicitFacets } from "../src/application/chat/explicit-facets";
import { parseSearchIntent } from "../src/application/catalog/search-intent";
const before = initialAgentState();
test("a named use such as seating keeps the entire functional group and the previous ceiling", () => {
  const state = { ...before, criteria: { productKind: "furniture", useEnvironment: "outdoor" as const, maxPrice: 150 } };
  const result = resolveExplicitFacets("Szukam czegoś do siedzenia.", state,
    { operation: "refine", language: "pl", criteria: { query: "garden furniture", useEnvironment: "outdoor" } },
    [{ facet: "kind", value: "furniture" }, { facet: "type", value: "seating" }]);
  assert.ok(result.change);
  const next = transitionState(state, result.change);
  assert.equal(next.criteria.functionalGroup, "seating");
  assert.equal(next.criteria.maxPrice, 150);
  assert.equal(next.criteria.useEnvironment, "outdoor");
  assert.equal(next.criteria.productType, undefined);
  const negative = resolveExplicitFacets("I do not want seating.", before,
    { operation: "new", language: "en", criteria: {} }, [{ facet: "type", value: "seating" }]);
  assert.ok(negative.error);
});
test("a grounded furniture kind survives a model's accidental department label", () => {
  for (const value of ["Furniture", "furniture"]) {
    const result = resolveExplicitFacets("Pokaż meble ogrodowe do 150 EUR.", before,
      { operation: "new", language: "pl", criteria: { query: "garden furniture", useEnvironment: "outdoor" } },
      [{ facet: "category", value }]);
    assert.ok(result.change);
    assert.equal(result.change.criteria.productKind, "furniture");
    assert.equal(result.change.criteria.maxPrice, 150);
    assert.equal(result.change.criteria.category, undefined);
  }
  const unrelated = resolveExplicitFacets("Pokaż pokrowiec na meble.", before,
    { operation: "new", language: "pl", criteria: { query: "cover for furniture" } },
    [{ facet: "category", value: "furniture" }]);
  assert.ok("error" in unrelated);
});
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

test("current EUR upper bound corrects omitted or wrong model budget", () => {
  for (const [text, language, amount] of [
    ["Show me garden furniture under EUR150", "en", 150],
    ["Pokaż meble ogrodowe do 150 EUR", "pl", 150],
    ["Show products at most €125.50", "en", 125.5],
    ["Pokaż produkty nie więcej niż 125,50 euro", "pl", 125.5],
  ] as const) {
    for (const wrong of [undefined, 90]) {
      const result = resolveExplicitFacets(
        text,
        before,
        {
          operation: "new",
          language,
          criteria: {
            query: "garden furniture",
            useEnvironment: "outdoor",
            maxPrice: wrong,
            targetPrice: 200,
          },
          remove: ["maxPrice", "targetPrice"],
        },
        [],
      );
      assert.ok("change" in result && result.change);
      assert.equal(result.change.criteria.maxPrice, amount);
      assert.equal(result.change.criteria.targetPrice, undefined);
      assert.ok(!result.change.remove?.includes("maxPrice"));
      assert.equal(
        transitionState(before, result.change).criteria.maxPrice,
        amount,
      );
      assert.equal(result.change.criteria.useEnvironment, "outdoor");
    }
  }
});

test("explicit counts and stock constraints survive missing model fields", () => {
  for (const [text, count] of [
    ["Show 4 products under EUR 150", 4],
    ["Show five options", 5],
    ["Show 10 products", 10],
    ["Pokaż 20 propozycji", 20],
    ["Pokaż do 20 produktów", 20],
    ["Show up to 10 coffee products", 10],
    ["Show all products", 1000],
    ["Pokaż wszystkie produkty", 1000],
    ["Show everything", 1000],
  ] as const) {
    const result = resolveExplicitFacets(
      text,
      before,
      {
        operation: "new",
        language: "en",
        criteria: { query: "garden" },
      },
      [],
    );
    assert.ok("change" in result && result.change);
    assert.equal(result.change.requestedCount, count, text);
    if (/do 20|up to 10/.test(text))
      assert.equal(result.change.criteria.maxPrice, undefined);
  }
  for (const text of [
    "Show only in-stock products",
    "Pokaż tylko dostępne produkty",
  ]) {
    const result = resolveExplicitFacets(
      text,
      before,
      {
        operation: "refine",
        language: "en",
        criteria: { query: "garden", inStockOnly: false },
        remove: ["inStockOnly"],
      },
      [],
    );
    assert.ok("change" in result && result.change);
    assert.equal(result.change.criteria.inStockOnly, true);
    assert.ok(!result.change.remove?.includes("inStockOnly"));
  }
  const boundedCount = resolveExplicitFacets(
    "Show up to 10 coffee products",
    before,
    {
      operation: "new",
      language: "en",
      criteria: {
        query: "up to 10 coffee products",
        functionalGroup: "coffee",
      },
    },
    [],
  );
  assert.ok("change" in boundedCount && boundedCount.change);
  assert.equal(
    parseSearchIntent({ query: boundedCount.change.criteria.query ?? "" })
      .maxPrice,
    undefined,
  );
});

test("constraint projection ignores quotes, negations, units and ambiguous limits", () => {
  for (const text of [
    'Show products; "under 150 EUR" was an example',
    "Show products not under 150 EUR",
    "If I wanted products under 150 EUR, show them",
    "Show products for 20 people under 150 EUR",
    "Show products below 20 cm",
  ]) {
    const result = resolveExplicitFacets(
      text,
      before,
      { operation: "new", language: "en", criteria: { query: "products" } },
      [],
    );
    assert.ok("change" in result && result.change);
    assert.equal(result.change.requestedCount, undefined, text);
    assert.equal(
      result.change.criteria.maxPrice,
      text.includes("20 people") ? 150 : undefined,
      text,
    );
  }
  for (const text of [
    "Show products under USD 150",
    "Show products under 150 PLN",
    "Show products below £150",
    "Show products under $150",
  ]) {
    const result = resolveExplicitFacets(
      text,
      before,
      {
        operation: "new",
        language: "en",
        criteria: { query: "products", maxPrice: 150 },
      },
      [],
    );
    assert.ok("error" in result, text);
  }
  const ambiguous = resolveExplicitFacets(
    "Show products under 100 EUR and below 150 EUR",
    before,
    { operation: "new", language: "en", criteria: { query: "products" } },
    [],
  );
  assert.ok("error" in ambiguous);
  for (const text of [
    'Show products; "only in stock" was an example',
    "Show products, not only in stock",
  ]) {
    const result = resolveExplicitFacets(
      text,
      before,
      { operation: "new", language: "en", criteria: { query: "products" } },
      [],
    );
    assert.ok("change" in result && result.change);
    assert.equal(result.change.criteria.inStockOnly, undefined);
  }
  const coffee = resolveExplicitFacets(
    "Show coffee products",
    before,
    {
      operation: "new",
      language: "en",
      criteria: { query: "coffee", functionalGroup: "coffee" },
    },
    [],
  );
  assert.ok("change" in coffee && coffee.change);
  assert.deepEqual(coffee.change.criteria, {
    query: "coffee",
    functionalGroup: "coffee",
  });
  assert.equal(coffee.change.requestedCount, undefined);
});
test("structural constraints do not become fictitious product features", () => {
  const result = resolveExplicitFacets(
    "Show garden furniture under EUR 150",
    before,
    {
      operation: "new",
      language: "en",
      criteria: {
        query: "furniture",
        useEnvironment: "outdoor",
        requiredFeatures: ["garden", "furniture", "waterproof"],
      },
    },
    [],
  );
  assert.ok(result.change);
  assert.equal(result.change.criteria.productKind, "furniture");
  assert.deepEqual(result.change.criteria.requiredFeatures, ["waterproof"]);
  const indoor = resolveExplicitFacets(
    "Show indoor furniture",
    before,
    {
      operation: "new",
      language: "en",
      criteria: {
        query: "furniture",
        useEnvironment: "indoor",
        requiredFeatures: ["garden"],
      },
    },
    [],
  );
  assert.ok(indoor.change);
  assert.deepEqual(indoor.change.criteria.requiredFeatures, ["garden"]);
});
