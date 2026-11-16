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
export function getStorePolicy(topic: string): string {
  const kind = resolvePolicyTopic(topic);
  if (kind === "returns") return "Demo policy: returns are accepted within 14 days of delivery.";
  if (kind === "delivery") return "Demo policy: delivery costs EUR 4 and takes 2-3 business days.";
  if (kind === "payments") return "This demo does not accept payments or place orders.";
  if (kind === "demo") return "This is a demonstration store. It does not accept payments or place orders.";
  return "Available policy topics: delivery, returns and payments.";
}
