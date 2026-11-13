import { tool } from "ai";
import { z } from "zod";
import type { CatalogService } from "@/application/catalog/catalog-service";
import { getStorePolicy } from "@/domain/catalog/policies";
import {
  searchInput,
  detailsInput,
  policyInput,
  compareInput,
} from "./tool-inputs";
export {
  searchInput,
  detailsInput,
  policyInput,
  compareInput,
} from "./tool-inputs";
export function createShopTools(catalog: CatalogService) {
  return {
    searchProducts: tool({
      description:
        "Search the store by meaning. Use an English query and an optional maximum price in EUR. For browsing use an empty query. maxPrice is a hard ceiling; targetPrice ranks within 20% or EUR 5 around an approximate budget. Never turn around into a hard ceiling. Categories, inStockOnly and exclusions are structured filters.",
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
    compareProducts: tool({
      description:
        "Compare two or three actual catalog products by known IDs. Return factual prices, descriptions and stock only; do not infer quality or material performance.",
      inputSchema: compareInput,
      execute: async ({ productIds }) => {
        console.log("[TOOL] compareProducts", { productIds });
        return catalog.compare(productIds);
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
