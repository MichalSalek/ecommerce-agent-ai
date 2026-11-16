import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSearchIntent } from "../src/application/catalog/search-intent";

test("generic store browsing stays structural instead of becoming an embedding query", () => {
  for (const query of [
    "any products from the store",
    "show me products from this shop",
    "all items in your collection",
  ])
    assert.equal(parseSearchIntent({ query }).query, "", query);
});
test("store words do not erase a specific product need or a price cap", () => {
  assert.equal(
    parseSearchIntent({ query: "coffee from the store" }).query,
    "coffee from the store",
  );
  const intent = parseSearchIntent({
    query: "products from the store under EUR 25",
  });
  assert.equal(intent.query, "");
  assert.equal(intent.maxPrice, 25);
});
