import { z } from "zod";
export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
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
  excludeIds?: string[];
  limit?: number;
}
export interface ProductRepository {
  search(criteria: ProductSearch): Promise<Product[]>;
  browse(
    maxPrice?: number,
    options?: Omit<ProductSearch, "query" | "maxPrice">,
  ): Promise<Product[]>;
  categories(): Promise<string[]>;
  findById(id: string): Promise<Product | undefined>;
}
