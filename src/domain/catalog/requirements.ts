import type { Product, ProductSearch } from "./product";
import { products } from "@/data/products";
import { productKinds, productTypes } from "./taxonomy";
import { matchesMaterial } from "./material-facts";
const normalized = (s: string) => s.trim().toLowerCase();
/** Exact catalog properties, never a substring of descriptions or limitations. */
export function meetsFeature(product: Product, feature: string) {
  const key = normalized(feature);
  if (matchesMaterial(product.material, key)) return true;
  return (
    normalized(product.material) === key ||
    product.features.some((value) => normalized(value) === key)
  );
}
export const allowedCriteria = {
  category: [...new Set(products.map((p) => p.category))].sort(),
  productKind: Object.keys(productKinds),
  productType: [...Object.keys(productTypes), "grill", "living-plant"],
};
export function criteriaError(
  criteria: Partial<ProductSearch>,
): { error: string; allowedValues: typeof allowedCriteria } | undefined {
  for (const key of ["category", "productKind", "productType"] as const) {
    if (criteria[key] && !allowedCriteria[key].includes(criteria[key]!))
      return {
        error: `Invalid ${key}: ${criteria[key]}`,
        allowedValues: allowedCriteria,
      };
  }
  for (const key of ["productTypes", "excludeTypes"] as const)
    if (
      criteria[key]?.some(
        (value) => !allowedCriteria.productType.includes(value),
      )
    )
      return { error: `Invalid ${key}`, allowedValues: allowedCriteria };
}
