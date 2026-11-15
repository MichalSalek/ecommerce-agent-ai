import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { products } from "../src/data/products";
import { productSchema } from "../src/domain/catalog/product";
import { productKinds, productTypes } from "../src/domain/catalog/taxonomy";

// Baseline from the original 48-product catalog.
const originalProducts: Array<[string, number, boolean, string]> = [
  ["mugs", 22, true, "/images/products/mugs.webp"],
  ["carafe", 19, true, "/images/products/carafe.webp"],
  ["walnut-board", 29, true, "/images/products/walnut-board.webp"],
  ["dinner-plates", 24, true, "/images/products/dinner-plates.webp"],
  ["cutlery", 17, true, "/images/products/cutlery.webp"],
  ["brass-lamp", 59, true, "/images/products/brass-lamp.webp"],
  ["lantern-lamp", 39, true, "/images/products/lantern-lamp.webp"],
  ["linen-cushion", 22, true, "/images/products/linen-cushion.webp"],
  ["wool-throw", 55, true, "/images/products/wool-throw.webp"],
  ["candle", 14, true, "/images/products/candle.webp"],
  ["vase-01", 32, true, "/images/products/vase-01.webp"],
  ["notebooks", 12, true, "/images/products/notebooks.webp"],
  ["brass-pen", 9, true, "/images/products/brass-pen.webp"],
  ["baskets", 34, true, "/images/products/baskets.webp"],
  ["planters", 16, true, "/images/products/planters.webp"],
  ["watering-can", 19, true, "/images/products/watering-can.webp"],
  ["waffle-towels", 27, false, "/images/products/waffle-towels.webp"],
  ["wine-glasses", 22, true, "/images/products/wine-glasses.webp"],
  ["oak-side-table", 89, true, "/images/products/oak-side-table.webp"],
  ["boucle-chair", 249, true, "/images/products/boucle-chair.webp"],
  ["wall-shelf", 45, true, "/images/products/wall-shelf.webp"],
  ["bath-stool", 49, true, "/images/products/bath-stool.webp"],
  ["diffuser", 18, true, "/images/products/diffuser.webp"],
  ["amber-vase", 25, true, "/images/products/amber-vase.webp"],
  ["bookends", 28, true, "/images/products/bookends.webp"],
  [
    "wireless-headphones",
    69,
    true,
    "/images/products/wireless-headphones.webp",
  ],
  ["portable-speaker", 39, true, "/images/products/portable-speaker.webp"],
  ["compact-keyboard", 49, false, "/images/products/compact-keyboard.webp"],
  ["wireless-mouse", 19, true, "/images/products/wireless-mouse.webp"],
  ["usb-c-hub", 35, true, "/images/products/usb-c-hub.webp"],
  [
    "wireless-charging-pad",
    24,
    true,
    "/images/products/wireless-charging-pad.webp",
  ],
  ["power-bank", 29, true, "/images/products/power-bank.webp"],
  ["phone-stand", 15, true, "/images/products/phone-stand.webp"],
  ["desk-organizer", 23, true, "/images/products/desk-organizer.webp"],
  ["laptop-sleeve", 26, true, "/images/products/laptop-sleeve.webp"],
  ["canvas-tote", 14, true, "/images/products/canvas-tote.webp"],
  ["compact-umbrella", 21, true, "/images/products/compact-umbrella.webp"],
  ["travel-mug", 24, true, "/images/products/travel-mug.webp"],
  ["coffee-grinder", 39, true, "/images/products/coffee-grinder.webp"],
  ["pour-over-dripper", 18, true, "/images/products/pour-over-dripper.webp"],
  [
    "digital-coffee-scale",
    29,
    true,
    "/images/products/digital-coffee-scale.webp",
  ],
  ["gooseneck-kettle", 45, true, "/images/products/gooseneck-kettle.webp"],
  ["tea-infuser", 9, true, "/images/products/tea-infuser.webp"],
  ["glass-food-box", 16, true, "/images/products/glass-food-box.webp"],
  ["kitchen-timer", 12, true, "/images/products/kitchen-timer.webp"],
  ["garden-gloves", 11, true, "/images/products/garden-gloves.webp"],
  ["pruning-shears", 22, true, "/images/products/pruning-shears.webp"],
  ["yoga-mat", 42, false, "/images/products/yoga-mat.webp"],
];

