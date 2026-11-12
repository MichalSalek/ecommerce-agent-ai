import type { ProductSearch } from "@/domain/catalog/product";
export function parseSearchIntent(criteria: ProductSearch): ProductSearch {
  const budget =
    /\b(?:under|below|up to|less than)\s*(?:EUR|€)?\s*(\d+(?:[.,]\d+)?)\s*(?:EUR|euros?)?/i;
  const match = criteria.query.match(budget);
  const maxPrice =
    criteria.maxPrice ??
    (match ? Number(match[1].replace(",", ".")) : undefined);
  const query = criteria.query
    .replace(budget, " ")
    .replace(/[?!.]/g, " ")
    .trim();
  const generic =
    /^(?:(?:what|can|i|buy|could|do|you|have|show|me|some|any|all|the|your|products?|items?|things?|options?|available|please|find|something|for|a|are|there)\s*)*$/i;
  return { query: generic.test(query) ? "" : query, maxPrice };
}
export function budgetBrowseRequest(text: string): ProductSearch | undefined {
  const intent = parseSearchIntent({ query: text });
  return intent.maxPrice !== undefined && intent.query === ""
    ? intent
    : undefined;
}
