import type { Product } from "@/domain/catalog/product";
import type { ConversationContext, BudgetRequest } from "./conversation";
export function nextQuestion(context: ConversationContext, broad = false) {
  if (context.language === "pl")
    return broad
      ? "Co najbardziej Cię interesuje: dekoracje, tekstylia, oświetlenie czy kuchnia?"
      : context.turn % 2
        ? "Zawęzić wybór do konkretnej kategorii czy porównać te propozycje?"
        : "Wolisz zobaczyć inne propozycje czy dowiedzieć się więcej o jednej z tych rzeczy?";
  return broad
    ? "What interests you most: decor, textiles, lighting or kitchen essentials?"
    : context.turn % 2
      ? "Would you like to narrow this to a category, or compare these options?"
      : "Would you prefer more suggestions or a closer look at one of these?";
}
export function searchReply(
  products: Product[],
  context: ConversationContext,
  options: {
    broad?: boolean;
    more?: boolean;
    budget?: BudgetRequest;
    narration?: { opening: string; followUp: string };
  } = {},
) {
  const pl = context.language === "pl";
  const budget = options.budget;
  const currencyNote =
    budget && budget.currency !== "EUR"
      ? pl
        ? `Ceny w sklepie są w EUR. To przykłady w okolicach ${budget.amount} EUR, a nie przeliczenie ${budget.amount} ${budget.currency}. Czy mogę przyjąć taki budżet w euro?`
        : `Store prices are in EUR. These examples are around EUR ${budget.amount}, not a conversion of ${budget.currency} ${budget.amount}. May I use that budget in euros?`
      : "";
  if (!products.length)
    return [
      currencyNote,
      pl
        ? "Nie mam kolejnych pasujących propozycji przy tych warunkach. Zwiększyć budżet czy spróbować innej kategorii?"
        : "There are no further matches with these constraints. Shall we widen the budget or try another category?",
    ]
      .filter(Boolean)
      .join("\n\n");
  let intro: string;
  if (options.broad)
    intro = pl
      ? "Do domu można wybrać coś praktycznego albo dekoracyjnego. Na początek dwa przykłady poniżej."
      : "For your home, we can look at something practical or decorative. Here are two starting points.";
  else if (budget?.mode === "around")
    intro = pl
      ? `Najbliżej poziomu ${budget.amount} EUR są te propozycje.`
      : `These options are closest to EUR ${budget.amount}.`;
  else if (options.more)
    intro =
      context.turn % 2 === 0
        ? pl
          ? "Mam kolejne przykłady, inne niż poprzednio."
          : "Here are some different examples to consider."
        : pl
          ? "Spójrzmy na inne rzeczy — pominąłem produkty już pokazane w tej rozmowie."
          : "Let's look at alternatives — these exclude products already shown in this conversation.";
  else
    intro = pl
      ? context.turn % 2
        ? "Te propozycje pasują do Twojego zapytania."
        : "Warto przyjrzeć się tym produktom."
      : context.turn % 2
        ? "These options match what you're looking for."
        : "These are worth a closer look.";
  if (options.narration && budget?.mode !== "around")
    intro = options.narration.opening;
  return [
    intro,
    currencyNote ||
      options.narration?.followUp ||
      nextQuestion(context, options.broad),
  ]
    .filter(Boolean)
    .join("\n\n");
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
const polishCategories: Record<string, string> = {
  Accessories: "akcesoria",
  Bathroom: "łazienka",
  Electronics: "elektronika",
  Furniture: "meble",
  Garden: "ogród",
  Home: "dom i dekoracje",
  Kitchen: "kuchnia",
  Lighting: "oświetlenie",
  Storage: "przechowywanie",
  Wellness: "wellness",
};
export function categoriesReply(
  categories: string[],
  context: ConversationContext,
) {
  return context.language === "pl"
    ? `W katalogu mamy: ${categories.map((category) => polishCategories[category] ?? category).join(", ")}. Która kategoria Cię interesuje? Mogę pokazać dwa przykłady.`
    : `Our categories are: ${categories.join(", ")}. Which would you like to explore? I can show two examples.`;
}
export function policyReply(policy: string, context: ConversationContext) {
  if (context.language !== "pl")
    return `${policy}\n\nWould you like help finding a product next?`;
  const text = /14 days/.test(policy)
    ? "W demo przyjmujemy zwroty do 14 dni od dostawy."
    : /EUR 4/.test(policy)
      ? "W demo dostawa kosztuje 4 EUR i trwa 2–3 dni robocze."
      : "To demo nie przyjmuje płatności ani nie składa prawdziwych zamówień.";
  return `${text}\n\nPomóc Ci teraz wybrać produkt?`;
}
