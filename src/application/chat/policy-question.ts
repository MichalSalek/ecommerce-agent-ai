import { normalizePolicyText, resolvePolicyTopic, storePolicy } from "@/domain/catalog/policies";

/** Skip continuation only when every part of the question is covered by the requested policy facts. */
export function directlyAnsweredByPolicy(request: string, topic: string): boolean {
  const kind = resolvePolicyTopic(topic);
  if (kind === "overview" || kind === "payments" || kind === "demo" || resolvePolicyTopic(request) !== kind) return false;
  const words = normalizePolicyText(request).match(/[a-z0-9]+/g) ?? [];
  const includesDelivery = kind === "delivery" || kind.startsWith("delivery-and-");
  const includesReturns = kind === "returns" || kind.includes("and-returns");
  const includesPostage = kind.includes("return-shipping");
  const common = /^(?:a|an|the|i|if|it|is|are|do|does|can|what|how|much|many|long|to|for|of|your|and|who|policy|kto|co|ile|jak|jaki|jaka|jest|mam|mamy|moge|na|za|od|do|w|czy|sie|was|u|przy|oraz)$/;
  const delivery = /^(?:dostaw[a-z]*|wysyl[a-z]*|koszt[a-z]*|cen[a-z]*|trwa[a-z]*|czek[a-z]*|dlugo|deliver[a-z]*|shipping|costs?|price|takes?|days?|dni|dniach|dzien|roboczych|business)$/;
  const returns = /^(?:zwrot[a-z]*|zwroc[a-z]*|termin[a-z]*|dokonanie|return[a-z]*|period|item|products?|produkt[a-z]*|have|time|window|within|ciagu|days?|dni|dniach|dzien|czasu|delivery|dostawy|fourteen|czternascie|czternastu)$/;
  const postage = /^(?:pays?|paid|paying|costs?|price|fees?|shipping|delivery|postage|returns?|returning|refund|item|product|plac[a-z]*|plat[a-z]*|koszt[a-z]*|cen[a-z]*|oplat[a-z]*|wysyl[a-z]*|odesl[a-z]*|odsyl[a-z]*|zwrot[a-z]*|zwroc[a-z]*|produkt[a-z]*|towar[a-z]*|ponosi)$/;
  return words.length > 0 && words.every((word) => common.test(word) ||
    (includesDelivery && delivery.test(word)) ||
    (includesReturns && (returns.test(word) || word === String(storePolicy.returnDays))) ||
    (includesPostage && postage.test(word)));
}
