export const storePolicy = {
  deliveryPriceEUR: 4,
  earliestBusinessDay: 2,
  latestBusinessDay: 3,
  returnDays: 14,
};

export function normalizePolicyText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll("ł", "l");
}

function policyClauses(normalized: string): string[] {
  // The Polish conjunction "i" has the same spelling as the English first-person pronoun.
  const polish = /\b(?:dostaw|wysyl|zwro|odesl|odsyl|koszt|oplac|plac|ile|czasu)[a-z]*/.test(normalized);
  const separator = polish ? /\b(?:and|oraz|i)\b|[.!?;]/ : /\band\b|[.!?;]/;
  return normalized.split(separator);
}

function isReturnShippingClause(clause: string): boolean {
  const transport = /\b(?:shipping|delivery|postage|ship|send|sending|mail|mailing|wysyl[a-z]*|odsyl[a-z]*|odesl[a-z]*)\b/.test(clause);
  const returnSubject = /\b(?:returns?|returning|refund|back|zwrot[a-z]*|zwroc[a-z]*|odesl[a-z]*|odsyl[a-z]*)\b/.test(clause);
  const priceOrPayer = /\b(?:who pays|costs?|fees?|price|pay|pays|paid|postage|plat[a-z]*|plac[a-z]*|koszt[a-z]*|oplat[a-z]*|kto ponosi)\b/.test(clause);
  const explicitReturnFee = /\b(?:return|returns|returning) (?:fees?|costs?|price)|\b(?:fees?|costs?|price|pay|pays|plat[a-z]*|plac[a-z]*|koszt[a-z]*|oplat[a-z]*) (?:of |for |to |za |the |an? |a )*(?:returns?|returning|zwrot[a-z]*|zwroc[a-z]*)/.test(clause);
  return (transport && returnSubject && priceOrPayer) || explicitReturnFee;
}

export function asksReturnShippingCost(text: string): boolean {
  return policyClauses(normalizePolicyText(text)).some(isReturnShippingClause);
}

const policyTopics = [
  "returns", "return-shipping", "delivery", "delivery-and-returns", "return-shipping-and-returns",
  "delivery-and-return-shipping", "delivery-and-returns-and-return-shipping", "payments", "demo", "overview",
] as const;
export type PolicyTopic = (typeof policyTopics)[number];

export function resolvePolicyTopic(topic: string): PolicyTopic {
  const normalized = normalizePolicyText(topic);
  const stored = policyTopics.find((key) => key === normalized);
  if (stored) return stored;
  const clauses = policyClauses(normalized);
  const returnShipping = clauses.some(isReturnShippingClause);
  const delivery = clauses.some((clause) => /deliver|ship|dostaw|wysyl/.test(clause) &&
    !/return|refund|zwrot|zwroc|odesl|odsyl/.test(clause));
  const returns = clauses.some((clause) => /return|refund|zwrot|zwroc/.test(clause) &&
    (!isReturnShippingClause(clause) || /\b(?:within|days?|window|period|long|time|ciagu|dni|termin|czasu)\b/.test(clause)));
  if (returnShipping && delivery && returns) return "delivery-and-returns-and-return-shipping";
  if (returnShipping && delivery) return "delivery-and-return-shipping";
  if (returnShipping && returns) return "return-shipping-and-returns";
  if (returnShipping) return "return-shipping";
  if (delivery && returns) return "delivery-and-returns";
  if (returns) return "returns";
  if (delivery || /deliver|ship|dostaw|wysy/.test(normalized)) return "delivery";
  if (/pay|order|plat|zamow/.test(normalized)) return "payments";
  if (/\bdemo\b|demonstrat|demonstrac|portfolio/.test(normalized)) return "demo";
  return "overview";
}
export function getStorePolicy(topic: string, language: "en" | "pl" = "en"): string {
  const { deliveryPriceEUR, earliestBusinessDay, latestBusinessDay, returnDays } = storePolicy;
  switch (resolvePolicyTopic(topic)) {
    case "delivery-and-returns-and-return-shipping":
      return `${getStorePolicy("delivery-and-returns", language)} ${getStorePolicy("return-shipping", language)}`;
    case "delivery-and-return-shipping":
      return `${getStorePolicy("delivery", language)} ${getStorePolicy("return-shipping", language)}`;
    case "return-shipping-and-returns":
      return `${getStorePolicy("returns", language)} ${getStorePolicy("return-shipping", language)}`;
    case "return-shipping":
      return language === "pl"
        ? "Sklep nie podaje kosztu odesłania produktu przy zwrocie ani tego, kto go ponosi."
        : "The store does not state the cost of return shipping or who pays it.";
    case "delivery-and-returns":
      return `${getStorePolicy("delivery", language)} ${getStorePolicy("returns", language)}`;
    case "returns":
      return language === "pl"
        ? `Produkt możesz zwrócić w ciągu ${returnDays} dni od dostawy.`
        : `You can return an item within ${returnDays} days of delivery.`;
    case "delivery":
      return language === "pl"
        ? `W tym sklepie dostawa kosztuje ${deliveryPriceEUR} EUR i trwa od ${earliestBusinessDay} do ${latestBusinessDay} dni roboczych.`
        : `In this store, delivery costs EUR ${deliveryPriceEUR} and takes ${earliestBusinessDay}–${latestBusinessDay} business days.`;
    case "payments":
      return language === "pl"
        ? "Ten sklep demonstracyjny nie przyjmuje płatności ani zamówień."
        : "This demo does not accept payments or place orders.";
    case "demo":
      return language === "pl"
        ? "To sklep demonstracyjny. Możesz dodać produkty do koszyka. Sklep nie przyjmuje płatności ani zamówień."
        : "This is a demonstration store. It does not accept payments or place orders.";
    default:
      return language === "pl"
        ? "Mogę wyjaśnić zasady dostawy, zwrotów i płatności."
        : "Available policy topics: delivery, returns and payments.";
  }
}
