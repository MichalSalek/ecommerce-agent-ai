import { products } from "@/data/products";
import { getStorePolicy, resolvePolicyTopic } from "@/domain/catalog/policies";
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
    products.filter((p) => p.id === id),
  );
  const price = Math.min(...rows.map((p) => p.price)).toFixed(2);
  const names = value.cheapestIds
    .flatMap((id) => products.filter((p) => p.id === id))
    .map((p) => p.name)
    .join(", ");
  return language === "pl"
    ? `Porównanie obejmuje ${rows.length} ${polishCount(rows.length, "produkt", "produkty", "produktów")}. Najniższa cena to ${price} EUR (${names}).`
    : `This comparison covers ${rows.length} products. The lowest price is EUR ${price} (${names}).`;
}
export function detailsSummary(id: string, language: Language): string {
  const p = products.find((p) => p.id === id)!;
  const feature = p.features[0] ?? p.material;
  const limitation = p.limitations[0];
  return language === "pl"
    ? `${p.name}: ${p.description} Zapisana cecha: ${feature}. ${limitation ? `Ograniczenie: ${limitation}.` : "Katalog nie podaje dodatkowych ograniczeń."}`
    : `${p.name}: ${p.description} Recorded feature: ${feature}. ${limitation ? `Limitation: ${limitation}.` : "The catalog lists no additional limitations."}`;
}
export function searchSummary(
  value: SearchEvidence,
  language: Language,
): string {
  const count = value.products.length;
  if (count)
    return language === "pl"
      ? `Pokazuję ${count} ${polishCount(count, "produkt", "produkty", "produktów")} z ${value.totalMatches} pasujących do kryteriów. ${value.remainingMatches > 0 ? `Możesz wyświetlić jeszcze ${value.remainingMatches} ${polishCount(value.remainingMatches, "dopasowanie", "dopasowania", "dopasowań")}.` : "To wszystkie dopasowania do wyświetlenia."}`
      : `Showing ${count} ${count === 1 ? "product" : "products"} from ${value.totalMatches} matching your criteria. ${value.remainingMatches > 0 ? `${value.remainingMatches} unseen ${value.remainingMatches === 1 ? "match remains" : "matches remain"}.` : "There are no further matching products to show."}`;
  const messages = {
    exhausted: [
      "There are no more matching products to show.",
      "Nie ma kolejnych dopasowanych produktów do wyświetlenia.",
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
  return messages[value.outcome][language === "pl" ? 1 : 0];
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
  if (language === "en") return getStorePolicy(topic);
  const kind = resolvePolicyTopic(topic);
  if (kind === "returns")
    return "Przykładowa polityka sklepu pozwala na zwrot w ciągu 14 dni od dostawy.";
  if (kind === "delivery")
    return "Przykładowa dostawa kosztuje 4 EUR i trwa od 2 do 3 dni roboczych.";
  if (kind === "payments")
    return "Ten sklep demonstracyjny nie przyjmuje płatności ani nie składa zamówień.";
  if (kind === "demo")
    return "To sklep demonstracyjny, który nie przyjmuje płatności ani nie składa zamówień.";
  return "Dostępne informacje dotyczą dostawy, zwrotów i płatności.";
}
