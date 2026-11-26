import { z } from "zod";
import type { Language } from "./assistant-text";

const quote = z.string().trim().min(1).max(180).nullable();
export const shopperIdentitySchema = z.object({ nameQuote: quote, occupationQuote: quote });
type IdentityEvidence = z.infer<typeof shopperIdentitySchema>;

const nameQuestion = /\b(?:imi[eę]|name)(?![\p{L}\p{N}])/iu;
const occupationQuestion = /zaw[oó]d|zawod|zajmuj|profess|occupation|job|for (?:a living|work)/iu;
const declaration = /^(?:jestem|mam na imi[eę]|nazywam si[eę]|pracuj[eę]|zajmuj[eę] si[eę]|m[oó]j zaw[oó]d|moje imi[eę]|i(?:['’]m| am| work| teach)|my (?:name|job|profession|occupation))(?=\s|$|[,.:])/iu;
const speculation = /(?:\b(?:gdyby\w*|je[sś]li|mo[zż]e|hipotetycznie|czy|nie|by[cć] mo[zż]e|if|maybe|perhaps|might|would|not|said|says|quote|wrote)\b|powiedzia|napisa[łl]|cytat)/iu;

/** Quote a personal detail only when the shopper supplied a first-person statement in this thread. */
function supportedQuote(candidate: string | null, messages: string[], field: "name" | "occupation"): string | undefined {
  const text = candidate?.trim().replace(/[.!]+$/u, "").trim();
  if (!text || !declaration.test(text)) return;
  const explicitName = /mam na imi[eę]|nazywam si[eę]|moje imi[eę]|my name/iu.test(text);
  const explicitWork = /pracuj[eę]|zajmuj[eę] si[eę]|m[oó]j zaw[oó]d|i work|i teach|my (?:job|occupation|profession)|i(?: am|['’]m) (?:a|an) /iu.test(text);
  if ((field === "name" && explicitWork && !explicitName) || (field === "occupation" && explicitName && !explicitWork && !/\bjestem\b/iu.test(text))) return;
  for (const message of messages) {
    for (const sentence of message.match(/[^.!?\n]+[.!?]?/gu) ?? []) {
      const at = sentence.indexOf(text);
      if (at < 0 || sentence.endsWith("?") || speculation.test(sentence)) continue;
      const prefix = sentence.slice(0, at).trim();
      if (prefix && !/^(?:(?:cześć|hej|dzień dobry|hi|hello)[, –-]*|[^:"“„»«]+[,;]\s*)$/iu.test(prefix)) continue;
      const end = sentence.slice(at + text.length);
      if (end.trim() && !/^\s*(?:[.!?,;]|(?:and|i|a)\s)/iu.test(end)) continue;
      return text;
    }
  }
}

export function shopperIdentityReply(evidence: IdentityEvidence, messages: string[], question: string, language: Language): string {
  const lastClause = question.split(/[.!?\n]+/u).map(clause => clause.trim()).filter(Boolean).at(-1) ?? question;
  const asksName = nameQuestion.test(lastClause);
  const asksWork = occupationQuestion.test(lastClause);
  const name = supportedQuote(evidence.nameQuote, messages, "name");
  const work = supportedQuote(evidence.occupationQuote, messages, "occupation");
  const selected: string[] = [];
  if (name && (asksName || !asksWork)) selected.push(name);
  if (work && (asksWork || !asksName) && !selected.includes(work)) selected.push(work);
  const noName = language === "pl" ? "Nie znam jeszcze Twojego imienia." : "I don’t know your name yet.";
  const noWork = language === "pl" ? "Nie znam jeszcze Twojego zawodu." : "I don’t know your occupation yet.";
  if (!selected.length) {
    if (asksName !== asksWork) return asksName ? noName : noWork;
    return language === "pl" ? "Nie znam jeszcze Twojego imienia ani zawodu." : "I don’t know your name or occupation yet.";
  }
  const quoted = selected.map(value => language === "pl" ? `„${value}”` : `“${value}”`).join(language === "pl" ? " i " : " and ");
  const known = language === "pl" ? `Pamiętam Twoje słowa ${quoted}.` : `You told me ${quoted}.`;
  return asksName && asksWork && (!name || !work) ? `${known} ${name ? noWork : noName}` : known;
}
