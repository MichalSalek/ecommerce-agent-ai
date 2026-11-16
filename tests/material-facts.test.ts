import { test } from "node:test";
import assert from "node:assert/strict";
import { products } from "../src/data/products";
import {
  MATERIAL_FACTS,
  matchesMaterial,
} from "../src/domain/catalog/material-facts";

const material = (id: string) => {
  const product = products.find((item) => item.id === id);
  assert.ok(product, `Missing catalog product ${id}`);
  return product.material;
};

test("reviewed members refer to actual catalog material labels", () => {
  const labels = new Set(products.map((product) => product.material));
  for (const [base, members] of Object.entries(MATERIAL_FACTS)) {
    assert.equal(
      new Set(members).size,
      members.length,
      `${base}: duplicate label`,
    );
    for (const member of members)
      assert.ok(labels.has(member), `${base}: unknown label ${member}`);
  }
});

test("base classes include verified compositions and full labels still match", () => {
  const cases = [
    ["mugs", "ceramic"],
    ["dinner-plates", "ceramic"],
    ["planters", "ceramic"],
    ["amber-vase", "glass"],
    ["glass-food-box", "glass"],
    ["garden-bench", "wooden"],
    ["garden-bench", "steel"],
    ["garden-bench", "metal"],
    ["outdoor-bistro-table", "steel"],
    ["phone-stand", "aluminum"],
    ["brass-pen", "brass"],
    ["canvas-tote", "cotton"],
    ["canvas-tote", "fabric"],
    ["linen-cushion", "linen"],
    ["notebooks", "paper"],
    ["outdoor-string-lights", "plastic"],
  ];
  for (const [id, requirement] of cases)
    assert.ok(
      matchesMaterial(material(id), requirement),
      `${id}: ${requirement}`,
    );
  for (const product of products)
    assert.ok(
      matchesMaterial(product.material.toUpperCase(), ` ${product.material} `),
      product.id,
    );
});

test("finishes, unknown labels and unrelated requirements do not imply a material", () => {
  assert.ok(matchesMaterial(material("brass-lamp"), "metal"));
  assert.equal(matchesMaterial(material("brass-lamp"), "brass"), false);
  assert.equal(matchesMaterial(material("glass-food-box"), "wood"), false);
  assert.equal(matchesMaterial(material("yoga-mat"), "wood"), false);
  assert.equal(
    matchesMaterial(material("outdoor-string-lights"), "metal"),
    false,
  );
  assert.equal(matchesMaterial("wood-look composite", "wood"), false);
  assert.equal(matchesMaterial("unknown ceramic composite", "ceramic"), false);
  assert.equal(matchesMaterial(material("mugs"), "constructor"), false);
  assert.equal(matchesMaterial(material("mugs"), "__proto__"), false);
  for (const product of products) {
    assert.equal(
      matchesMaterial(product.material, "waterproof"),
      false,
      product.id,
    );
    assert.equal(
      matchesMaterial(product.material, "certified"),
      false,
      product.id,
    );
  }
  assert.equal(matchesMaterial("", ""), false);
});
