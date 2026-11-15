import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { products } from "../src/data/products";
import {
  catalogFingerprint,
  indexingDocument,
  LanceProductRepository,
} from "../src/infrastructure/catalog/lance-product-repository";
import {
  embeddingProfiles,
  TransformerEmbedding,
  type EmbeddingProfile,
} from "../src/infrastructure/embeddings/transformer-embedding";

// The positive and counterexample IDs make this a relevance test, not just a non-empty search.
const relevance = [
  {
    category: "Kitchen",
    query: "a ceramic cone for brewing pour-over coffee",
    expected: ["pour-over-dripper"],
    excluded: ["garden-hose", "wireless-headphones"],
  },
  {
    category: "Lighting",
    query: "an adjustable desk lamp for reading",
    expected: ["reading-lamp", "brass-lamp"],
    excluded: ["bookends", "bath-mat"],
  },
  {
    category: "Home",
    query: "a warm wool blanket for a sofa",
    expected: ["wool-throw"],
    excluded: ["garden-bench", "laptop-sleeve"],
  },
  {
    category: "Accessories",
    query: "a compact folding umbrella for rain",
    expected: ["compact-umbrella"],
    excluded: ["garden-hose", "soap-dispenser"],
  },
  {
    category: "Garden",
    query: "hand trowel for planting in soil",
    expected: ["hand-trowel"],
    excluded: ["outdoor-bistro-table", "wireless-headphones"],
  },
  {
    category: "Bathroom",
    query: "a refillable ceramic soap dispenser with pump",
    expected: ["soap-dispenser"],
    excluded: ["mugs", "garden-gloves"],
  },
  {
    category: "Furniture",
    query: "a two-seat outdoor patio sofa with cushions",
    expected: ["patio-sofa"],
    excluded: ["planters", "oak-side-table"],
  },
  {
    category: "Storage",
    query: "a low zippered bag for storage under a bed",
    expected: ["under-bed-storage"],
    excluded: ["canvas-tote", "garden-bench"],
  },
  {
    category: "Electronics",
    query: "wireless over-ear headphones for listening to music",
    expected: ["wireless-headphones"],
    excluded: ["garden-hand-rake", "wine-glasses"],
  },
  {
    category: "Wellness",
    query: "a foam roller for exercise and massage",
    expected: ["foam-roller"],
    excluded: ["bath-mat", "kitchen-timer"],
  },
] as const;

