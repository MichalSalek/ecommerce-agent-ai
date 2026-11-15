import type { ModelMessage } from "ai";
import type { Product } from "@/domain/catalog/product";
import { userText } from "./conversation";

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function mentions(text: string, products: readonly Product[]) {
  const normalized = ` ${normalize(text)} `;
  return products.filter((product) =>
    [product.id, product.name].some((name) =>
      normalized.includes(` ${normalize(name)} `),
    ),
  );
}
export function isCartRequest(text: string) {
  return /\badd\b.*\b(?:cart|basket)\b|dodaj.*koszyk/i.test(text);
}

/** Resolve a named item or an unambiguous follow-up without another semantic search. */
export function productDetailsRequest(
  messages: ModelMessage[],
  products: readonly Product[],
): string | undefined {
  const current = messages.at(-1);
  if (!current || current.role !== "user") return undefined;
  const text = userText(current);
  const detailsIntent =
    /\b(?:details|tell me|everything|all you know)\b|podaj|co wiesz|wszystko|opowiedz|powiedz|wi[eę]cej o/i;
  if (!isCartRequest(text) && !detailsIntent.test(text)) return undefined;
  const direct = mentions(text, products);
  if (direct.length) return direct.length === 1 ? direct[0].id : undefined;
  const refersBack =
    /\b(?:it|this|that|these|those)\b|ten temat|o tym|na temat|tego|tym|niego|podaj.*wszystko/i;
  if (!refersBack.test(text)) return undefined;
  for (const message of messages.slice(0, -1).reverse()) {
    if (message.role === "tool" && Array.isArray(message.content)) {
      for (const part of [...message.content].reverse()) {
        if (part.type !== "tool-result" || part.output.type !== "json")
          continue;
        if (
          part.toolName !== "getProductDetails" &&
          part.toolName !== "searchProducts" &&
          part.toolName !== "compareProducts"
        )
          return undefined;
        const value = part.output.value;
        const rows = Array.isArray(value)
          ? value
          : value &&
              typeof value === "object" &&
              "products" in value &&
              Array.isArray(value.products)
            ? value.products
            : [value];
        const ids = rows.flatMap((row) =>
          typeof row === "object" &&
          row !== null &&
          "id" in row &&
          typeof row.id === "string" &&
          products.some((p) => p.id === row.id)
            ? [row.id]
            : [],
        );
        if (/\b(?:first|pierwsz)/i.test(text)) return ids[0];
        if (/\b(?:second|drug)/i.test(text)) return ids[1];
        return ids.length === 1 ? ids[0] : undefined;
      }
    }
    // Do not cross a later customer topic to recover an older product.
    if (message.role === "user") {
      const previous = mentions(userText(message), products);
      return previous.length === 1 ? previous[0].id : undefined;
    }
  }
}
