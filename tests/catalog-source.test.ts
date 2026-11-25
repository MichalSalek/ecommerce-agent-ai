import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getStorePolicy, storePolicy } from "../src/domain/catalog/policies";
import { compactProduct } from "../src/application/chat/conversation-context";
import { LanceProductRepository } from "../src/infrastructure/catalog/lance-product-repository";
import { formatPrice } from "../src/lib/money";

// Next resolves the CommonJS default export of next/image when rendering these components.
const require = createRequire(import.meta.url);
const ProductPage: typeof import("../src/app/products/[id]/page").default = require("../src/app/products/[id]/page").default;
const { CartProvider } = require("../src/components/CartProvider") as typeof import("../src/components/CartProvider");
const { ProductResults } = require("../src/components/chat/ProductResults") as typeof import("../src/components/chat/ProductResults");
const { catalogById } = require("../src/data/products") as typeof import("../src/data/products");

test("a changed catalog record supplies retrieval, model evidence, chat cards and the product page", async () => {
  const carafe = catalogById.get("carafe")!;
  const previous = { price: carafe.price, inStock: carafe.inStock };
  const directory = await mkdtemp(join(tmpdir(), "aurelle-source-"));
  try {
    Object.assign(carafe, { price: 37.45, inStock: false });
    const embedding = {
      identity: "catalog-source-test", dimensions: 2,
      embedDocuments: async (texts: string[]) => texts.map(() => [1, 0]),
      embedQuery: async () => [1, 0],
    };
    const repo = new LanceProductRepository(directory, embedding, [carafe]);
    const result = await repo.searchResult({ query: "glass carafe" });
    assert.equal(result.products[0], carafe);
    const evidence = compactProduct(result.products[0]);
    assert.equal(evidence.priceEUR, 37.45);
    assert.equal(evidence.inStock, false);
    assert.equal((await repo.searchResult({ query: "", inStockOnly: true })).totalMatches, 0);

    const detail = await ProductPage({ params: Promise.resolve({ id: carafe.id }) });
    const card = createElement(ProductResults, { output: [{ id: carafe.id, price: 0, inStock: true }] });
    for (const surface of [detail, card]) {
      const rendered = renderToStaticMarkup(createElement(CartProvider, { children: surface }));
      assert.ok(rendered.includes(formatPrice(evidence.priceEUR)));
      assert.match(rendered, /out of stock/i);
    }
  } finally {
    Object.assign(carafe, previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("delivery and return facts have the same values in both policy languages", () => {
  const original = { ...storePolicy };
  try {
    Object.assign(storePolicy, { deliveryPriceEUR: 8, earliestBusinessDay: 3, latestBusinessDay: 6, returnDays: 21 });
    assert.match(getStorePolicy("delivery"), /EUR 8.*3-6/);
    assert.match(getStorePolicy("dostawa", "pl"), /8 EUR.*3 do 6/);
    assert.match(getStorePolicy("returns"), /21 days/);
    assert.match(getStorePolicy("zwroty", "pl"), /21 dni/);
  } finally {
    Object.assign(storePolicy, original);
  }
});
