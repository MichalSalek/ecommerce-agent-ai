import { z } from "zod";
export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  fullDescription: z.string(),
  productType: z.string(),
  productKind: z.string(),
  useEnvironment: z.enum(["indoor", "outdoor", "both"]),
  material: z.string(),
  dimensions: z.string(),
  features: z.array(z.string()),
  limitations: z.array(z.string()),
  price: z.number().nonnegative(),
  currency: z.literal("EUR"),
  imageUrl: z.string(),
  productUrl: z.string(),
  category: z.string(),
  inStock: z.boolean(),
});
export type Product = z.infer<typeof productSchema>;
export interface ProductSearch {
  query: string;
  maxPrice?: number;
  targetPrice?: number;
  category?: string;
  categoryExplicit?: boolean;
  productKind?: string;
  productType?: string;
  productTypes?: string[];
  useEnvironment?: "indoor" | "outdoor" | "both";
  excludeTypes?: string[];
  requiredFeatures?: string[];
  excludeIds?: string[];
  limit?: number;
  inStockOnly?: boolean;
}
export interface ProductSearchResult {
  products: Product[];
  totalMatches: number;
  unseenMatches: number;
  remainingMatches: number;
  matchedIds?: string[];
}
export interface ProductRepository {
  searchResult(criteria: ProductSearch): Promise<ProductSearchResult>;
  overview(criteria?: Partial<ProductSearch>): Promise<CatalogOverview>;
  search(criteria: ProductSearch): Promise<Product[]>;
  browse(
    maxPrice?: number,
    options?: Omit<ProductSearch, "query" | "maxPrice">,
  ): Promise<Product[]>;
  categories(): Promise<string[]>;
  findById(id: string): Promise<Product | undefined>;
}
export interface CatalogOverview {
  total: number;
  categories: { name: string; count: number }[];
  types: { type: string; kind: string; count: number }[];
}
