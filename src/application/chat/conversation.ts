import type { ModelMessage } from "ai";
import { productSchema, type ProductSearch } from "@/domain/catalog/product";
export type Language = "en" | "pl";
export interface ConversationContext {
  text: string;
  language: Language;
  turn: number;
  shownIds: string[];
  previousSearch?: ProductSearch;
  homeContext: boolean;
}
export function userText(message: ModelMessage): string {
  return typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join(" ")
      : "";
}
export function conversationContext(
  messages: ModelMessage[],
): ConversationContext {
  const users = messages.filter((m) => m.role === "user").map(userText);
  let language: Language = "en";
  let explicitLanguage: Language | undefined;
  for (const text of users) {
    if (/po angielsku|in english/i.test(text)) {
      explicitLanguage = "en";
      continue;
    }
    if (/po polsku|in polish|\bpolish\b/i.test(text)) {
      explicitLanguage = "pl";
      continue;
    }
    if (
      /po polsku|polish|[ąćęłńóśźż]|szukam|jakie|mozesz|wiecej|kontynuuj/i.test(
        text,
      )
    )
      language = "pl";
    else if (
      /in english|po angielsku|\b(hello|please|what|which|write|i need|how much)\b/i.test(
        text,
      )
    )
      language = "en";
  }
  let text = users.at(-1) ?? "";
  if (
    /^(kontynuuj|continue)[.!? ]*$/i.test(text) &&
    messages.at(-2)?.role === "user"
  )
    text = users.at(-2) ?? text;
  const shown = new Set<string>();
  let previousSearch: ProductSearch | undefined;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        part.type === "tool-call" &&
        part.toolName === "searchProducts" &&
        typeof part.input === "object" &&
        part.input !== null &&
        "query" in part.input &&
        typeof part.input.query === "string"
      )
        previousSearch = part.input as ProductSearch;
      if (
        part.type === "tool-result" &&
        part.toolName === "searchProducts" &&
        part.output.type === "json" &&
        Array.isArray(part.output.value)
      )
        for (const value of part.output.value) {
          const parsed = productSchema.safeParse(value);
          if (parsed.success) shown.add(parsed.data.id);
        }
    }
  }
  let homeContext = false;
  for (const user of users) {
    if (/do domu|for (?:my |the )?home|for (?:my |the )?house/i.test(user))
      homeContext = true;
    else if (
      /do pracy|do kuchni|słuchawk|headphones|for (?:my |the )?desk|electronics/i.test(
        user,
      )
    )
      homeContext = false;
  }
  return {
    text,
    language: explicitLanguage ?? language,
    turn: users.length,
    shownIds: [...shown],
    previousSearch,
    homeContext,
  };
}
export interface BudgetRequest {
  amount: number;
  mode: "max" | "around";
  currency: "EUR" | "USD" | "PLN" | "GBP" | "CHF";
}
export function requestedBudget(text: string): BudgetRequest | undefined {
  const match = text.match(
    /(?:\b)(under|below|up to|less than|around|about|approximately|roughly|około|okolo|poniżej|ponizej|maksymalnie|do|za)\s*(?:eur|usd|€|\$)?\s*(\d+(?:[.,]\d+)?)/i,
  );
  if (!match) return undefined;
  const amount = Number(match[2].replace(",", "."));
  if (!Number.isFinite(amount)) return undefined;
  return {
    amount,
    mode: /^(around|about|approximately|roughly|około|okolo)$/i.test(match[1])
      ? "around"
      : "max",
    currency: /\$|usd|dolar|dollar/i.test(text)
      ? "USD"
      : /pln|zł|zlot/i.test(text)
        ? "PLN"
        : /gbp|£|funt|pound/i.test(text)
          ? "GBP"
          : /chf|frank/i.test(text)
            ? "CHF"
            : "EUR",
  };
}
export function isMoreRequest(text: string) {
  return /^(a\s+)?(co[sś]\s+wi[eę]cej|wi[eę]cej|inne(?:go)?|kontynuuj|more|anything else|something else|show me more|other options|more options|jeszcze co[sś]|co[sś] innego|poka[zż] wi[eę]cej|inne propozycje|inne produkty|continue)[?!. ]*$/i.test(
    text.trim(),
  );
}
export function isHomeRequest(text: string) {
  return /szukam czego[sś] do domu|something for (?:my |the )?home|something for (?:my |the )?house/i.test(
    text,
  );
}
export function isCategoriesRequest(text: string) {
  return /kategori|categories|departments/i.test(text);
}
export function isLanguageRequest(text: string) {
  return (
    /po polsku|in polish|po angielsku|in english/i.test(text) &&
    !requestedBudget(text) &&
    !isCategoriesRequest(text)
  );
}
export function isGreeting(text: string) {
  return /^(test|hi|hello|hey|cze[sś][cć]|dzie[nń] dobry|hej)[!. ]*$/i.test(
    text.trim(),
  );
}
export function isBudgetBrowse(text: string) {
  return (
    !!requestedBudget(text) &&
    !/(coffee|kaw|lamp|mug|kub|vase|wazon|speaker|głośnik|headphone|słuchawk)/i.test(
      text,
    )
  );
}
