export type Language = "en" | "pl";
const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l");
export function explicitLanguage(text: string): Language | undefined {
  const value = fold(text);
  if (
    /(?:po polsku|in polish|speak polish|odpowiadaj.*polsk|jezyk polski)/.test(
      value,
    )
  )
    return "pl";
  if (
    /(?:po angielsku|in english|speak english|odpowiadaj.*angielsk|jezyk angielski)/.test(
      value,
    )
  )
    return "en";
}
/** Product names alone and UI labels never establish a conversation language. */
export function naturalLanguage(text: string): Language | undefined {
  const value = fold(text);
  const pl =
    (value.match(
      /\b(?:prosze|poprosze|pokaz\w*|szukam|potrzebuje|chce|chcial\w*|dodaj|porownaj|produkt\w*|koszyk\w*|jaki\w*|ktory\w*|tansz\w*|drozsz\w*|fajny|jest|mam|mamy|tylko|wiecej|inne|kaw\w*|dostepn\w*|wybierz|roznic\w*|ile|koszt\w*|dostaw\w*|zwrot\w*|dziekuje|czego|zrobion\w*|ogrod\w*|mebl\w*|tak|nie)\b/g,
    )?.length ?? 0) + (/[ąćęłńóśźż]/i.test(text) ? 1 : 0);
  const en =
    value.match(
      /\b(?:please|show|find|need|want|would|add|compare|which|what|cheaper|cheapest|help|explain|these|this|is|are|only|more|other|yes|no|under|something|hello|hi|tell|thanks|thank)\b/g,
    )?.length ?? 0;
  return pl > en ? "pl" : en > pl ? "en" : undefined;
}
export function resolveLanguage(
  text: string,
  previous: Language,
  uiAction = false,
  pending?: Language,
): Language {
  const explicit = explicitLanguage(text);
  if (explicit) return explicit;
  if (uiAction) return previous;
  if (/^(?:tak|yes|ok|okay|sure|no|nie)[.!\s]*$/i.test(text.trim()))
    return pending ?? naturalLanguage(text) ?? previous;
  return naturalLanguage(text) ?? previous;
}
/** Validates the whole buffered response. It never repairs an unfinished sentence. */
export function assistantTextError(
  text: string,
  finishReason?: string,
  language?: Language,
): string | undefined {
  if (
    finishReason &&
    ["length", "content-filter", "content_filter", "error"].includes(
      finishReason,
    )
  )
    return "PROVIDER_FINISH";
  const value = text.trim();
  if (!value || value.length > 400) return "TEXT_LENGTH";
  if (
    !/[.!?]["”’)]?$/.test(value) ||
    /(?:\bis|\bat\s*[€$£]?|\b(?:and|or|the|with|for)|\b(?:i|oraz|za|jest|to))\s*[.!?]?$/i.test(
      value,
    )
  )
    return "INCOMPLETE_TEXT";
  if (
    /\.\.\.|…|\[\[(?![^\]]+\]\])|(?:\bat\s*(?:€|EUR|\$|£)|(?<![\d\s])\s*[€$£])\s*[.!?]?$/.test(
      value,
    )
  )
    return "INCOMPLETE_REFERENCE";
  const stack: string[] = [];
  const pairs: Record<string, string> = {
    ")": "(",
    "]": "[",
    "}": "{",
    "»": "«",
  };
  const plain = value.replace(/\[\[[^\]]+\]\]/g, "");
  for (const char of plain) {
    if ("([{\u00ab".includes(char)) stack.push(char);
    else if (pairs[char] && stack.pop() !== pairs[char])
      return "UNBALANCED_TEXT";
  }
  if (
    stack.length ||
    (plain.match(/"/g)?.length ?? 0) % 2 ||
    (plain.match(/[„“]/g)?.length ?? 0) !== (plain.match(/”/g)?.length ?? 0)
  )
    return "UNBALANCED_TEXT";
  const quoted = plain.replace(/(?<=\p{L})['’](?=\p{L})/gu, "");
  if (
    (quoted.match(/'/g)?.length ?? 0) % 2 ||
    (quoted.match(/‘/g)?.length ?? 0) !== (quoted.match(/’/g)?.length ?? 0)
  )
    return "UNBALANCED_TEXT";
  const detected = naturalLanguage(value);
  if (language && detected && detected !== language) return "WRONG_LANGUAGE";
}
