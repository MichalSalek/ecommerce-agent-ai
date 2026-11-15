import { test } from "node:test";
import assert from "node:assert/strict";
import { products } from "../src/data/products";
import { featureClause } from "../src/application/chat/catalog-language";

function product(id: string) {
  const found = products.find((item) => item.id === id);
  assert.ok(found, `missing ${id}`);
  return found;
}

test("every catalog feature has a specific phrase in both languages", () => {
  assert.equal(products.length, 86);
  for (const item of products) {
    assert.ok(item.features.length >= 2, item.id);
    for (const [index, feature] of item.features.entries()) {
      for (const language of ["pl", "en"] as const) {
        const result = featureClause(item, language, index);
        assert.ok(
          result.trim().length > 3,
          `${item.id}: ${feature} (${language})`,
        );
        assert.doesNotMatch(
          result,
          /^(ma podane wymiary:|has the following dimensions:)/,
          `${item.id}: ${feature} (${language})`,
        );
        assert.doesNotMatch(
          result,
          /[.!?]$/,
          `${item.id}: phrase should compose into a sentence`,
        );
      }
    }
  }
});

test("recommendations distinguish features instead of inventing a tabletop or benefit", () => {
  const chair = product("folding-garden-chair");
  const table = product("outdoor-bistro-table");
  assert.equal(featureClause(chair, "pl"), "ma składaną ramę");
  assert.equal(featureClause(chair, "en"), "has a folding frame");
  assert.equal(featureClause(table, "pl"), "ma okrągły blat");
  assert.equal(
    featureClause(chair, "pl", 1),
    "ma siedzisko i oparcie z listew",
  );
  assert.equal(
    featureClause(product("solar-garden-lantern"), "pl"),
    "ma panel słoneczny",
  );
  assert.equal(featureClause(product("mugs"), "en"), "come as a set of two");
  assert.equal(
    featureClause(product("mugs"), "pl"),
    "jest zestawem dwóch sztuk",
  );
  assert.equal(
    featureClause(product("wireless-headphones"), "en"),
    "connect via Bluetooth",
  );
});

test("an unknown feature falls back to catalog dimensions in the chosen language", () => {
  const item = {
    ...product("carafe"),
    features: ["unknown feature"],
    dimensions: "25 cm high",
  };
  assert.equal(featureClause(item, "pl"), "ma podane wymiary: 25 cm wysokości");
  assert.equal(
    featureClause(item, "en"),
    "has the following dimensions: 25 cm high",
  );
  assert.equal(
    featureClause({ ...item, features: ["constructor"] }, "pl"),
    "ma podane wymiary: 25 cm wysokości",
  );
  assert.equal(
    featureClause(item, "pl", 9),
    "ma podane wymiary: 25 cm wysokości",
  );
});
