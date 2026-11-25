import { test } from "node:test";
import assert from "node:assert/strict";
import { asSchema } from "ai";
import { nativeTools } from "../src/application/chat/native-tools";
import { modelCriteriaSchema } from "../src/application/chat/model-search-criteria";
import { criteriaSchema } from "../src/application/chat/shopping-v3";

const nullable = {
  query: null,
  functionalGroup: null,
  maxPrice: null,
  targetPrice: null,
  useEnvironment: null,
  requiredFeatures: null,
  inStockOnly: null,
};

test("optional model criteria accept null without putting it in domain state", () => {
  assert.deepEqual(modelCriteriaSchema.parse(nullable), {});
  assert.deepEqual(modelCriteriaSchema.parse({}), {});
  assert.deepEqual(modelCriteriaSchema.parse({ maxPrice: 0, inStockOnly: false }), { maxPrice: 0, inStockOnly: false });
  const parsed = modelCriteriaSchema.parse({
    ...nullable,
    functionalGroup: "coffee",
    maxPrice: 25,
    inStockOnly: false,
    requiredFeatures: [],
  });
  assert.deepEqual(parsed, { functionalGroup: "coffee", maxPrice: 25, inStockOnly: false, requiredFeatures: [] });
  assert.deepEqual(criteriaSchema.parse(parsed), parsed);
  assert.equal(criteriaSchema.safeParse({ maxPrice: null }).success, false);
});

test("nullable wire criteria retain original validation and forbidden keys", () => {
  for (const criteria of [
    { category: "Kitchen" },
    { productKind: "furniture" },
    { productType: "chair" },
    { productTypes: ["chair"] },
    { excludeTypes: ["chair"] },
    { categoryExplicit: true },
    { unknown: null },
    { maxPrice: "25" },
    { maxPrice: -1 },
    { targetPrice: -1 },
    { functionalGroup: "unknown" },
    { useEnvironment: "outside" },
    { requiredFeatures: [null] },
    { inStockOnly: "true" },
  ]) assert.equal(modelCriteriaSchema.safeParse(criteria).success, false, JSON.stringify(criteria));
});

test("AI SDK sends nullable optional model criteria and returns normalized parsed data", async () => {
  const schema = asSchema(nativeTools.searchProducts.inputSchema);
  const json = await schema.jsonSchema;
  const criteria = (json.properties as Record<string, any>).criteria;
  assert.equal(criteria.additionalProperties, false);
  for (const name of Object.keys(nullable)) {
    const prop = criteria.properties[name];
    assert.ok(prop, `Missing criteria.${name}`);
    assert.ok(!criteria.required?.includes(name), `Required criteria.${name}`);
    assert.ok(
      (Array.isArray(prop.type) && prop.type.includes("null")) ||
      prop.anyOf?.some((option: { type?: string }) => option.type === "null"),
      `criteria.${name} must allow null in the provider schema`,
    );
  }
  const validation = await schema.validate!({
    operation: "new",
    scope: null, requestedCount: null, remove: null, preferences: null, persistentPreferences: null, explicitFilters: null, rejections: null,
    language: "pl",
    criteria: { ...nullable, functionalGroup: "coffee" },
    mode: "recommend",
    continueWith: "presentAnswer",
  });
  assert.ok(validation.success);
  assert.deepEqual(validation.value.criteria, { functionalGroup: "coffee" });
  for (const name of ["scope", "requestedCount", "remove", "preferences", "persistentPreferences", "explicitFilters", "rejections"]) {
    assert.equal(name in validation.value, false);
    const prop = (json.properties as Record<string, any>)[name];
    assert.ok(prop.type?.includes("null") || prop.anyOf?.some((choice: {type: string}) => choice.type === "null"), name);
  }
  const bad = await schema.validate!({ operation: null, language: "pl", mode: "recommend", criteria: {}, continueWith: "presentAnswer" });
  assert.equal(bad.success, false);
});
