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
      query: (text.startsWith("Show") || text.startsWith("Could") || text.includes("ogrodowe")) ? "" : "garden furniture",
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

test("seating refinement keeps a previous garden kind when the model repeats it as a department", () => {
  const previous = { ...before, criteria: { productKind: "furniture", useEnvironment: "outdoor" as const, maxPrice: 150 } };
  for (const [text, language] of [["Tylko miejsca do siedzenia.", "pl"], ["Only things to sit on.", "en"]] as const) {
    const result = resolveExplicitFacets(text, previous, {
      operation: "refine", language,
      criteria: { query: "outdoor garden furniture", requiredFeatures: ["seating"], useEnvironment: "outdoor" },
    }, [{ facet: "category", value: "furniture" }]);
    assert.ok(result.change);
    assert.equal(result.change.criteria.functionalGroup, "seating");
    assert.equal(result.change.criteria.category, undefined);
    assert.deepEqual(result.change.criteria.requiredFeatures, []);
  }
  const fresh = resolveExplicitFacets("Only things to sit on.", previous, {
    operation: "new", language: "en", criteria: { query: "seating" },
  }, [{ facet: "category", value: "furniture" }]);
  assert.ok(fresh.error);
});

test("a provider-selected department label can express an explicitly named kind without a semantic query", () => {
  const chosen = [{ facet: "category" as const, value: "Furniture" }];
  const query = { operation: "new" as const, language: "pl" as const, criteria: { maxPrice: 150, useEnvironment: "outdoor" as const } };
  for (const question of ["Pokaż meble ogrodowe do 150 EUR.", "Show outdoor furniture under EUR 150."]) {
    const result = resolveExplicitFacets(question, before, query, chosen);
    assert.ok(result.change, question);
    assert.equal(result.change.criteria.productKind, "furniture");
    assert.equal(result.change.criteria.category, undefined);
    assert.equal(result.change.criteria.maxPrice, 150);
  }
  assert.ok(resolveExplicitFacets("Nie chcę mebli.", before, query, chosen).error);
  const department = resolveExplicitFacets("Pokaż kategorię Furniture.", before, query, chosen);
  assert.equal(department.change?.criteria.category, "Furniture");
});

test("a suggested stock filter requires a shopping request for availability or a carried criterion", () => {
  const stock = (request: string, state = before, operation: "new" | "refine" = "new") =>
    resolveExplicitFacets(request, state, { operation, language: "pl", criteria: { inStockOnly: true } }, []).change;
  assert.equal(stock("Pokaż tylko produkty do 25 EUR.")?.criteria.inStockOnly, undefined);
  assert.equal(stock("Pokaż dostępne krzesła.")?.criteria.inStockOnly, true);
  const active = { ...before, criteria: { inStockOnly: true } };
  assert.equal(stock("Pokaż tylko produkty do 25 EUR.", active, "refine")?.criteria.inStockOnly, true);
  assert.equal(stock("Zacznij od początku, pokaż kubki.", active)?.criteria.inStockOnly, undefined);
});

test("a shopping need without a price does not establish a new hard budget", () => {
  const invented = { maxPrice: 50, targetPrice: 30, inStockOnly: true };
  const fresh = resolveExplicitFacets("Which mug should I choose for tea?", before,
    { operation: "new", language: "en", criteria: invented }, []).change!;
  assert.equal(fresh.criteria.maxPrice, undefined);
  assert.equal(fresh.criteria.targetPrice, undefined);
  const active = { ...before, criteria: { maxPrice: 25 } };
  const refine = resolveExplicitFacets("Tylko kubki.", active,
    { operation: "refine", language: "pl", criteria: invented }, []).change!;
  assert.equal(transitionState(active, refine).criteria.maxPrice, 25);
});

test("actual 120B garden category mistakes recover the user's outdoor furniture scope", () => {
  const change = { operation: "new" as const, language: "pl" as const, criteria: { inStockOnly: true, maxPrice: 150 }, requestedCount: 5 };
  for (const value of ["meble ogrodowe", "Garden", "Furniture"]) {
    const result = resolveExplicitFacets("Pokaż meble ogrodowe do 150 EUR.", before, change, [{ facet: "category", value }]);
    assert.ok(result.change, value);
    assert.equal(result.change.criteria.productKind, "furniture");
    assert.equal(result.change.criteria.useEnvironment, "outdoor");
    assert.equal(result.change.criteria.maxPrice, 150);
    assert.equal(result.change.criteria.inStockOnly, undefined);
    assert.equal(result.change.criteria.category, undefined);
    assert.equal(result.change.criteria.query, "");
  }
  for (const text of ["Show outdoor furniture under 150 EUR.", "Show garden furniture under 150 EUR.", "Pokaż meble do ogrodu do 150 EUR."]) {
    const result = resolveExplicitFacets(text, before, change, []);
    assert.ok(result.change, text);
    assert.equal(result.change.criteria.productKind, "furniture", text);
    assert.equal(result.change.criteria.useEnvironment, "outdoor", text);
    assert.equal(result.change.criteria.maxPrice, 150, text);
  }
});

