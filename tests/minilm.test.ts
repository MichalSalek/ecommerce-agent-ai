import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { products } from "../src/data/products";
import {
  TransformerEmbedding,
  embeddingProfiles,
} from "../src/infrastructure/embeddings/transformer-embedding";
import { LanceProductRepository } from "../src/infrastructure/catalog/lance-product-repository";
test("smaller CPU encoder retrieves relevant coffee/music products and rejects unrelated intent", async () => {
  const path = await mkdtemp(join(tmpdir(), "aurelle-minilm-"));
  try {
    const embedding = new TransformerEmbedding(".data/models", "minilm");
    const r = new LanceProductRepository(
      path,
      embedding,
      products,
      embeddingProfiles.minilm.maxDistance,
    );
    assert.notEqual(
      embedding.identity,
      new TransformerEmbedding(".data/models", "bge").identity,
    );
    const coffee = await r.search({ query: "morning coffee", maxPrice: 25, productTypes: ["mug", "carafe", "coffee-dripper", "coffee-grinder", "kettle", "scale"] });
    assert.ok(coffee.length >= 2 && coffee.length <= 5);
    assert.ok(
      coffee.every((p) =>
        ["carafe", "mugs", "pour-over-dripper", "travel-mug"].includes(p.id),
      ),
    );
    const music = await r.search({
      query: "listen to music without cables",
      maxPrice: 50,
    });
    assert.ok(music.some((p) => p.id === "portable-speaker"));
    assert.ok(music.every((p) => p.price <= 50));
    assert.deepEqual(await r.search({ query: "a spaceship engine" }), []);

  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
