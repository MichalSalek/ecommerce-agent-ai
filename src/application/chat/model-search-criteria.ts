import { z } from "zod";
import { criteriaSchema } from "./shopping-v3";

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

type ModelCriteriaWire = typeof modelCriteriaWireSchema._output;
type ModelCriteria = { [K in keyof ModelCriteriaWire]: Exclude<ModelCriteriaWire[K], null> };

export const modelCriteriaSchema = modelCriteriaWireSchema.transform(
  (criteria): ModelCriteria =>
    Object.fromEntries(
      Object.entries(criteria).filter(([, value]) => value !== null && value !== undefined),
    ) as ModelCriteria,
);
