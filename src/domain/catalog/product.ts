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
}
export interface ProductRepository {
  search(criteria: ProductSearch): Promise<Product[]>;
  findById(id: string): Promise<Product | undefined>;
}