test("garden furniture recovery does not broaden negations, accessories or ambiguous scopes", () => {
  const query = { operation: "new" as const, language: "en" as const, criteria: {} };
  for (const text of [
    "Show a cover for garden furniture.",
    "Show a tablecloth for garden furniture.",
    "Szukam czegoś do mebli ogrodowych.",
    "Show outdoor furniture tables.",
    "Pokaż pokrowiec na meble ogrodowe.",
    "Show outdoor furniture and lighting.",
    "Pokaż meble ogrodowe lub doniczki.",
    "Do not show outdoor furniture.",
    "Nie chcę mebli ogrodowych.",
    "Show indoor furniture.",
    "Show furniture for indoor and outdoor use.",
    'Show products like "outdoor furniture".',
  ]) {
    const result = resolveExplicitFacets(text, before, query, [{ facet: "category", value: "Garden" }]);
    assert.ok("error" in result, text);
    assert.notEqual(result.change?.criteria.productKind, "furniture", text);
    if (!text.includes("indoor furniture") && !text.includes('"')) {
      const noFacet = resolveExplicitFacets(text, before, query, []);
      assert.ok("error" in noFacet, `Unresolved scope: ${text}`);
    }
  }
  const explicit = resolveExplicitFacets("Show outdoor furniture from the Garden category.", before, query, [{ facet: "category", value: "Garden" }]);
  assert.equal(explicit.change?.criteria.category, "Garden");
  const conflict = resolveExplicitFacets("Show outdoor furniture.", before, { ...query, criteria: { useEnvironment: "indoor" as const } }, []);
  assert.ok("error" in conflict);
});

