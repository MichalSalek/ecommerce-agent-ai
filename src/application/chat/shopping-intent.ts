import type { ProductSearch } from "@/domain/catalog/product";
// The primary demo journey is explicit purchase intent: show real options before narrowing it.
export function clearShoppingRequest(text: string): ProductSearch | undefined {
  if (
    /medical|health advice|medycz|zdrowot|pregnan|legal advice|financ/i.test(
      text,
    )
  )
    return undefined;
  if (
    /coffee|kaw/i.test(text) &&
    /\bi (?:need|want)|looking for|recommend|find me|something.*coffee|szukam|pole[ćc]/i.test(
      text,
    )
  )
    return { query: "coffee", limit: 2 };
  return undefined;
}
