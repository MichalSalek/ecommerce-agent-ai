import { z } from "zod";
export const searchInput = z.object({
  query: z.string().trim().max(300),
  maxPrice: z.number().finite().nonnegative().optional(),
  targetPrice: z.number().finite().nonnegative().optional(),
  category: z.string().max(80).optional(),
  categoryExplicit: z.boolean().optional(),
  productKind: z.string().max(80).optional(),
  productType: z.string().max(80).optional(),
  productTypes: z.array(z.string().min(1).max(80)).min(1).max(100).optional(),
  useEnvironment: z.enum(["indoor", "outdoor", "both"]).optional(),
  excludeTypes: z.array(z.string().max(80)).max(100).optional(),
  requiredFeatures: z.array(z.string().min(1).max(100)).max(8).optional(),
  newSearch: z.boolean().optional(),
  excludeIds: z.array(z.string().max(100)).max(100).optional(),
  limit: z.number().int().min(1).max(12).optional(),
  inStockOnly: z.boolean().optional(),
});
export const detailsInput = z.object({ productId: z.string().min(1).max(100) });
export const policyInput = z.object({ topic: z.string().min(1).max(200) });

export const compareInput = z.object({
  productIds: z
    .array(z.string().min(1).max(100))
    .min(2)
    .max(10)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Choose distinct products.",
    ),
});