for (const profile of ["minilm", "bge"] as EmbeddingProfile[]) {
  test(`${profile}: real encoder and LanceDB respect relevance, structural constraints and counts`, async (t) => {
    const path = await mkdtemp(join(tmpdir(), `aurelle-shopping-${profile}-`));
    try {
      const embedding = new TransformerEmbedding(".data/models", profile);
      const repository = new LanceProductRepository(
        path,
        embedding,
        products,
        embeddingProfiles[profile].maxDistance,
      );
      for (const sample of relevance) {
        await t.test(
          `${sample.category}: expected product and counterexamples`,
          async () => {
            const found = await repository.searchResult({
              query: sample.query,
              limit: 2,
            });
            const ids = found.products.map((p) => p.id);
            assert.ok(
              sample.expected.some((id) => ids.includes(id)),
              `${sample.category}: expected ${sample.expected.join(" or ")}, got ${ids.join(", ")}`,
            );
            assert.ok(
              sample.excluded.every((id) => !ids.includes(id)),
              `${sample.category}: unexpected ${ids.join(", ")}`,
            );
          },
        );
      }
      await t.test(
        "exact outdoor furniture and exhaustive non-repeating pages",
        async () => {
          const criteria = {
            query: "",
            productKind: "furniture",
            useEnvironment: "outdoor" as const,
            limit: 2,
          };
          const seen: string[] = [];
          const expected = new Set([
            "outdoor-bistro-table",
            "folding-garden-chair",
            "garden-bench",
            "sun-lounger",
            "patio-sofa",
            "garden-storage-bench",
          ]);
          for (let page = 0; page < 3; page++) {
            const result = await repository.searchResult({
              ...criteria,
              excludeIds: seen,
            });
            assert.equal(result.totalMatches, 6);
            assert.equal(result.unseenMatches, 6 - 2 * page);
            assert.equal(result.remainingMatches, 4 - 2 * page);
            assert.equal(result.products.length, 2);
            for (const product of result.products) {
              assert.ok(expected.has(product.id));
              assert.ok(!seen.includes(product.id));
              seen.push(product.id);
            }
          }
          assert.deepEqual(new Set(seen), expected);
          const end = await repository.searchResult({
            ...criteria,
            excludeIds: seen,
          });
          assert.deepEqual(end.products, []);
          assert.deepEqual(
            [end.totalMatches, end.unseenMatches, end.remainingMatches],
            [6, 0, 0],
          );
        },
      );
      await t.test(
        "hard price, approximate target, exclusions and unconfirmed attributes",
        async () => {
          const base = {
            query: "",
            productKind: "furniture",
            useEnvironment: "outdoor" as const,
            limit: 12,
          };
          const max = await repository.searchResult({ ...base, maxPrice: 80 });
          assert.deepEqual(
            new Set(max.products.map((p) => p.id)),
            new Set(["folding-garden-chair", "outdoor-bistro-table"]),
          );
          const target = await repository.searchResult({
            ...base,
            targetPrice: 100,
          });
          assert.ok(target.products.some((p) => p.price > 100));
          assert.ok(
            target.products.every((p) => p.price >= 80 && p.price <= 120),
          );
          const withoutBenches = await repository.searchResult({
            ...base,
            excludeTypes: ["bench"],
          });
          assert.equal(withoutBenches.totalMatches, 4);
          assert.ok(
            withoutBenches.products.every((p) => p.productType !== "bench"),
          );
          for (const requiredFeatures of [
            ["waterproof"],
            ["certified"],
            ["waterproof", "certified"],
          ]) {
            const unsupported = await repository.searchResult({
              ...base,
              requiredFeatures,
            });
            assert.equal(
              unsupported.totalMatches,
              0,
              requiredFeatures.join(", "),
            );
            assert.deepEqual(
              unsupported.products,
              [],
              requiredFeatures.join(", "),
            );
          }
        },
      );
      await t.test(
        "unsupported merchandise cannot become a loosely related result",
        async () => {
          for (const productType of ["grill", "living-plant"]) {
            const found = await repository.searchResult({
              query: "",
              productType,
              useEnvironment: "outdoor",
            });
            assert.equal(found.totalMatches, 0, productType);
            assert.deepEqual(found.products, [], productType);
          }
        },
      );
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });
}

test("fingerprint includes the encoder, full catalog and actual indexing documents", () => {
  const identity = "encoder-a";
  const fingerprint = catalogFingerprint(products, identity);
  const expected = createHash("sha256")
    .update(
      JSON.stringify({
        embedding: identity,
        catalog: products,
        documents: products.map((p) => [
          `${p.name}. ${p.description}`,
          indexingDocument(p),
        ]),
        representation: "normalized-field-mean-v1",
      }),
    )
    .digest("hex")
    .slice(0, 16);
  assert.equal(fingerprint, expected);
  assert.notEqual(fingerprint, catalogFingerprint(products, "encoder-b"));
  const modified = products.map((p, i) =>
    i === 0 ? { ...p, features: [...p.features, "new indexed feature"] } : p,
  );
  assert.notEqual(indexingDocument(products[0]), indexingDocument(modified[0]));
  assert.notEqual(fingerprint, catalogFingerprint(modified, identity));
  const priceOnly = products.map((p, i) =>
    i === 0 ? { ...p, price: p.price + 1 } : p,
  );
  assert.equal(indexingDocument(products[0]), indexingDocument(priceOnly[0]));
  assert.notEqual(fingerprint, catalogFingerprint(priceOnly, identity));
});
