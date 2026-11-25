import { catalogById } from "@/data/products";
import { assistantTextError, type Language } from "./assistant-text";
import { comparisonFactOptions } from "./comparison-facts";

const normalize = (text: string) => text.toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replaceAll("ł", "l")
  .replace(/\s+/g, " ").trim();

// Closed, non-factual assistance remains useful when no product-specific claim
// has been made. Never treat an arbitrary sentence as generic by omission.
const genericAssistance: Record<Language, readonly string[]> = {
  en: [
    "I can help you check.", "I can help you choose.",
    "I can help you choose from these options.", "I can help you compare these products.",
    "I can help you check prices.", "I can help you compare the options.",
    "Here are the verified results.", "Here are the results.", "Here are some options.",
    "Would you like more details?", "Would you like help choosing?",
  ],
  pl: [
    "Mogę pomóc Ci sprawdzić.", "Mogę pomóc Ci wybrać.",
    "Mogę pomóc Ci wybrać spośród tych propozycji.", "Mogę pomóc Ci porównać te produkty.",
    "Mogę pomóc Ci sprawdzić ceny.", "Mogę pomóc Ci porównać te propozycje.",
    "Oto sprawdzone wyniki.", "Oto wyniki.", "Oto kilka propozycji.",
    "Czy chcesz poznać więcej szczegółów?", "Czy pomóc Ci wybrać?",
  ],
};

/**
 * Returns unchanged validated advice, a catalog-backed replacement for complete
 * unverified prose, or undefined when the reply or its result identities are
 * invalid. An incomplete model response is never repaired or substituted here.
 */
export function groundedSearchAdvice(
  text: string, ids: string[], language: Language, finishReason?: string, purpose: "selection" | "productOverview" = "selection",
): string | undefined {
  if (assistantTextError(text, finishReason, language)) return;
  if (!ids.length || new Set(ids).size !== ids.length || (purpose === "productOverview" && ids.length !== 1)) return;
  const rows = ids.map((id) => catalogById.get(id));
  if (rows.some((row) => !row)) return;
  const options = rows.flatMap((product) =>
    comparisonFactOptions(product!, language).map((option) => ({ id: product!.id, text: option.statement })),
  );
  const input = normalize(text);
  if (purpose === "selection" && /^(?:(?:all|these|all these) (?:products|items) are (?:in stock|available)|(?:te|wszystkie|wszystkie te) produkty sa dostepne)[.!]$/.test(input) &&
      rows.every((product) => product!.inStock)) return text;
  const sentences = input.match(/[^.!?]+[.!?](?:\s+|$)/g)?.map((value) => value.trim()) ?? [];
  if (sentences.length > 0 && sentences.length <= 2 && sentences.join(" ") === input) {
    const matches = sentences.map((sentence) => options.filter((option) => normalize(option.text) === sentence));
    if (matches.every((values) => values.length > 0) &&
        (matches.length === 1 || matches[0].some(left =>
          matches[1].some(right => purpose === "productOverview" ? left.text !== right.text : left.id !== right.id)))) return text;
    if (purpose === "productOverview") {
      const verified = [...new Set(matches.flatMap(values => values.slice(0, 1).map(option => option.text)))];
      if (verified.length) return verified.join(" ");
    }
    const safe = genericAssistance[language].map(normalize);
    if (purpose === "selection" && sentences.every((sentence) => safe.includes(sentence))) return text;
  }
  // All rows were validated above. The first option is a real feature when one
  // is available and otherwise an exact named-material statement.
  return purpose === "productOverview" ? options.slice(0, 2).map(option => option.text).join(" ") || undefined : options[0]?.text;
}
