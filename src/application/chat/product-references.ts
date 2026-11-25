import { products, catalogById } from "@/data/products";
import { productTypes } from "@/domain/catalog/taxonomy";

const foldComparison = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l");

const escapedLabel = (label: string) => foldComparison(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function labelPattern(label: string, flags = ""): RegExp {
  return new RegExp(`(?:^|[^a-z0-9-])${escapedLabel(label)}(?=$|[^a-z0-9-])`, flags);
}

/** Match current catalog labels in request order; IDs are only used for explicit legacy lists. */
function namedProductMatches(text: string, includeIds: boolean): string[] {
  const current = foldComparison(text);
  return products.flatMap((product) => {
    const labels = includeIds ? [product.id, product.name] : [product.name];
    const positions = labels.flatMap((label) => {
      const match = labelPattern(label).exec(current);
      return match ? [match.index] : [];
    });
    return positions.length ? [{ id: product.id, index: Math.min(...positions) }] : [];
  }).sort((a, b) => a.index - b.index).map((row) => row.id);
}

/** Only full catalog names count for automatic resolution of typed requests. */
export function exactNamedProducts(text: string): string[] {
  return namedProductMatches(text, false);
}

export function asksForChoice(text: string): boolean {
  const request = foldComparison(text);
  return /\b(?:ktor\w*|which)\b[^.!?]{0,100}\b(?:lepsz\w*|wybra\w*|polec\w*|sprawdzi|nadaje|better|recommend|choose|pick|best|suit\w*)\b|\b(?:co polecasz|doradz mi|help me choose|pick one|give me a recommendation)\b/.test(request);
}

/** A shopper choosing between two named products needs their records even without the word "compare". */
export function exactNamedChoice(text: string, displayedPair: string[] = []): string[] {
  const request = foldComparison(text);
  if (/["“”„]|\b(?:not|without|except|excluding|nie|bez|oprocz|poza)\b/.test(request)) return [];
  if (!asksForChoice(request)) return [];
  const ids = exactNamedProducts(text);
  if (ids.length) return ids.length === 2 ? ids : [];
  const pointsToPair = /\b(?:z (?:tych (?:dwoch|dwu)|nich)|of (?:those|these)(?: two)?|of (?:the )?(?:two|both)|between them)\b/.test(request);
  return pointsToPair && displayedPair.length === 2 && new Set(displayedPair).size === 2 && displayedPair.every((id) => catalogById.has(id)) ? displayedPair : [];
}

/** Resolve only a complete, explicit comparison of two exact canonical names. */
export function exactNamedComparison(text: string): string[] {
  const normalized = foldComparison(text);
  if (/["'“”„]/.test(normalized) || /\b(?:not|no|without|except|excluding|nie|bez|oprocz|poza)\b/.test(normalized)) return [];
  const [command, ...followups] = normalized.split(/[.?!;]/).map((part) => part.trim()).filter(Boolean);
  if (!command) return [];
  const ids = exactNamedProducts(command);
  if (ids.length !== 2 || new Set(ids).size !== 2) return [];
  if (!/\b(?:zestaw|porownaj|porownanie|compare|comparison|versus|vs)\b/.test(command)) return [];
  let residue = command;
  for (const id of ids) {
    residue = residue.replace(labelPattern(catalogById.get(id)!.name), " ");
  }
  residue = residue.replace(/\b(?:zestaw|porownaj|porownanie|compare|comparison|prosze|please|could|you|can|czy|mozesz|the|produkty|produktow|products|and|i|oraz|vs|versus|with|z)\b/g, "").replace(/[\s,:;&()/\-]+/g, "");
  if (residue) return [];
  const priceQuestion = /^(?:co kosztuje mniej|ktory (?:jest |kosztuje )?tansz\w*|ktory produkt (?:jest |kosztuje )?tansz\w*|ktory kosztuje mniej|what (?:costs less|is cheaper)|which (?:one |product )?(?:is |costs )?(?:cheaper|less)|which costs less)$/;
  if (followups.some((part) => !priceQuestion.test(part))) return [];
  return ids;
}
export function literalProductList(text: string): string[] {
  const current = foldComparison(text);
  const named = namedProductMatches(text, true);
  let remaining = current;
  for (const label of products
    .filter((product) => named.includes(product.id))
    .flatMap((product) => [product.id, product.name])
    .sort((a, b) => b.length - a.length)) {
    remaining = remaining.replace(labelPattern(label, "g"), " ");
  }
  const residue = remaining
    .replace(
      /\b(?:compare|porownaj|and|i|oraz|with|vs|versus|to|z|please|prosze|could|can|you|czy|mozesz|the|products?|items?|produkty|produktow)\b/g,
      "",
    )
    .replace(/[\s.,?!&:;'"/()-]+/g, "");
  return !residue && named.length >= 2 ? named : [];
}
export function queryListGrounded(ids: string[], text: string): boolean {
  const current = foldComparison(text);
  if (
    /["'“”„]/.test(current) ||
    /\b(?:not|no|without|except|excluding|nie|bez|oprocz|poza)\b/.test(current)
  )
    return false;
  const used = new Set<number>();
  return ids.every((id) => {
    const product = catalogById.get(id);
    if (!product) return false;
    const type = productTypes[product.productType];
    return [
      product.id,
      product.name,
      ...(type ? [type.en, type.pl, ...type.aliases] : []),
    ].some((label) => {
      const match = new RegExp(`\\b${escapedLabel(label)}`).exec(current);
      if (!match || used.has(match.index)) return false;
      used.add(match.index);
      return true;
    });
  });
}
export function directComparisonRequest(text: string): boolean {
  return /^(?:(?:please|prosze|could you|can you|czy mozesz)\s+)*(?:compare|porownaj)\b/.test(
    foldComparison(text).trim(),
  );
}
export function hasDistinctComparisonSubjects(text: string): boolean {
  const candidates = products.filter((product) =>
    queryListGrounded([product.id], text),
  );
  return candidates.some((product, index) =>
    candidates.slice(index + 1).some((other) =>
      queryListGrounded([product.id, other.id], text),
    ),
  );
}

export function mentionsBudget(text: string): boolean {
  return /(?:\b(?:eur|euro|usd|gbp|pln)\s*\d|[€$£]\s*\d|\d+(?:[.,]\d+)?\s*(?:eur|euro|euros|usd|gbp|pln|zl|€|\$|£)(?=$|[^a-z0-9])|\b(?:do|ponizej|under|below|over|above|max|min|around|okolo|budzet)\s*\d)/.test(foldComparison(text));
}
