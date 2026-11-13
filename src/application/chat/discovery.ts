import type { ModelMessage } from "ai";
import type { Product } from "@/domain/catalog/product";
export function comparisonIds(
  text: string,
  shownIds: string[],
  products: readonly Product[],
): string[] | undefined {
  if (!/compar|porówn|porown|różni|rozn|versus|\bvs\b/i.test(text))
    return undefined;
  const normalized = text.toLowerCase();
  const ids = products
    .filter(
      (p) =>
        normalized.includes(p.id) || normalized.includes(p.name.toLowerCase()),
    )
    .map((p) => p.id);
  return ids.length >= 2
    ? ids.slice(0, 3)
    : /these|those|them|te |tych|oba|obydwa|propozycj/i.test(text)
      ? shownIds.slice(-2)
      : [];
}
export function latestResultIds(messages: ModelMessage[]): string[] {
  for (const message of [...messages].reverse())
    if (Array.isArray(message.content))
      for (const part of [...message.content].reverse())
        if (
          part.type === "tool-result" &&
          part.toolName === "searchProducts" &&
          part.output.type === "json" &&
          Array.isArray(part.output.value)
        )
          return part.output.value.flatMap((p) =>
            typeof p === "object" &&
            p !== null &&
            "id" in p &&
            typeof p.id === "string"
              ? [p.id]
              : [],
          );
  return [];
}
export function wantsAvailableOnly(text: string) {
  return /in.stock|available only|only available|tylko dostępn|tylko dostepn/i.test(
    text,
  );
}
export function giftRequest(text: string) {
  return /\bgift\b|prezent/i.test(text);
}
