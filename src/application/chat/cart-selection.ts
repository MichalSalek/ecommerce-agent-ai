import { products } from "@/data/products";
import { productTypes } from "@/domain/catalog/taxonomy";
import { normalize, interpretNeed, type ShoppingState } from "./shopping-state";
export function hasCartIntent(text: string) {
  const value = normalize(text);
  if (
    /\b(?:not|don't|do not|nie)\s+(?:add|buy|take|dodawaj|dodaj|kupuj)/.test(
      value,
    )
  )
    return false;
  if (/\b(?:add|dodaj|dodac|dodasz)\b/.test(value)) return true;
  if (/^(?:what|how|can|could|which|co|czy|jak)\b/.test(value.trim()))
    return false;
  return /\b(?:buy|biore|wezme|kupuje)\b|\btake\s+(?:the|this|that|one|two|three|first|second|\d)/.test(
    value,
  );
}
export function resolveCartSelection(
  text: string,
  state: ShoppingState,
):
  | { productId: string; quantity: number }
  | { error: "ambiguous" | "quantity" | "unavailable" } {
  const value = normalize(text);
  const words: Record<string, number> = {
    one: 1,
    a: 1,
    an: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    jeden: 1,
    jedna: 1,
    jedno: 1,
    dwa: 2,
    dwie: 2,
    trzy: 3,
    cztery: 4,
    piec: 5,
  };
  const quantityMatch = value.match(
    /(?:\b(?:quantity|ilosc)\s*[:=]?\s*|\b)(\d+)\s*(?:x\b|units?\b|items?\b|pieces?\b|szt|sztuki|sztuk|of them)|\b(\d+)\s*$/,
  );
  const wordMatch = value.match(
    /\b(one|two|three|four|five|jeden|jedna|jedno|dwa|dwie|trzy|cztery|piec)\b/,
  );
  const leadingQuantity = value.match(
    /\b(?:add|take|dodaj|biore|wezme)\s+(\d+)\b/,
  );
  const wordUnits = value.match(
    /\b(one|two|three|four|five|jeden|jedna|jedno|dwa|dwie|trzy|cztery|piec)\s+(?:units?|items?|pieces?|szt\w*)\b/,
  );
  const quantity = wordUnits
    ? words[wordUnits[1]]
    : leadingQuantity
      ? Number(leadingQuantity[1])
      : quantityMatch
        ? Number(quantityMatch[1] ?? quantityMatch[2])
        : wordMatch
          ? words[wordMatch[1]]
          : 1;
  if (
    /\b(?:add|take|dodaj|biore|wezme)\s+\d+[.,]\d+|\d+[.,]\d+\s*$/.test(value)
  )
    return { error: "quantity" };
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 99 ||
    /\b(?:zero|none|minus)\b|(?:^|\s)-\d|\d+[.,]\d+\s*(?:szt|units?|pieces?)/.test(
      value,
    )
  )
    return { error: "quantity" };
  const named = products.filter(
    (p) =>
      value.includes(p.id) ||
      value.includes(normalize(p.id).replaceAll("-", " ")) ||
      value.includes(normalize(p.name)),
  );
  const need = interpretNeed(text, {
    ...state,
    rejectedIds: [...state.rejectedIds],
  });
  let candidates = named.length
    ? named
    : state.lastIds.flatMap((id) => products.filter((p) => p.id === id));
  if (!named.length && need.patch.productType) {
    const typed = products.filter(
      (p) => p.productType === need.patch.productType,
    );
    const recent = typed.filter((p) => state.lastIds.includes(p.id));
    candidates = recent.length ? recent : typed;
  }
  // A new, unresolved noun must not fall back to a previously selected item.
  let remainder = value;
  for (const product of named)
    for (const label of [
      product.id,
      normalize(product.id).replaceAll("-", " "),
      normalize(product.name),
    ].sort((a, b) => b.length - a.length))
      remainder = remainder.replaceAll(label, " ");
  const type = need.patch.productType
    ? productTypes[need.patch.productType]
    : undefined;
  if (type)
    for (const alias of [type.en, type.pl, ...type.aliases].sort(
      (a, b) => b.length - a.length,
    )) {
      const escaped = normalize(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      remainder = remainder.replace(new RegExp(`\\b${escaped}\\w*`, "g"), " ");
    }
  remainder = remainder
    .replace(
      /\b(?:add|dodaj|dodac|dodasz|biore|wezme|kupuje|buy|take|choose|prefer|wybieram|wole|can|could|you|i|please|prosze|mozesz|do|to|my|the|this|that|it|these|those|one|two|three|four|five|jeden|jedna|jedno|dwa|dwie|trzy|cztery|piec|ten|ta|te|tego|tansz\w*|drozsz\w*|cheaper|cheapest|less|expensive|pricier|first|second|pierwsz\w*|drug\w*|product|products|item|items|option|of|and|or|cart|basket|koszyk\w*|szt\w*|units?|pieces?|them|x)\b/g,
      " ",
    )
    .replace(/[^a-z]+/g, " ")
    .trim();
  if (remainder) return { error: "ambiguous" };
  if (/\b(?:cheaper|cheapest|less expensive)\b|tansz/.test(value)) {
    const min = Math.min(...candidates.map((p) => p.price));
    candidates = candidates.filter((p) => p.price === min);
  } else if (/\b(?:expensive|pricier)\b|drozsz/.test(value)) {
    const max = Math.max(...candidates.map((p) => p.price));
    candidates = candidates.filter((p) => p.price === max);
  } else if (/\b(?:first|pierwsz)/.test(value))
    candidates = candidates.slice(0, 1);
  else if (/\b(?:second|drug)/.test(value)) candidates = candidates.slice(1, 2);
  else if (!named.length && candidates.length > 1) {
    const matching = candidates.filter((p) => {
      const type = productTypes[p.productType];
      return (
        type &&
        [type.en, type.pl, ...type.aliases].some((alias) =>
          value.includes(normalize(alias)),
        )
      );
    });
    if (matching.length) candidates = matching;
  }
  if (candidates.length !== 1) return { error: "ambiguous" };
  if (!candidates[0].inStock) return { error: "unavailable" };
  return { productId: candidates[0].id, quantity };
}
