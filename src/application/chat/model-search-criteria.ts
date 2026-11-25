import { z } from "zod";
import { criteriaSchema, transitionSchema } from "./shopping-v3";

// This is a model wire format only. Null means an omitted optional field; it
// never becomes part of the stored search state or changes an existing filter.
const modelCriteriaWireSchema = criteriaSchema
  .omit({
    category: true,
    categoryExplicit: true,
    productKind: true,
    productType: true,
    productTypes: true,
    excludeTypes: true,
  })
  .extend({
    query: z.string().max(300).nullable().optional().describe(
      "English semantic query; empty for structural browsing.",
    ),
    functionalGroup: criteriaSchema.shape.functionalGroup.nullable().optional().describe(
      "Complete functional group for a named need.",
    ),
    maxPrice: criteriaSchema.shape.maxPrice.nullable().optional(),
    targetPrice: criteriaSchema.shape.targetPrice.nullable().optional(),
    useEnvironment: criteriaSchema.shape.useEnvironment.nullable().optional(),
    requiredFeatures: criteriaSchema.shape.requiredFeatures.nullable().optional(),
    inStockOnly: criteriaSchema.shape.inStockOnly.nullable().optional(),
  })
  .strict();

export function omitNullModelFields<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined)) as {
    [K in keyof T]: Exclude<T[K], null>
  };
}

export const modelCriteriaSchema = modelCriteriaWireSchema.transform(omitNullModelFields);

// Providers can serialize an unspecified optional argument as null, including the
// transition around the criteria. The domain schema remains the authority for values.
export const modelTransitionSchema = transitionSchema.omit({ rejectedIds: true }).extend({
  scope: transitionSchema.shape.scope.nullable(),
  remove: transitionSchema.shape.remove.nullable(),
  requestedCount: transitionSchema.shape.requestedCount.nullable(),
  preferences: transitionSchema.shape.preferences.nullable(),
  persistentPreferences: transitionSchema.shape.persistentPreferences.nullable(),
  criteria: modelCriteriaSchema,
});
