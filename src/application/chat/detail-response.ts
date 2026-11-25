import type { Product } from "@/domain/catalog/product";
import type { Language } from "./assistant-text";

const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll("ł", "l");

const materialsPL: Record<string, string> = {
  "glazed ceramic": "ceramika szkliwiona", glass: "szkło", "walnut wood": "drewno orzechowe",
  stoneware: "kamionka", "stainless steel": "stal nierdzewna", "brass-finish metal": "metal z mosiężnym wykończeniem",
  paper: "papier", metal: "metal", linen: "len", "cushion filling": "wypełnienie poduszki", wool: "wełna",
  wax: "wosk", cloth: "tkanina", brass: "mosiądz", "woven natural fibre": "plecione włókno naturalne",
  terracotta: "terakota", steel: "stal", cotton: "bawełna", "solid oak": "lite drewno dębowe",
  "boucle fabric": "tkanina bouclé", "oak wood": "drewno dębowe", wood: "drewno", reeds: "patyczki",
  "amber glass": "bursztynowe szkło", stone: "kamień", plastic: "tworzywo sztuczne",
  "cushioned fabric": "tkanina z wypełnieniem", fabric: "tkanina", aluminium: "aluminium", felt: "filc",
  "cotton canvas": "płótno bawełniane", ceramic: "ceramika", bamboo: "bambus", cork: "korek",
  wire: "drut", rubber: "guma", "powder-coated steel": "stal malowana proszkowo",
  polyester: "poliester", foam: "pianka", latex: "lateks", filling: "wypełnienie",
};
export function materialLabel(material: string, language: Language): string | undefined {
  if (language === "en") return material;
  const parts = material.split(" and ").map((part) => materialsPL[part]);
  return parts.every(Boolean) ? parts.join(" i ") : undefined;
}

