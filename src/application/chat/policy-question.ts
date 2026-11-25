import { resolvePolicyTopic } from "@/domain/catalog/policies";

/** These simple questions are answered in full by the published rate or return window. */
export function directlyAnsweredByPolicy(request: string, topic: string): boolean {
  const kind = resolvePolicyTopic(topic);
  if ((kind !== "returns" && kind !== "delivery") || resolvePolicyTopic(request) !== kind) return false;
  const words = request.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll("ł", "l").match(/[a-z0-9]+/g) ?? [];
  const question = /^(?:a|i|ile|jak|jaki|jaka|jest|mam|mamy|moge|na|za|od|do|czy|sie|was|u|dni|dniach|dzien|roboczych|czasu|what|how|much|many|long|does|do|it|is|are|the|and|to|your|of|can|i|have|days?|business|time|window|policy)$/;
  const subject = kind === "delivery"
    ? /^(?:dostaw[a-z]*|wysyl[a-z]*|koszt[a-z]*|cen[a-z]*|trwa[a-z]*|czek[a-z]*|dlugo|deliver[a-z]*|shipping|costs?|price|takes?)$/
    : /^(?:zwrot[a-z]*|zwroc[a-z]*|termin[a-z]*|dokonanie|return[a-z]*|period|item|product|produkt)$/;
  return words.length > 0 && words.every(word => question.test(word) || subject.test(word));
}
