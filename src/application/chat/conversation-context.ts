import type { ModelMessage } from "ai";
import { catalogById } from "@/data/products";
import type { Product } from "@/domain/catalog/product";
import type { Language } from "./assistant-text";
import { comparisonFactOptions } from "./comparison-facts";

/** Bounded, role-labelled conversation data; product facts always come from the catalog. */
export function conversationContext(
  history: ModelMessage[] = [],
  groups: { userText: string; productIds: string[] }[] = [],
) {
  const messages: ModelMessage[] = history
    .filter((message) =>
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" && !!message.content.trim(),
    )
    .slice(-12)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: (message.content as string).slice(0, 600),
    }));
  const priorGroups = groups.slice(-6).flatMap((group) => {
    const ids = [...new Set(group.productIds)].slice(0, 10);
    const records = ids.flatMap((id) => { const product = catalogById.get(id); return product ? [product] : []; });
    return records.length
      ? [{ request: group.userText.slice(0, 300), products: records.map((p) => ({ id: p.id, name: p.name })) }]
      : [];
  });
  return { messages, priorGroups };
}

export const compactProduct = (p: Product, detail = false) => ({
  id: p.id,
  name: p.name,
  priceEUR: p.price,
  inStock: p.inStock,
  features: detail ? p.features : p.features.slice(0, 2),
  ...(detail
    ? {
        material: p.material,
        dimensions: p.dimensions,
        description: p.fullDescription,
        limitations: p.limitations,
      }
    : {}),
});

/** Optional wording sees canonical records and the shopper's relevant requests, never previous model claims as evidence. */
export function catalogAdviceContext(
  request: string,
  ids: string[],
  language: Language,
  stage: "detail" | "comparison" | "advice" | "search",
  history: ModelMessage[],
  originalRequest?: string,
) {
  const previousRequests = stage === "comparison"
    ? [...new Set([
        ...history.flatMap((message) => message.role === "user" && typeof message.content === "string" ? [message.content] : []),
        ...(originalRequest ? [originalRequest] : []),
      ])].slice(-4).map((text) => text.slice(0, 240))
    : [];
  return {
    request,
    ...(previousRequests.length ? { previousShopperRequests: previousRequests } : {}),
    records: ids.flatMap((id, index) => {
      const product = catalogById.get(id);
      if (!product) return [];
      const { name, material, features, limitations, description, dimensions, productType, useEnvironment } = product;
      return [{
        name, material, features, limitations,
        ...(stage === "comparison" ? { decisionReasons: comparisonFactOptions(product, language) } : {}),
        ...(stage === "search" ? {
          priceEUR: product.price,
          inStock: product.inStock,
          ...(index < 5 ? { shoppingReasons: comparisonFactOptions(product, language).slice(0, 2).map((option) => option.statement) } : {}),
        } : {}),
        ...(stage === "detail" ? { description, dimensions, productType, useEnvironment } : {}),
      }];
    }),
  };
}
