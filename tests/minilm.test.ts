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
import { clearShoppingRequest } from "../src/application/chat/shopping-intent";
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
    const intent = clearShoppingRequest(
      "I need something for my morning coffee",
    );
    assert.ok(intent);
    const coffee = await r.search({ ...intent, maxPrice: 25 });
    assert.equal(coffee.length, 2);
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
    assert.equal(
      clearShoppingRequest("I need medical advice about coffee"),
      undefined,
    );
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
