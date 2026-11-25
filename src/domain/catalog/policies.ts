export const storePolicy = {
  deliveryPriceEUR: 4,
  earliestBusinessDay: 2,
  latestBusinessDay: 3,
  returnDays: 14,
};

export function resolvePolicyTopic(topic: string): "returns" | "delivery" | "payments" | "demo" | "overview" {
  const normalized = topic.toLowerCase();
  if (/return|refund|zwrot/.test(normalized))
    return "returns";
  if (/deliver|ship|dostaw|wysy/.test(normalized))
    return "delivery";
  if (/pay|order|płat|plat|zamów/.test(normalized))
    return "payments";
  if (/\bdemo\b|demonstrat|demonstrac|portfolio/.test(normalized))
    return "demo";
  return "overview";
}
export function getStorePolicy(topic: string, language: "en" | "pl" = "en"): string {
  const { deliveryPriceEUR, earliestBusinessDay, latestBusinessDay, returnDays } = storePolicy;
  switch (resolvePolicyTopic(topic)) {
    case "returns":
      return language === "pl"
        ? `Produkt można zwrócić w ciągu ${returnDays} dni od dostawy.`
        : `Demo policy: returns are accepted within ${returnDays} days of delivery.`;
    case "delivery":
      return language === "pl"
        ? `Przykładowa dostawa kosztuje ${deliveryPriceEUR} EUR i trwa od ${earliestBusinessDay} do ${latestBusinessDay} dni roboczych.`
        : `Demo policy: delivery costs EUR ${deliveryPriceEUR} and takes ${earliestBusinessDay}-${latestBusinessDay} business days.`;
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
