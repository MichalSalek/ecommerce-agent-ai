import { tool } from "ai";
import { z } from "zod";
import type { CatalogService } from "@/application/catalog/catalog-service";
import { getStorePolicy } from "@/domain/catalog/policies";
import { searchInput, detailsInput, policyInput } from "./tool-inputs";
export { searchInput, detailsInput, policyInput } from "./tool-inputs";
export function createShopTools(catalog: CatalogService) {
  return {
    searchProducts: tool({
      description:
        "Search the store by meaning. Use an English query and an optional maximum price in EUR. For browsing use an empty query. maxPrice is a hard ceiling; targetPrice ranks within 20% or EUR 5 around an approximate budget. Never turn around into a hard ceiling. Categories and exclusions are structured filters.",
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
    getCategories: tool({
      description: "List actual catalog categories.",
      inputSchema: z.object({}),
      execute: async () => {
        console.log("[TOOL] getCategories");
        return catalog.categories();
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
