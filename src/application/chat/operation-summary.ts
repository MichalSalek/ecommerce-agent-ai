import { catalogById } from "@/data/products";
import { getStorePolicy } from "@/domain/catalog/policies";
import type { Language } from "./assistant-text";
import type { Comparison, SearchEvidence, CategoryCard } from "./shopping-v3";

function polishCount(count: number, one: string, few: string, many: string) {
  if (count === 1) return one;
  return count % 10 >= 2 &&
    count % 10 <= 4 &&
    !(count % 100 >= 12 && count % 100 <= 14)
    ? few
    : many;
}
export function comparisonSummary(
  value: Comparison,
  language: Language,
): string {
  const rows = value.productIds.flatMap((id) =>
    catalogById.get(id) ?? [],
  );
  const price = Math.min(...rows.map((p) => p.price)).toFixed(2);
  const names = value.cheapestIds
    .flatMap((id) => catalogById.get(id) ?? [])
    .map((p) => p.name)
    .join(", ");
  return language === "pl"
    ? `Porównanie obejmuje ${rows.length} ${polishCount(rows.length, "produkt", "produkty", "produktów")}. Najniższa cena to ${price} EUR (${names}).`
    : `This comparison covers ${rows.length} products. The lowest price is EUR ${price} (${names}).`;
}
export function detailsSummary(id: string, language: Language): string {
  const p = catalogById.get(id)!;
  if (language === "pl")
    return `Szczegóły produktu ${p.name} znajdziesz na karcie poniżej.`;
  const feature = p.features[0] ?? p.material;
  const limitation = p.limitations[0];
  return `${p.name}: ${p.description} Recorded feature: ${feature}. ${limitation ? `Limitation: ${limitation}.` : "The catalog lists no additional limitations."}`;
}
export function searchSummary(
  value: SearchEvidence,
  language: Language,
): string {
  const count = value.products.length;
  if (count === 1 && value.totalMatches === 1)
    return language === "pl" ? "Jeden produkt spełnia Twoje kryteria." : "One product matches your criteria.";
  if (count)
    return language === "pl"
      ? `Pokazuję ${count} ${polishCount(count, "produkt", "produkty", "produktów")} z ${value.totalMatches} pasujących do kryteriów. ${value.remainingMatches > 0 ? `Możesz wyświetlić jeszcze ${value.remainingMatches} ${polishCount(value.remainingMatches, "dopasowanie", "dopasowania", "dopasowań")}.` : "To wszystkie dopasowania do wyświetlenia."}`
      : `Showing ${count} ${count === 1 ? "product" : "products"} from ${value.totalMatches} matching your criteria. ${value.remainingMatches > 0 ? `${value.remainingMatches} unseen ${value.remainingMatches === 1 ? "match remains" : "matches remain"}.` : "There are no further matching products to show."}`;
  return emptySearchSummary(value.outcome, language);
}

export function emptySearchSummary(outcome: SearchEvidence["outcome"], language: Language): string {
  const messages = {
    exhausted: [
      "You have seen all the matching products. I can revisit one of them or search with different criteria.",
      "To już wszystkie produkty spełniające Twoje kryteria. Mogę wrócić do któregoś z nich albo poszukać według innych kryteriów.",
    ],
    unavailable: [
      "Matching products are currently out of stock.",
      "Pasujące produkty są obecnie niedostępne.",
    ],
    "unconfirmed-feature": [
      "The catalog does not confirm the requested feature.",
      "Katalog nie potwierdza wymaganej cechy.",
    ],
    "no-assortment": [
      "There are no products in this part of the collection.",
      "W tej części katalogu nie ma produktów.",
    ],
    "invalid-criteria": [
      "Please clarify your search criteria.",
      "Doprecyzuj kryteria wyszukiwania.",
    ],
    "no-match": [
      "No products match these criteria.",
      "Żaden produkt nie spełnia tych kryteriów.",
    ],
    matches: ["No products are shown.", "Nie wyświetlono produktów."],
  };
  return messages[outcome][language === "pl" ? 1 : 0];
}
export function categoriesSummary(
  rows: CategoryCard[],
  language: Language,
): string {
  return language === "pl"
    ? `Katalog obejmuje ${rows.length} kategorii. Wybierz kategorię, aby zobaczyć produkty.`
    : `The collection has ${rows.length} categories. Choose one to see its products.`;
}
export function policySummary(topic: string, language: Language): string {
  return getStorePolicy(topic, language);
}
