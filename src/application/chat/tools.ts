import { tool } from "ai";
import { z } from "zod";
import type { CatalogService } from "@/application/catalog/catalog-service";
import { getStorePolicy } from "@/domain/catalog/policies";
export const searchInput = z.object({
  query: z.string().trim().max(300),
  maxPrice: z.number().finite().nonnegative().optional(),
});
export const detailsInput = z.object({ productId: z.string().min(1).max(100) });
export const policyInput = z.object({ topic: z.string().min(1).max(200) });
export function createShopTools(catalog: CatalogService) {
  return {
    searchProducts: tool({
      description:
        "Search the store by meaning. Use an English query and an optional maximum price in EUR. For budget-only browsing use an empty query.",
      inputSchema: searchInput,
      execute: async (input) => {
        console.log("[TOOL] searchProducts", input);
        const products = await catalog.search(input);
        console.log(`[TOOL] ${products.length} products`);
        return products;
      },
    }),
    getProductDetails: tool({
      description:
        "Get a product's actual price, description and availability by its ID.",
      inputSchema: detailsInput,
      execute: async ({ productId }) => {
        console.log("[TOOL] getProductDetails", { productId });
        return (
          (await catalog.details(productId)) ?? { error: "Product not found." }
        );
      },
    }),
    getPolicy: tool({
      description: "Get the demo store delivery, returns or payment policy.",
      inputSchema: policyInput,
      execute: async ({ topic }) => {
        console.log("[TOOL] getPolicy", { topic });
        return getStorePolicy(topic);
      },
    }),
  };
}
export type ShopTools = ReturnType<typeof createShopTools>;
