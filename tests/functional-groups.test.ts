import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "@huggingface/transformers";
import { products } from "../src/data/products";
import { productTypes } from "../src/domain/catalog/taxonomy";
import {
  expandFunctionalGroup,
  functionalGroupNames,
  groupScopeTypes,
} from "../src/domain/catalog/functional-groups";
import { LanceProductRepository } from "../src/infrastructure/catalog/lance-product-repository";
import {
  TransformerEmbedding,
  embeddingProfiles,
} from "../src/infrastructure/embeddings/transformer-embedding";

env.allowRemoteModels = false;

test("functional groups use canonical taxonomy and scoped catalog types", () => {
  for (const group of functionalGroupNames) {
    const members = expandFunctionalGroup(group);
    assert.ok(members.length > 0);
    assert.equal(new Set(members).size, members.length);
    assert.ok(members.every((type) => Object.hasOwn(productTypes, type)));
    assert.ok(
      members.every((type) => products.some((p) => p.productType === type)),
    );
    assert.deepEqual(
      new Set(groupScopeTypes(group, {}, products)),
      new Set(members),
    );
  }
  assert.deepEqual(
    new Set(
      groupScopeTypes(
        "seating",
        { productKind: "furniture", useEnvironment: "outdoor" },
        products,
      ),
    ),
    new Set(["chair", "bench", "lounger", "sofa"]),
  );
  assert.deepEqual(
    groupScopeTypes("seating", { productKind: "electronics" }, products),
    [],
  );
  assert.deepEqual(
    new Set(groupScopeTypes("music", { category: "Electronics" }, products)),
    new Set(["headphones", "speaker"]),
  );
});

test("real MiniLM and LanceDB intersect functional groups with structural filters", async () => {
  const path = await mkdtemp(join(tmpdir(), "aurelle-functional-groups-"));
  try {
    const repository = new LanceProductRepository(
      path,
      new TransformerEmbedding(".data/models", "minilm"),
      products,
      embeddingProfiles.minilm.maxDistance,
    );
    const base = {
      query: "",
      productKind: "furniture",
      useEnvironment: "outdoor" as const,
      maxPrice: 150,
      limit: 10,
    };
    const furniture = await repository.searchResult(base);
    assert.equal(furniture.totalMatches, 4);
    assert.ok(furniture.products.some((p) => p.id === "outdoor-bistro-table"));

    const seating = { ...base, functionalGroup: "seating" as const };
    const result = await repository.searchResult(seating);
    const expected = new Set([
      "folding-garden-chair",
      "garden-bench",
      "sun-lounger",
    ]);
    assert.equal(result.totalMatches, 3);
    assert.deepEqual(new Set(result.products.map((p) => p.id)), expected);
    assert.equal((await repository.overview(seating)).total, 3);

    // A normal refinement does not exclude earlier cards; only more passes excludeIds.
    const shown = [result.products[0].id];
    const refined = await repository.searchResult(seating);
    assert.ok(refined.products.some((p) => shown.includes(p.id)));
    const next = await repository.searchResult({
      ...seating,
      excludeIds: shown,
    });
    assert.equal(next.totalMatches, 3);
    assert.equal(next.unseenMatches, 2);
    assert.ok(next.products.every((p) => !shown.includes(p.id)));
    const exhausted = await repository.searchResult({
      ...seating,
      excludeIds: [...shown, ...next.products.map((p) => p.id)],
    });
    assert.equal(exhausted.totalMatches, 3);
    assert.equal(exhausted.unseenMatches, 0);
    assert.deepEqual(exhausted.products, []);
    assert.equal(
      (await repository.overview({ ...seating, excludeIds: [...expected] }))
        .total,
      3,
    );

    assert.equal(
      (await repository.searchResult({ ...seating, productType: "sofa" }))
        .totalMatches,
      0,
    );
    const noBench = await repository.searchResult({
      ...seating,
      excludeTypes: ["bench"],
    });
    assert.equal(noBench.totalMatches, 2);
    assert.ok(noBench.products.every((p) => p.productType !== "bench"));
    const explicitTypes = await repository.searchResult({
      ...seating,
      productTypes: ["chair", "table"],
    });
    assert.deepEqual(
      explicitTypes.products.map((p) => p.id),
      ["folding-garden-chair"],
    );
    assert.equal(
      (await repository.searchResult({ ...seating, category: "Electronics" }))
        .totalMatches,
      0,
    );
    assert.equal(
      (
        await repository.searchResult({
          ...seating,
          productKind: "electronics",
        })
      ).totalMatches,
      0,
    );

    const coffee = await repository.searchResult({
      query: "morning coffee",
      functionalGroup: "coffee",
      limit: 10,
    });
    assert.ok(coffee.products.length > 0);
    assert.ok(
      coffee.products.every((p) =>
        expandFunctionalGroup("coffee").includes(p.productType),
      ),
    );
    assert.ok(
      coffee.products.every(
        (p) => p.productType !== "infuser" && p.productType !== "cup",
      ),
    );
    const coffeeOverview = await repository.overview({
      functionalGroup: "coffee",
    });
    assert.ok(coffeeOverview.total > 0);
    assert.ok(
      coffeeOverview.types.every((t) =>
        expandFunctionalGroup("coffee").includes(t.type),
      ),
    );
    assert.ok(
      !coffeeOverview.types.some(
        (t) => t.type === "infuser" || t.type === "cup",
      ),
    );
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