/** Answer simple recorded fields from the canonical product. Do not infer other attributes. */
export function detailQuestionResponse(product: Product, request: string, language: Language, allowSplit = true): { text: string; needsModel: boolean } | undefined {
  const text = fold(request);
  const asksPrice = /\b(?:cena|cene|ceny|cenie|kosztuje|prices?|costs?|how much)\b/.test(text);
  const asksAvailability = /\b(?:dostepn\w*|in stock|available|availability)\b/.test(text);
  const asksMaterial = /\b(?:material\w*|materia\w*|made of|made from|z czego|wykonan\w*|zrobion\w*)\b/.test(text);
  const asksDimensions = /\b(?:wymiar\w*|dimensions?|measurements?)\b/.test(text);
  const asksCapacity = /\b(?:pojemnosc\w*|capacity|volume)\b/.test(text);
  const fieldCount = [asksPrice, asksAvailability, asksMaterial, asksDimensions, asksCapacity].filter(Boolean).length;
  const namesField = fieldCount > 0;
  const generalDetails = /\b(?:tell me more|powiedz mi wiecej)\b/.test(text) &&
    !namesField && !/\b(?:what|which|how|does|is|are|can|czy|jak\w*|ile)\b/.test(text);
  const asksFact = namesField || /\?/.test(text) || /\b(?:what|which|how|does|is|are|can|czy|jak\w*|ile|temperature|udzwig|wage)\b/.test(text);
  if (generalDetails || !asksFact) return undefined;
  // Multiple requested facts require contextual interpretation; do not imply one answers the rest.
  const compound = fieldCount > 1 || (text.match(/\?/g)?.length ?? 0) > 1 || /\b(?:oraz|and|also|takze)\b/.test(text) || /\b(?:i|a)\s+(?:czy|jak\w*|ile|what|how|is|does)\b/.test(text);
  if (compound && allowSplit) {
    const clauses = text.split(/\?|\b(?:oraz|and|also|takze)\b|\b(?:i|a)\s+(?=czy\b|jak\w*\b|ile\b|what\b|how\b|is\b|does\b|cen[ae]\b|dostepn|wymiar|material|pojemnosc)/).map((part) => part.trim()).filter(Boolean);
    const parts = clauses.map((clause) => detailQuestionResponse(product, `${clause}?`, language, false));
    if (parts.length > 1 && parts.every(Boolean) && parts.some((part) => !part!.needsModel)) {
      const known = parts.filter((part) => !part!.needsModel).map((part) => part!.text);
      const unresolved = parts.some((part) => part!.needsModel);
      return {
        text: [...known, ...(unresolved ? [language === "pl" ? "Nie potrafię potwierdzić pozostałych informacji na podstawie dostępnych danych." : "I cannot confirm the remaining information from the available data."] : [])].join(" "),
        needsModel: false,
      };
    }
  }
  if (!compound && asksDimensions && !/temperatur|waga|wazy|weight|weigh\w*|udzwig|load|pojemnosc|capacity/.test(text)) {
    const dimensions = language === "pl" ? product.dimensions
      .replace(/\bhigh each\b/g, "wysokości każda")
      .replace(/\bhigh with reeds\b/g, "wysokości z patyczkami")
      .replace(/\bhigh\b/g, "wysokości")
      .replace(/\blong\b/g, "długości")
      .replace(/\bdiameter\b/g, "średnicy")
      .replace(/\bfolded\b/g, "po złożeniu")
      .replace(/\beach\b/g, "każdy")
      .replace(/\bcapacity\b/g, "pojemności")
      .replace(/\blitre\b/g, "litr")
      .replace(/\bone adult size\b/g, "jeden rozmiar dla dorosłych")
      .replace(/\bloop length\b/g, "długości pętli")
      .replace(/\band\b/g, "i") : product.dimensions;
    return { text: language === "pl" ? `Wymiary podane w katalogu: ${dimensions}.` : `Catalog dimensions: ${dimensions}.`, needsModel: false };
  }
  if (!compound && asksMaterial && !/temperatur|waga|wazy|weight|weigh\w*|udzwig|load|pojemnosc|capacity/.test(text)) {
    const material = materialLabel(product.material, language);
    if (material) return { text: language === "pl" ? `Materiał podany w katalogu: ${material}.` : `Catalog material: ${material}.`, needsModel: false };
  }
  if (!compound && asksCapacity) {
    const capacity = /\b(\d+(?:[.,]\d+)?\s*(?:ml|litres?|liters?|l))\s+capacity\b/i.exec(product.dimensions)?.[1];
    if (capacity) return { text: language === "pl" ? `Pojemność podana w katalogu: ${capacity.replace(/litres?/i, "litr")}.` : `Catalog capacity: ${capacity}.`, needsModel: false };
  }
  if (!compound && asksPrice && !/temperatur|waga|wazy|weight|weigh\w*|udzwig|load|pojemnosc|capacity/.test(text))
    return { text: language === "pl" ? `Cena produktu ${product.name} to ${product.price.toFixed(2)} EUR.` : `The price of ${product.name} is EUR ${product.price.toFixed(2)}.`, needsModel: false };
  const qualifiedAvailability = /\b(?:w kolorze|w rozmiarze|in (?:a )?(?:different|specific) (?:colour|color|size))\b|\b(?:dostepn\w*|available)\s+(?:w|in)\s+(?!(?:sklepie|katalogu|sprzedazy|magazynie|tym sklepie|the (?:store|shop|catalog)|stock)\b)/.test(text);
  if (!compound && asksAvailability && !qualifiedAvailability && !/temperatur|waga|wazy|weight|weigh\w*|udzwig|load|pojemnosc|capacity/.test(text))
    return { text: language === "pl" ? (product.inStock ? "Produkt jest dostępny." : "Produkt jest obecnie niedostępny.") : (product.inStock ? "This product is in stock." : "This product is currently out of stock."), needsModel: false };
  if (/temperatur|heat.resistan|zaroodporn|heat.safe/.test(text))
    return { text: language === "pl"
      ? `Na podstawie opisu produktu ${product.name} nie potrafię potwierdzić, jaką temperaturę wytrzymuje.`
      : `I cannot confirm the temperature ${product.name} can withstand from its catalog description.`, needsModel: true };
  if (/udzwig|obciazen|\bload\b|weight limit|weight capacity/.test(text))
    return { text: language === "pl"
      ? `Na podstawie opisu produktu ${product.name} nie potrafię potwierdzić jego maksymalnego obciążenia.`
      : `I cannot confirm the maximum load for ${product.name} from its catalog description.`, needsModel: true };
  return {
    text: language === "pl"
      ? `Nie potrafię potwierdzić odpowiedzi na pytanie o ${product.name} na podstawie dostępnych danych.`
      : `I cannot confirm the answer about ${product.name} from the available product information.`,
    needsModel: true,
  };
}

