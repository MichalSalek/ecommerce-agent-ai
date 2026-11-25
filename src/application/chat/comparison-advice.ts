import { catalogById } from "@/data/products";
import type { Product } from "@/domain/catalog/product";
import type { Language } from "./assistant-text";
import { materialLabel } from "./detail-response";

const normalize = (text: string) => text.toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replaceAll("ł", "l")
  .replace(/\s+/g, " ").trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Accept simple, product-attributed statements only when the complete fact is in that product's record. */
export function groundedComparisonAdvice(text: string, ids: string[]): boolean {
  const rows = ids.map((id) => catalogById.get(id));
  if (rows.length < 2 || rows.some((row) => !row) || new Set(ids).size !== ids.length) return false;
  const input = normalize(text);
  // General assistance has no product fact to misattribute.
  if (/^(?:i can help you check|i can help you compare these products|moge pomoc ci porownac te produkty)[.!]$/.test(input)) return true;
  const numericWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, jeden: 1, dwa: 2, dwie: 2, trzy: 3, cztery: 4, piec: 5, szesc: 6, siedem: 7, osiem: 8, dziewiec: 9, dziesiec: 10 };
  const groupCount = input.match(/^(?:(?:this|the) )?comparison (?:covers|includes|compares) (\d+|one|two|three|four|five|six|seven|eight|nine|ten) products?[.!]$/) ?? input.match(/^(?:to )?porownanie obejmuje (\d+|jeden|dwa|dwie|trzy|cztery|piec|szesc|siedem|osiem|dziewiec|dziesiec) produkt\w*[.!]$/);
  if (groupCount) return (numericWords[groupCount[1]] ?? Number(groupCount[1])) === rows.length;
  const setCount = input.match(/^both(?: products)? (?:are|come as|are sold as) (?:a )?set of (\d+|one|two|three|four|five|six|seven|eight|nine|ten)[.!]$/) ?? input.match(/^oba(?: produkty)? (?:sa|stanowia) zestawami? po (\d+|dwa|dwie|trzy|cztery|piec|szesc|siedem|osiem|dziewiec|dziesiec)(?: sztuki| sztuk)?[.!]$/);
  if (setCount) {
    const quantity = numericWords[setCount[1]] ?? Number(setCount[1]);
    return (rows as Product[]).every((product) => product.features.some((fact) => {
      const match = normalize(fact).match(/^set of (\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/);
      return !!match && (numericWords[match[1]] ?? Number(match[1])) === quantity;
    }));
  }
  const matches = (rows as Product[]).flatMap((product) => {
    const name = normalize(product.name);
    const pattern = new RegExp(`(?:^|[^a-z0-9-])(${escape(name)})(?=$|[^a-z0-9-])`, "g");
    return [...input.matchAll(pattern)].map((match) => ({ product, start: match.index! + match[0].length - match[1].length, end: match.index! + match[0].length }));
  }).sort((a, b) => a.start - b.start);
  if (matches.length !== rows.length || new Set(matches.map((match) => match.product.id)).size !== rows.length) return false;
  if (!/^(?:the |a |an |oto |porownanie )?$/.test(input.slice(0, matches[0].start))) return false;
  return matches.every((match, index) => {
    let clause = input.slice(match.end, matches[index + 1]?.start ?? input.length)
      .replace(/[.!?;,]+\s*$/g, "").trim();
    if (index + 1 < matches.length)
      clause = clause.replace(/(?:[,;]\s*)?\b(?:while|whereas|and|natomiast|oraz|a)\s+(?:the\s+)?$/, "").replace(/[;,]+\s*$/, "").trim();
    const product = match.product;
    const enMaterial = normalize(product.material);
    const plMaterial = materialLabel(product.material, "pl");
    const values = [enMaterial, ...(plMaterial ? [normalize(plMaterial)] : [])];
    const material = clause.match(/^(?:is|are) (?:made (?:of|from) )?(.+)$/)?.[1] ??
      clause.match(/^(?:materiał|material)\s*:\s*(.+)$/)?.[1];
    if (material && values.includes(material)) return true;
    const feature = clause.match(/^(?:has|have|features|includes|with) (?:a |an )?(.+)$/)?.[1];
    if (feature && product.features.some((fact) => {
      const canonical = normalize(fact);
      // A head noun is independently true when the catalog records a qualified feature.
      const head = canonical.split(/\s+(?:for|with)\s+/)[0];
      return feature === canonical || feature === head;
    })) return true;
    const literal = clause.match(/^:\s*(.+)$/)?.[1];
    if (literal && (values.includes(literal) || [...product.features, ...product.limitations].some((fact) => normalize(fact) === literal))) return true;
    return false;
  });
}

/** Use canonical materials when free prose contains claims that cannot be attributed. */
export function comparisonAdviceFallback(ids: string[], language: Language): string {
  const rows = ids.flatMap((id) => {
    const product = catalogById.get(id);
    return product ? [product] : [];
  });
  const visible = rows.slice(0, 3).map((product) => ({
    name: product.name,
    material: materialLabel(product.material, language),
  }));
  if (visible.length < 2 || visible.some((item) => !item.material))
    return language === "pl"
      ? "Materiały, cechy i ograniczenia produktów znajdziesz w porównaniu."
      : "The products' materials, features and limitations are shown in the comparison.";
  const last = visible[visible.length - 1];
  const lead = visible.slice(0, -1);
  const firstPart = language === "pl"
    ? lead.map((item) => `dla ${item.name} materiał „${item.material}”`).join(", ")
    : lead.map((item) => `${item.material} for ${item.name}`).join(", ");
  return language === "pl"
    ? `Katalog podaje ${firstPart}, a dla ${last.name} „${last.material}”. Cechy i ograniczenia znajdziesz w porównaniu.`
    : `The catalog lists ${firstPart} and ${last.material} for ${last.name}. Other recorded features and limitations appear in the comparison.`;
}