test("catalog preserves original identities, prices, stock and photographs", () => {
  assert.equal(products.length, 86);
  assert.equal(new Set(products.map(({ id }) => id)).size, 86);
  for (const [id, price, inStock, imageUrl] of originalProducts) {
    const product = products.find((item) => item.id === id);
    assert.ok(product, `missing original product: ${id}`);
    assert.deepEqual(
      [product.price, product.inStock, product.imageUrl],
      [price, inStock, imageUrl],
      id,
    );
  }
  const counts = Object.fromEntries(
    [...new Set(products.map((p) => p.category))].map((category) => [
      category,
      products.filter((p) => p.category === category).length,
    ]),
  );
  assert.deepEqual(counts, {
    Kitchen: 14,
    Lighting: 8,
    Home: 8,
    Accessories: 8,
    Garden: 8,
    Bathroom: 8,
    Furniture: 8,
    Storage: 8,
    Electronics: 8,
    Wellness: 8,
  });
});

test("all products carry consistent concrete specifications and canonical taxonomy", () => {
  for (const product of products) {
    assert.ok(productSchema.safeParse(product).success, product.id);
    assert.ok(
      product.fullDescription.length > product.description.length,
      product.id,
    );
    assert.ok(product.material.trim() && product.dimensions.trim(), product.id);
    assert.ok(
      product.features.length >= 2 && product.features.every(Boolean),
      product.id,
    );
    assert.ok(
      product.limitations.length && product.limitations.every(Boolean),
      product.id,
    );
    assert.equal(
      productTypes[product.productType]?.kind,
      product.productKind,
      product.id,
    );
    assert.ok(productKinds[product.productKind], product.id);
  }
  for (const [id, type] of Object.entries(productTypes)) {
    assert.ok(productKinds[type.kind], id);
    assert.ok(type.en && type.pl && type.aliases.length, id);
  }
  for (const [id, kind] of Object.entries(productKinds))
    assert.ok(kind.en && kind.pl && kind.aliases.length, id);
});

test("outdoor furniture is distinct from indoor tables and indoor planters", () => {
  const furniture = products.filter(
    (p) => p.productKind === "furniture" && p.useEnvironment !== "indoor",
  );
  assert.deepEqual(Object.fromEntries(furniture.map((p) => [p.id, p.price])), {
    "outdoor-bistro-table": 79,
    "folding-garden-chair": 49,
    "garden-bench": 129,
    "sun-lounger": 119,
    "patio-sofa": 249,
    "garden-storage-bench": 159,
  });
  assert.equal(
    products.find((p) => p.id === "oak-side-table")?.useEnvironment,
    "indoor",
  );
  assert.equal(
    products.find((p) => p.id === "planters")?.useEnvironment,
    "indoor",
  );
  assert.equal(
    products.find((p) => p.id === "planters")?.productKind,
    "gardening",
  );
  for (const id of ["wall-shelf", "bath-stool", "shoe-rack"])
    assert.equal(products.find((p) => p.id === id)?.productKind, "furniture");
});

test("every added product has one recorded prompt and a prepared WebP", async () => {
  const prompts: Array<{ id: string; prompt: string }> = JSON.parse(
    await readFile(
      new URL("../docs/PRODUCT_IMAGE_PROMPTS.json", import.meta.url),
      "utf8",
    ),
  );
  const originalIds = new Set(originalProducts.map(([id]) => id));
  const added = products.filter(({ id }) => !originalIds.has(id));
  assert.equal(prompts.length, 38);
  assert.deepEqual(
    new Set(prompts.map(({ id }) => id)),
    new Set(added.map(({ id }) => id)),
  );
  const provenance: {
    images: { id: string; prompt: string; bytes: number }[];
  } = JSON.parse(
    await readFile(
      new URL("../docs/IMAGE_GENERATION.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(provenance.images.length, added.length);
  for (const { id, prompt } of prompts) {
    assert.match(prompt, /photorealistic/i, id);
    assert.match(prompt, /\bno\b[^.]*\blogos\b/i, id);
    const recorded = provenance.images.find((image) => image.id === id);
    assert.equal(recorded?.prompt, prompt, id);
    const photo = await readFile(
      new URL(`../public/images/products/${id}.webp`, import.meta.url),
    );
    assert.equal(photo.toString("ascii", 0, 4), "RIFF", id);
    assert.equal(photo.toString("ascii", 8, 12), "WEBP", id);
    assert.equal(photo.byteLength, recorded?.bytes, id);
    assert.ok(photo.byteLength > 1000 && photo.byteLength < 150000, id);
    assert.equal(
      products.find((p) => p.id === id)?.imageUrl,
      `/images/products/${id}.webp`,
    );
  }
});