test("captured 120B first turn reaches a real structural catalog search", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { products } = await import("../src/data/products");
  const { CatalogService } = await import("../src/application/catalog/catalog-service");
  const { LanceProductRepository } = await import("../src/infrastructure/catalog/lance-product-repository");
  const directory = await mkdtemp(join(tmpdir(), "aurelle-garden-replay-"));
  const vectors = { identity: "garden-structural-replay-v1", dimensions: 2, embedDocuments: async (texts: string[]) => texts.map(() => [1, 0]), embedQuery: async () => [1, 0] };
  try {
    const catalog = new CatalogService(new LanceProductRepository(directory, vectors, products));
    for (const value of ["meble ogrodowe", "Garden"]) {
      const model = { operation: "new" as const, language: "pl" as const, criteria: { inStockOnly: true, maxPrice: 150 }, requestedCount: 5 };
      const resolved = resolveExplicitFacets("Pokaż meble ogrodowe do 150 EUR.", before, model, [{ facet: "category", value }]);
      assert.ok(resolved.change);
      const state = transitionState(before, resolved.change);
      const found = await catalog.searchResult({ query: "", ...state.criteria, limit: 10 });
      const expected = products.filter((product) => product.productKind === "furniture" && ["outdoor", "both"].includes(product.useEnvironment) && product.price <= 150);
      assert.ok(expected.length > 0);
      assert.equal(found.totalMatches, expected.length);
      assert.deepEqual(new Set(found.products.map((product) => product.id)), new Set(expected.map((product) => product.id)));
      assert.equal(state.criteria.inStockOnly, undefined);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("captured functional search changes preserve the existing scope and distinguish alternatives", () => {
  const state = { ...before, criteria: { query: "", productKind: "furniture", useEnvironment: "outdoor" as const, maxPrice: 150 }, shownIds: ["folding-garden-chair"], lastIds: ["folding-garden-chair"], resultIds: ["folding-garden-chair"], requestedCount: 10, preferences: ["durable"], rejectedIds: ["garden-bench"] };
  const raw = { operation: "new" as const, language: "pl" as const, criteria: { functionalGroup: "seating" as const, inStockOnly: true, maxPrice: 150, useEnvironment: "outdoor" as const }, requestedCount: 5, preferences: [] };
  const first = resolveExplicitFacets("Szukam czegoś do siedzenia.", state, raw, []);
  assert.equal(first.change?.operation, "refine");
  const refined = transitionState(state, first.change!);
  assert.equal(refined.criteria.productKind, "furniture");
  assert.equal(refined.criteria.maxPrice, 150);
  assert.equal(refined.criteria.useEnvironment, "outdoor");
  assert.equal(refined.criteria.inStockOnly, undefined);
  assert.equal(refined.requestedCount, 10);
  assert.deepEqual(refined.preferences, ["durable"]);
  assert.deepEqual(refined.rejectedIds, ["garden-bench"]);
  const next = resolveExplicitFacets("Pokaż inne propozycje do siedzenia.", refined, raw, []);
  assert.equal(next.change?.operation, "more");
  assert.equal(transitionState(refined, next.change!).criteria.maxPrice, 150);
  const omitted = resolveExplicitFacets("Pokaż inne propozycje do siedzenia.", refined, { ...raw, criteria: {} }, []);
  assert.equal(omitted.change?.operation, "more");
  assert.equal(omitted.change?.criteria.functionalGroup, "seating");
});

test("a simple seating follow-up retains the inherited kind and budget when the model repeats a facet", () => {
  const state = { ...before, criteria: { productKind: "furniture", useEnvironment: "outdoor" as const, maxPrice: 150 }, shownIds: ["garden-bench"], lastIds: ["garden-bench"] };
  for (const facet of [{ facet: "kind" as const, value: "furniture" }, { facet: "category" as const, value: "Furniture" }]) {
    const result = resolveExplicitFacets("Szukam czegoś do siedzenia.", state, { operation: "new", language: "pl", criteria: { functionalGroup: "seating", maxPrice: 150, useEnvironment: "outdoor" } }, [facet]);
    assert.equal(result.error, undefined);
    assert.equal(result.change?.operation, "refine");
    const actual = transitionState(state, result.change!);
    assert.equal(actual.criteria.productKind, "furniture");
    assert.equal(actual.criteria.maxPrice, 150);
    assert.equal(actual.criteria.category, undefined);
  }
});

test("functional transition correction leaves resets, switches, negations and extra requirements for interpretation", () => {
  const state = { ...before, criteria: { productKind: "furniture", useEnvironment: "outdoor" as const, maxPrice: 150 }, shownIds: ["folding-garden-chair"], lastIds: ["folding-garden-chair"], resultIds: ["folding-garden-chair"] };
  const raw = { operation: "new" as const, language: "pl" as const, criteria: { functionalGroup: "seating" as const } };
  for (const text of ["Nie pokazuj innych propozycji do siedzenia.", "Szukam czegoś do siedzenia bez ławek.", "Zacznij od nowa, szukam czegoś do siedzenia.", "Szukam czegoś do siedzenia z drewna.", "Szukam czegoś do siedzenia i kawy."]) {
    const result = resolveExplicitFacets(text, state, raw, []);
    assert.notEqual(result.change?.operation, "more", text);
    assert.notEqual(result.change?.operation, "refine", text);
  }
  const switched = resolveExplicitFacets("Pokaż coś do siedzenia w kategorii Kitchen.", state, raw, [{ facet: "category", value: "Kitchen" }]);
  assert.notEqual(switched.change?.operation, "refine");
  const indoor = resolveExplicitFacets("Szukam czegoś do siedzenia wewnątrz.", state, { ...raw, criteria: { ...raw.criteria, useEnvironment: "indoor" as const } }, []);
  assert.notEqual(indoor.change?.operation, "refine");
});

test("redundant structural garden queries do not narrow the canonical assortment", () => {
  for (const query of ["garden furniture", "outdoor furniture"]) {
    const result = resolveExplicitFacets("Pokaż meble ogrodowe do 150 EUR.", before, { operation: "new", language: "pl", criteria: { query, maxPrice: 150 } }, []);
    assert.ok(result.change);
    assert.equal(result.change.criteria.query, "");
    assert.equal(result.change.criteria.productKind, "furniture");
    assert.equal(result.change.criteria.useEnvironment, "outdoor");
  }
  const specific = resolveExplicitFacets("Pokaż drewniane meble ogrodowe do 150 EUR.", before, { operation: "new", language: "pl", criteria: { query: "wooden garden furniture" } }, []);
  assert.equal(specific.change?.criteria.query, "wooden garden furniture");
});

test("captured garden to seating to alternatives preserves filters against the canonical catalog", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { products } = await import("../src/data/products");
  const { CatalogService } = await import("../src/application/catalog/catalog-service");
  const { LanceProductRepository } = await import("../src/infrastructure/catalog/lance-product-repository");
  const directory = await mkdtemp(join(tmpdir(), "aurelle-garden-chain-"));
  const vectors = { identity: "garden-chain-test-v1", dimensions: 2, embedDocuments: async (texts: string[]) => texts.map(() => [1, 0]), embedQuery: async () => [1, 0] };
  try {
    const catalog = new CatalogService(new LanceProductRepository(directory, vectors, products));
    const first = resolveExplicitFacets("Pokaż meble ogrodowe do 150 EUR.", before,
      { operation: "new", language: "pl", criteria: { query: "garden furniture", maxPrice: 150, inStockOnly: true }, requestedCount: 5 }, []);
    assert.ok(first.change);
    let state = transitionState(before, first.change);
    const initial = await catalog.searchResult({ query: "", ...state.criteria, limit: 5 });
    const allEligible = products.filter((product) => product.productKind === "furniture" && ["outdoor", "both"].includes(product.useEnvironment) && product.price <= 150);
    assert.equal(initial.totalMatches, allEligible.length);
    assert.equal(initial.totalMatches, 4);
    const fullScope = await catalog.overview({ productKind: "furniture", useEnvironment: "outdoor" });
    assert.equal(fullScope.total, 6);
    state = { ...state, shownIds: initial.products.map((p) => p.id), lastIds: initial.products.map((p) => p.id), resultIds: initial.products.map((p) => p.id), rejectedIds: ["garden-bench"] };
    const model = { operation: "new" as const, language: "pl" as const, criteria: { functionalGroup: "seating" as const, inStockOnly: true, maxPrice: 150, useEnvironment: "outdoor" as const }, requestedCount: 5 };
    const refine = resolveExplicitFacets("Szukam czegoś do siedzenia.", state, model, []);
    assert.equal(refine.change?.operation, "refine");
    state = transitionState(state, refine.change!);
    const seating = await catalog.searchResult({ query: "", ...state.criteria, limit: 10, excludeIds: state.rejectedIds });
    assert.ok(seating.products.length > 0);
    assert.ok(seating.products.every((p) => p.price <= 150 && p.productKind === "furniture" && ["outdoor", "both"].includes(p.useEnvironment)));
    assert.ok(!seating.products.some((p) => p.id === "garden-bench"));
    state = { ...state, shownIds: [...new Set([...state.shownIds, ...seating.products.map((p) => p.id)])], lastIds: seating.products.map((p) => p.id), resultIds: seating.products.map((p) => p.id) };
    const more = resolveExplicitFacets("Pokaż inne propozycje do siedzenia.", state, model, []);
    assert.equal(more.change?.operation, "more");
    state = transitionState(state, more.change!);
    const remaining = await catalog.searchResult({ query: "", ...state.criteria, limit: 10, excludeIds: [...new Set([...state.shownIds, ...state.rejectedIds])] });
    assert.ok(remaining.products.every((p) => !state.shownIds.includes(p.id) && !state.rejectedIds.includes(p.id) && p.price <= 150));
    assert.equal(state.criteria.maxPrice, 150);
    assert.equal(state.criteria.productKind, "furniture");
    assert.equal(state.criteria.useEnvironment, "outdoor");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a named product type can be searched without a model-invented use or kind", () => {
  const request = "Budżet to 43 EUR, szukam kubka do granatowego termosu";
  const raw = { operation: "new" as const, language: "pl" as const, criteria: { query: "kubek", maxPrice: 43, functionalGroup: "coffee" as const } };
  for (const facets of [[], [{ facet: "kind" as const, value: "kitchenware" }]]) {
    const result = resolveExplicitFacets(request, before, raw, facets);
    assert.equal(result.error, undefined);
    assert.equal(result.change?.criteria.functionalGroup, undefined);
    assert.equal(result.change?.criteria.query, "mug");
    assert.equal(result.change?.criteria.maxPrice, 43);
  }
  assert.equal(resolveExplicitFacets("Szukam kubka do kawy.", before, raw, []).change?.criteria.functionalGroup, "coffee");
  assert.ok(resolveExplicitFacets("Szukam pokrowca do kubka.", before, raw, []).error);
  assert.ok(resolveExplicitFacets("Nie chcę kubka.", before, raw, []).error);
});
