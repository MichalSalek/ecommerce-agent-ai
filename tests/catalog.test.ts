import { guardProductAnswer } from "../src/application/chat/instructions";
import { CatalogService } from "../src/application/catalog/catalog-service";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { products } from "../src/data/products";
import { BgeEmbedding } from "../src/infrastructure/embeddings/bge-embedding";
import { LanceProductRepository } from "../src/infrastructure/catalog/lance-product-repository";
import {
  parseJsonObject,
  actionSchema,
} from "../src/infrastructure/chat/json-protocol";

test("real embeddings, semantic ranking, budget, persistence and catalog refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aurelle-lance-"));
  try {
    const embedding = new BgeEmbedding(".data/models");
    const repository = new LanceProductRepository(
      directory,
      embedding,
      products,
    );
    const service = new CatalogService(repository);
    const pricedCoffee = await service.search({
      query: "something for my morning coffee under EUR 25",
      maxPrice: 25,
    });
    assert.ok(pricedCoffee.length > 0);
    assert.ok(
      pricedCoffee.every(
        (p) =>
          p.price <= 25 &&
          ["carafe", "mugs", "travel-mug", "pour-over-dripper"].includes(p.id),
      ),
    );
    const warm = await repository.search({
      query: "something to keep me warm on the sofa",
    });
    assert.equal(warm[0]?.id, "wool-throw"); // No matching words in the product name.
    const coffee = await repository.search({
      query: "a vessel for my morning coffee",
      maxPrice: 20,
    });
    assert.ok(["carafe", "pour-over-dripper"].includes(coffee[0]?.id));
    assert.ok(coffee.some((p) => p.id === "carafe"));
    assert.ok(coffee.every((p) => p.price <= 20 && p.currency === "EUR"));
    assert.deepEqual(
      await repository.search({ query: "a spaceship engine" }),
      [],
    );
    assert.deepEqual(
      await repository.search({ query: "coffee", maxPrice: 0 }),
      [],
    );
    await assert.rejects(
      repository.search({ query: "coffee", maxPrice: NaN }),
      RangeError,
    );
    const reopened = new LanceProductRepository(directory, embedding, products);
    assert.deepEqual(
      await reopened.search({
        query: "a vessel for my morning coffee",
        maxPrice: 20,
      }),
      coffee,
    );
    const changed = products.map((p) =>
      p.id === "carafe" ? { ...p, price: 99 } : p,
    );
    const refreshed = new LanceProductRepository(directory, embedding, changed);
    assert.ok(
      (
        await refreshed.search({
          query: "a vessel for my morning coffee",
          maxPrice: 20,
        })
      ).every((p) => p.id !== "carafe"),
    );
    assert.equal((await refreshed.findById("carafe"))?.price, 99);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("JSON protocol handles escaped braces and rejects invalid tools and inputs", () => {
  assert.deepEqual(
    parseJsonObject('```json\n{"text":"a } and \\"quoted\\" word"}\n```'),
    { text: 'a } and "quoted" word' },
  );
  assert.deepEqual(parseJsonObject('{"text":"first"}{"text":"second"}'), {
    text: "first",
  });
  assert.throws(() => parseJsonObject('{"text":"unfinished'));
  assert.equal(
    actionSchema.safeParse({ tool: "shell", input: {} }).success,
    false,
  );
  assert.equal(
    actionSchema.safeParse({
      tool: "searchProducts",
      input: { query: "coffee", maxPrice: -1 },
    }).success,
    false,
  );
});

test("the assistant never presents invented dollar prices", () => {
  assert.ok(!guardProductAnswer("Buy mugs at $22").includes("$"));
  assert.equal(
    guardProductAnswer("Try our ceramic mugs."),
    "Try our ceramic mugs.",
  );
});
