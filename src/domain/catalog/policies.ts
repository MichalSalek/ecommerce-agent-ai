export function getStorePolicy(topic: string): string {
  const normalized = topic.toLowerCase();
  if (/return|refund/.test(normalized))
    return "Demo policy: returns are accepted within 14 days of delivery.";
  if (/deliver|ship/.test(normalized))
    return "Demo policy: delivery costs EUR 4 and takes 2-3 business days.";
  if (/pay|order/.test(normalized))
    return "This demo does not accept payments or place orders.";
  return "Available policy topics: delivery, returns and payments.";
}