export type GroundedDetailAnswer = {
  status: "supported" | "missing";
  answer: string;
  source?: "description" | "dimensions" | "material" | "features" | "limitations" | "productType" | "useEnvironment";
  quote?: string;
};

/** Verify that the quoted source and all numbers occur in the current canonical record. */
export function groundedDetailAnswer(product: Product, value: GroundedDetailAnswer): string | undefined {
  if (value.status !== "supported" || !value.source || !value.quote) return;
  const field = product[value.source];
  const records = Array.isArray(field) ? field : value.source === "description" ? field.split(/(?<=[.!?])\s+/) : [field];
  if (!records.some((record) => record.trim() === value.quote!.trim())) return;
  const quote = fold(value.quote);
  const answer = fold(value.answer);
  const isNegative = (text: string) => /\b(?:not|no|never|without|neither|cannot|can't|doesn't|do not|lack\w*|nie|bez|brak\w*)\b/.test(text);
  if (isNegative(quote) !== isNegative(answer)) return;
  const thermalClaim = /temperatur|heat|thermal|heatproof|heat.?resistan|oven.?safe|hot|gorac|zaroodporn|ciepl|wrzat/.test(answer);
  const thermalSource = /temperatur|heat|thermal|heatproof|heat.?resistan|oven.?safe|hot\s+(?:liquid|drink)|boiling/.test(quote);
  if (thermalClaim && !thermalSource) return;
  const loadClaim = /udzwig|obciaz|dzwig|nosnosc|load|weight|weigh|kg|kilogram|pounds?|lbs?/.test(answer);
  const loadSource = /\b(?:load|weight|weigh|weight-bearing|lbs?|pounds?)\b|\b\d+(?:[.,]\d+)?\s*kg\b/.test(quote);
  if (loadClaim && !loadSource) return;
  const numericWords: Record<string, string> = {
    one: "1", jeden: "1", jedna: "1", two: "2", dwa: "2", dwie: "2", three: "3", trzy: "3",
    four: "4", cztery: "4", five: "5", piec: "5", six: "6", szesc: "6", seven: "7", siedem: "7",
    eight: "8", osiem: "8", nine: "9", dziewiec: "9", ten: "10", dziesiec: "10",
  };
  const numbers = (text: string) => (fold(text).match(/\b(?:\d+(?:[.,]\d+)?|one|jeden|jedna|two|dwa|dwie|three|trzy|four|cztery|five|piec|six|szesc|seven|siedem|eight|osiem|nine|dziewiec|ten|dziesiec)\b/g) ?? [])
    .map((number) => numericWords[number] ?? number.replace(",", "."));
  const sourceNumbers = numbers(value.quote);
  if (numbers(value.answer).some((number) => !sourceNumbers.includes(number))) return;
  // A matching numeral with a different unit is not the same recorded measurement.
  const measurements = (text: string) => [...fold(text).matchAll(/\b(\d+(?:[.,]\d+)?)\s*(mm|cm|m|kg|g|ml|l|°c|celsius|eur)\b/g)]
    .map((match) => `${match[1].replace(",", ".")}:${match[2]}`);
  const sourceMeasurements = measurements(value.quote);
  if (measurements(value.answer).some((measurement) => !sourceMeasurements.includes(measurement))) return;
  return value.answer;
}
