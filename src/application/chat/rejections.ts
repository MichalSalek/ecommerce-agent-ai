import { products } from "@/data/products";
import { productTypes } from "@/domain/catalog/taxonomy";
import type { AgentState } from "./shopping-v3";
const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l");
export function verifiedRejections(
  text: string,
  before: AgentState,
  proposed: { productId: string; userQuote: string }[],
) {
  const current = fold(text);
  return proposed.flatMap(({ productId, userQuote }) => {
    const quote = fold(userQuote);
    const product = products.find((row) => row.id === productId);
    if (
      !product ||
      !quote ||
      !current.includes(quote) ||
      !/\b(?:not|no|none|never|without|reject|nie|bez)|zadn/.test(quote)
    )
      return [];
    const named = [
      product.id,
      product.name,
      ...(productTypes[product.productType]?.aliases ?? []),
    ].some((name) => quote.includes(fold(name)));
    const group =
      before.lastIds.includes(productId) &&
      /\b(?:these|those|them|none)|\b(?:te|tych|nich)\b|zadn/.test(quote);
    return named || group ? [productId] : [];
  });
}
