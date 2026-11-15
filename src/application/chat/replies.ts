import type {
  Product,
  CatalogOverview,
  ProductSearchResult,
} from "@/domain/catalog/product";
import type { ConversationContext, BudgetRequest } from "./conversation";
import { categoryLabels } from "@/domain/catalog/category-labels";
import { featureClause } from "./catalog-language";
import { productTypes } from "@/domain/catalog/taxonomy";
export function localizedDimensions(dimensions: string, pl: boolean) {
  return pl
    ? dimensions
        .replaceAll("diameter", "średnicy")
        .replaceAll("high", "wysokości")
        .replaceAll("long", "długości")
        .replaceAll("each", "każdy")
        .replaceAll("loop length", "długości pętli")
    : dimensions;
}
export function nextQuestion(context: ConversationContext, broad = false) {
  return broad
    ? context.language === "pl"
      ? "Co najbardziej Cię interesuje: dekoracje, tekstylia, oświetlenie czy kuchnia?"
      : "What interests you most: decor, textiles, lighting or kitchen essentials?"
    : "";
}
export function searchReply(
  products: Product[],
  context: ConversationContext,
  options: {
    broad?: boolean;
    gift?: boolean;
    more?: boolean;
    budget?: BudgetRequest;
    narration?: { opening: string; followUp: string };
    result?: ProductSearchResult;
  } = {},
) {
  const pl = context.language === "pl",
    budget = options.budget;
  const currencyNote =
    budget && budget.currency !== "EUR"
      ? pl
        ? `Ceny są w EUR. To przykłady blisko ${budget.amount} EUR, a nie przeliczenie ${budget.amount} ${budget.currency}. Czy mogę przyjąć taki budżet w euro?`
        : `Prices are in EUR. These examples are near EUR ${budget.amount}, not a conversion of ${budget.amount} ${budget.currency}. May I use that budget in euros?`
      : "";
  if (!products.length)
    return [
      pl
        ? "Nie mam kolejnych pasujących propozycji przy tych warunkach."
        : "There are no further matches under these requirements.",
      pl
        ? "Możemy zmienić jeden warunek, na przykład wybrać inny typ produktu."
        : "We could change one requirement, such as the product type.",
      currencyNote,
    ]
      .filter(Boolean)
      .join(" ");
  const intro = options.more
    ? pl
      ? `Pokazuję ${products.length} ${products.length === 1 ? "kolejną propozycję" : "kolejne propozycje"}.`
      : `Showing ${products.length} different ${products.length === 1 ? "suggestion" : "suggestions"}.`
    : pl
      ? `Pokazuję ${products.length} ${products.length === 1 ? "propozycję" : "propozycje"} z katalogu.`
      : `Showing ${products.length} ${products.length === 1 ? "suggestion" : "suggestions"} from the catalog.`;
  const featureIndex =
    products.length === 2 && products[0].features[0] === products[1].features[0]
      ? 1
      : 0;
  const facts = products.map((p) =>
    pl
      ? `${p.name} ${featureClause(p, "pl", featureIndex)} i kosztuje ${p.price.toFixed(2)} EUR${p.inStock ? "" : "; obecnie jest niedostępny"}.`
      : `${p.name} ${featureClause(p, "en", featureIndex)}; the price is EUR ${p.price.toFixed(2)}${p.inStock ? "" : " and it is currently out of stock"}.`,
  );
  let follow = options.gift
    ? pl
      ? "Dla kogo szukasz prezentu i co ta osoba lubi?"
      : "Who is the gift for and what do they enjoy?"
    : nextQuestion(context, options.broad);
  return [intro, ...facts, currencyNote || follow].filter(Boolean).join(" ");
}
export function overviewReply(
  overview: CatalogOverview,
  context: ConversationContext,
) {
  const pl = context.language === "pl";
  const types = overview.types
    .map(
      (row) =>
        `${productTypes[row.type]?.[pl ? "pl" : "en"] ?? row.type} (${row.count})`,
    )
    .join(", ");
  return pl
    ? `Oferta spełniająca te warunki obejmuje ${overview.total} produktów. Dostępne typy: ${types || "brak"}.`
    : `There are ${overview.total} catalog products under these requirements. Available types: ${types || "none"}.`;
}
export function simpleReply(
  kind: "greeting" | "language" | "refuse" | "repair",
  context: ConversationContext,
) {
  const pl = context.language === "pl";
  const replies = {
    greeting: pl
      ? "Cześć! Szukasz czegoś do domu, do pracy czy na prezent?"
      : "Hello! Are you shopping for your home, your desk or a gift?",
    language: pl
      ? "Jasne, możemy rozmawiać po polsku. Czego szukasz albo jaki masz budżet?"
      : "Of course, we can continue in English. What are you looking for, or what budget do you have in mind?",
    refuse: pl
      ? "Pomagam w zakupach w Aurelle, więc nie napiszę kodu ani nie zajmę się tematami spoza sklepu. Poszukać dla Ciebie produktu albo wyjaśnić zasady dostawy?"
      : "I can help with shopping at Aurelle, rather than programming or unrelated advice. Would you like a product recommendation or delivery information?",
    repair: pl
      ? "Chcę dobrze zrozumieć Twoje pytanie. Chodzi o wybór produktów, kategorię czy zasady sklepu?"
      : "I'd like to understand your request better. Are you asking about products, a category or a store policy?",
  };
  return replies[kind];
}
export function categoriesReply(
  categories: string[],
  context: ConversationContext,
) {
  return context.language === "pl"
    ? `W katalogu mamy: ${categories.map((category) => categoryLabels[category] ?? category).join(", ")}. Która kategoria Cię interesuje? Mogę pokazać dwa przykłady.`
    : `Our categories are: ${categories.join(", ")}. Which would you like to explore? I can show two examples.`;
}
export function policyReply(policy: string, context: ConversationContext) {
  if (context.language !== "pl") return policy;
  const text = /14 days/.test(policy)
    ? "W demo przyjmujemy zwroty do 14 dni od dostawy."
    : /EUR 4/.test(policy)
      ? "W demo dostawa kosztuje 4 EUR i trwa 2–3 dni robocze."
      : "To demo nie przyjmuje płatności ani nie składa prawdziwych zamówień.";
  return text;
}
