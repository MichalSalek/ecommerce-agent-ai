import { products } from "@/data/products";
import { productKinds, productTypes } from "@/domain/catalog/taxonomy";
import {
  functionalGroups,
  functionalGroupNames,
  groupScopeTypes,
} from "@/domain/catalog/functional-groups";
import { allowedCriteria } from "@/domain/catalog/requirements";
import { MATERIAL_FACTS } from "@/domain/catalog/material-facts";
import { catalogMaterial } from "@/application/catalog/material-language";
import { categoryLabels } from "@/domain/catalog/category-labels";
import { mentionsBudget } from "./product-references";
import { canonicalSemanticQuery } from "./query-language";
import type { AgentState, Transition } from "./shopping-v3";
export const explicitFacetNames = ["kind", "type", "excludeType", "category", "material"] as const;
export type ExplicitFacet = {
  facet: typeof explicitFacetNames[number];
  value: string;
  userQuote?: string;
};
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l");
function mentions(text: string, aliases: readonly string[], exact = false) {
  const normalized = fold(text);
  return aliases.some((alias) =>
    new RegExp(
      `\\b${fold(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${exact ? "\\b" : ""}`,
      "i",
    ).test(normalized),
  );
}
function aliases(facet: ExplicitFacet): string[] {
  if (facet.facet === "kind") {
    if (facet.value === "decor")
      return [
        "home decor",
        "decorations",
        "dekoracje",
        "dekoracji",
        "ozdoby",
        "ozdob",
      ];
    const kind = productKinds[facet.value];
    return kind ? [kind.en, kind.pl, ...kind.aliases] : [facet.value];
  }
  if (facet.facet === "category")
    return [facet.value, categoryLabels[facet.value] ?? facet.value];
  const type = productTypes[facet.value];
  return type
    ? [type.en, type.pl, ...type.aliases]
    : [facet.value.replaceAll("-", " "), facet.value];
}

// A model may return the shopper-facing type label rather than the catalog ID.
// Only an unambiguous exact alias is eligible for normalization.
function normalizeTypeFacet(filter: ExplicitFacet): ExplicitFacet {
  if ((filter.facet !== "type" && filter.facet !== "excludeType") || allowedCriteria.productType.includes(filter.value)) return filter;
  const label = fold(filter.value.trim());
  const matches = Object.entries(productTypes).filter(([, type]) =>
    [type.en, type.pl, ...type.aliases].some(name => fold(name) === label));
  return matches.length === 1 ? { ...filter, value: matches[0][0] } : filter;
}

// Only recover a kind when both sources name it in a positive, non-quoted
// clause. This deliberately leaves uncertain interpretation to the model.
function positiveClauses(text: string): string[] {
  return fold(text)
    .replace(/"[^"\n]*"|“[^”\n]*”|„[^”\n]*”|'[^'\n]*'/g, " ")
    .split(/(?<!\d)\.|\.(?!\d)|[!?;\n]+|\b(?:but|ale|jednak)\b/)
    .filter(
      (clause) =>
        !/\b(?:if|unless|suppose|hypothetically|jesli|jezeli|gdyby|hipotetycznie)\b/.test(
          clause,
        ),
    );
}
function negatedAt(clause: string, index: number): boolean {
  return /\b(?:not|no|never|without|dont|don't|nie|bez|zadn\w*)(?:\s+\w+){0,2}\s*$/.test(
    clause.slice(0, index),
  );
}
function explicitConstraints(text: string): {
  maxPrice?: number;
  requestedCount?: number;
  inStockOnly?: true;
  issues: string[];
} {
  const clauses = positiveClauses(text);
  const amounts = new Set<number>();
  const counts = new Set<number>();
  const issues: string[] = [];
  let inStockOnly: true | undefined;
  const currency =
    "(?:eur|euros?|€|usd|gbp|pln|dollars?|pounds?|zlot(?:y|ych|e)?|zl|\\$|£)";
  const budget = new RegExp(
    `\\b(?:under|below|up\\s+to|at\\s+most|maximum|max|ponizej|do|maksymalnie|maksimum|nie\\s+wiecej\\s+niz)\\s*(?:(${currency})\\s*)?(\\d+(?:[.,]\\d{1,2})?)(?!\\d|[.,]\\d)\\s*(?:(${currency})(?![a-z]))?`,
    "g",
  );
  const numbers: Record<string, number> = {
    "4": 4,
    four: 4,
    cztery: 4,
    "5": 5,
    five: 5,
    piec: 5,
    "10": 10,
    ten: 10,
    dziesiec: 10,
    "20": 20,
    twenty: 20,
    dwadziescia: 20,
    all: 1000,
    wszystkie: 1000,
    wszystkich: 1000,
  };
  const countPattern =
    /\b(4|5|10|20|four|five|ten|twenty|cztery|piec|dziesiec|dwadziescia|all|wszystkie|wszystkich)\s+(?:the\s+)?(?:(?!(?:eur|usd|gbp|pln|euro|dollars?|people|persons?|osob|cm|mm|kg)\b)[a-z]+\s+){0,2}(?:products?|items?|options?|proposals?|recommendations?|produkty|produktow|produkt|propozycj\w*|opcj\w*)\b/g;
  for (const clause of clauses) {
    for (const match of clause.matchAll(budget)) {
      if (negatedAt(clause, match.index ?? 0)) continue;
      const following = clause.slice((match.index ?? 0) + match[0].length);
      if (
        !match[1] &&
        !match[3] &&
        /^(?:[a-z]+\s+){0,2}(?:products?|items?|options?|proposals?|recommendations?|produkty|produktow|propozycj\w*|opcj\w*|people|persons?|osob|cm|mm|kg|meters?|metrow)\b/.test(
          following.trimStart(),
        )
      )
        continue;
      const currencies = [match[1], match[3]].filter(Boolean);
      if (currencies.some((value) => !/^(?:eur|euros?|€)$/.test(value))) {
        issues.push(
          "The stated budget uses a currency other than EUR; clarify the amount without conversion.",
        );
        continue;
      }
      const amount = Number(match[2].replace(",", "."));
      if (Number.isFinite(amount) && amount >= 0) amounts.add(amount);
    }
    for (const match of clause.matchAll(countPattern)) {
      if (!negatedAt(clause, match.index ?? 0)) counts.add(numbers[match[1]]);
    }
    if (
      /\b(?:show|list|display|pokaz|wyswietl)\s+(?:me\s+)?(?:everything|wszystko)\b/.test(
        clause,
      )
    )
      counts.add(1000);
    const stock =
      /\b(?:only\s+(?:(?:currently|available)\s+)?(?:in[ -]stock|available)|only\s+(?:products|items)\s+(?:in[ -]stock|available)|tylko\s+(?:obecnie\s+)?dostepn\w*|tylko\s+produkty\s+dostepn\w*)\b/g;
    for (const match of clause.matchAll(stock))
      if (!negatedAt(clause, match.index ?? 0)) inStockOnly = true;
  }
  if (amounts.size > 1)
    issues.push(
      "Multiple price limits were stated; clarify the intended maximum.",
    );
  if (counts.size > 1)
    issues.push(
      "Multiple result counts were stated; clarify the intended count.",
    );
  return {
    maxPrice: amounts.size === 1 ? [...amounts][0] : undefined,
    requestedCount: counts.size === 1 ? [...counts][0] : undefined,
    inStockOnly,
    issues,
  };
}
function positivelyMentions(
  clause: string,
  terms: readonly string[],
  exact = false,
  usage: "subject" | "purpose" = "subject",
): boolean {
  return terms.some((term) => {
    const escaped = fold(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}${exact ? "\\b" : "\\w*"}`, "g");
    for (const match of clause.matchAll(pattern)) {
      const prefix = clause.slice(0, match.index).trimEnd();
      // A relation such as a cover for furniture does not request furniture.
      if (
        usage === "subject" && /\b(?:for|do|na)\s*$/.test(prefix) &&
        !/\b(?:look(?:ing)?|search(?:ing)?|shop(?:ping)?)\s+for$/.test(prefix)
      )
        continue;
      if (
        /\b(?:not|no|never|without|exclude|except|don'?t|doesn'?t|isn'?t|aren'?t|nie|bez|zadn\w*)(?:\s+\w+){0,2}\s*$/.test(
          prefix,
        )
      )
        continue;
      const suffix = clause.slice((match.index ?? 0) + match[0].length);
      if (/^\s+(?:is|are)\s+not\s+(?:wanted|requested|needed)\b/.test(suffix))
        continue;
      return true;
    }
    return false;
  });
}
function hardMaterialMention(text: string, terms: string[], quote?: string): boolean {
  if (quote && (!fold(text).includes(fold(quote)) || !mentions(quote, terms))) return false;
  return positiveClauses(text).some(clause => {
    if (/\b(?:prefer\w*|ideally|optional\w*|or|lub|albo|ewentualnie|wole|najchetniej|najlepiej|mile widzian\w*)\b/.test(clause)) return false;
    // The material in “a cover for my ceramic mug” belongs to the mug.
    const subject = clause.replace(/\b(?:for|do|dla|na)\s+(?!(?:sale|sprzedazy)\b)/g, (match, index: number) =>
      /\b(?:look(?:ing)?|search(?:ing)?|shop(?:ping)?)\s*$/.test(clause.slice(0, index)) ? match : "|").split("|")[0];
    return positivelyMentions(subject, terms);
  });
}

const escapeTerm = (term: string) => fold(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function directlyRequestsProductType(text: string, terms: readonly string[], materialTerms: string[] = []): boolean {
  const labels = terms.map(escapeTerm).sort((a, b) => b.length - a.length);
  const material = materialTerms.length ? `(?:(?:${materialTerms.map(escapeTerm).join("|")})\\w*\\s+)?` : "";
  const target = new RegExp(`\\b(?:szukam|pokaz(?: mi)?|poprosze o|chce kupic|find(?: me)?|show me|looking for|i (?:want|need))(?: (?:a|an|some|the))? ${material}(?:${labels.join("|")})\\b(?=\\s*(?:$|[,.;!?]|(?:do|dla|for|under|below|within|up to|za|ponizej)\\b))`);
  return positiveClauses(text).some(clause => target.test(clause) &&
    !/\b(?:nie|bez|not|no|without|or|lub|albo|and|oraz)\b|\bi (?!want\b|need\b)/.test(clause));
}
/** A complete material + noun on both sides can ground an inflected wire quote without discarding other qualifiers. */
function materialTypeScope(text: string, query: string, filters: ExplicitFacet[], required: string[]) {
  const claimed = new Set([...required, ...filters.filter(filter => filter.facet === "material").map(filter => filter.value)]);
  const candidates = [...new Set([...Object.keys(MATERIAL_FACTS), ...claimed])];
  const normalized = fold(query.trim());
  for (const candidate of candidates) {
    const material = catalogMaterial(candidate);
    if (!material || !hardMaterialMention(text, material.terms)) continue;
    const modifier = new RegExp(`\\b(?:${material.terms.map(escapeTerm).join("|")})\\w*\\b`, "g");
    const noun = normalized.replace(modifier, " ").replace(/\s+/g, " ").trim();
    if (noun === normalized && !claimed.has(candidate)) continue;
    const types = Object.entries(productTypes).filter(([, type]) => {
      const names = [type.en, type.pl, ...type.aliases];
      return names.some(name => fold(name) === noun) && directlyRequestsProductType(text, names, material.terms);
    });
    if (types.length === 1) return { typeId: types[0][0], material: material.key, terms: material.terms };
  }
}

function recoverKind(
  text: string,
  query: string,
): { kind?: string; ambiguous?: boolean } {
  const current = positiveClauses(text);
  const semantic = positiveClauses(query);
  const names = (kind: string) => aliases({ facet: "kind", value: kind });
  const candidates = Object.keys(productKinds).filter(
    (kind) =>
      current.some((clause) =>
        positivelyMentions(clause, names(kind), kind === "decor"),
      ) &&
      semantic.some((clause) =>
        positivelyMentions(clause, names(kind), kind === "decor"),
      ),
  );
  if (candidates.length !== 1) return { ambiguous: candidates.length > 1 };
  const kind = candidates[0];
  const relevant = current.filter((clause) =>
    positivelyMentions(clause, names(kind), kind === "decor"),
  );
  const otherKind = relevant.some((clause) =>
    Object.keys(productKinds).some(
      (other) =>
        other !== kind &&
        positivelyMentions(clause, names(other), other === "decor"),
    ),
  );
  const otherType = relevant.some((clause) =>
    Object.values(productTypes).some(
      (type) =>
        type.kind !== kind &&
        positivelyMentions(clause, [type.en, type.pl, ...type.aliases]),
    ),
  );
  return otherKind || otherType ? { ambiguous: true } : { kind };
}
// Only resolve the closed outdoor-furniture intent when the current sentence
// positively names that subject and contains no competing scope or relation.
function outdoorFurnitureIntent(text: string): boolean {
  const normalized = fold(text);
  if (/["“”„']/.test(text) || /\b(?:and|or|oraz|albo|lub|i|but|ale|except|without|bez)\b/.test(normalized))
    return false;
  if (/\b(?:cover\w*|pokrow\w*|oslon\w*|cushion\w*|poduszk\w*|accessor\w*|akcesori\w*|indoor\w*|wewnatrz|domow\w*)\b/.test(normalized))
    return false;
  const clauses = positiveClauses(text).map((clause) => clause.trim()).filter(Boolean);
  if (clauses.length !== 1) return false;
  const clause = clauses[0];
  const namesFurniture = positivelyMentions(clause, productKinds.furniture.aliases);
  const named = /\b(?:(?:garden|outdoor|outdoors|patio)\s+furnitur\w*|furnitur\w*\s+(?:for\s+(?:the\s+)?)?(?:garden|outdoors?)|mebl\w*\s+(?:ogrod\w*|do\s+ogrodu|na\s+zewnatrz))\b/.exec(clause);
  if (!namesFurniture || !named) return false;
  const prefix = clause.slice(0, named.index).trimEnd();
  if (/\b(?:for|do|na)\s*$/.test(prefix) &&
      !/\b(?:look(?:ing)?|search(?:ing)?|shop(?:ping)?)\s+for$/.test(prefix)) return false;
  if (Object.values(productTypes).some((type) =>
    positivelyMentions(clause, [type.en, type.pl, ...type.aliases]))) return false;
  return recoverKind(text, text).kind === "furniture";
}

function normalizeFunctionalTransition(
  text: string, before: AgentState, change: Transition, filters: ExplicitFacet[],
): Transition {
  if ((change.operation !== "new" && change.operation !== "refine") || change.remove?.length) return change;
  // The model can repeat the inherited kind as a hard facet or as a same-named
  // department. An existing kind adds no restriction to a simple refinement.
  if (filters.some((filter) =>
    (filter.facet !== "kind" && filter.facet !== "category") ||
    fold(filter.value) !== before.criteria.productKind ||
    (filter.userQuote && !fold(text).includes(fold(filter.userQuote))))) return change;
  const normalized = fold(text);
  if (/\b(?:not|no|never|without|exclude|except|dont|don't|nie|bez|zadn\w*|instead|switch|reset|restart|nowa|nowo|zmien\w*|zamiast)\b/.test(normalized)) return change;
  if (change.criteria.useEnvironment && before.criteria.useEnvironment &&
      change.criteria.useEnvironment !== before.criteria.useEnvironment) return change;
  const alternative = /\b(?:inne|innych|innymi|kolejne|kolejnych|wiecej|other|another|different|more)\b/.test(normalized) &&
    !/\b(?:more\s+than|wiecej\s+niz)\b/.test(normalized);
  const intentText = alternative
    ? normalized.replace(/\b(?:inne|innych|innymi|kolejne|kolejnych|wiecej|other|another|different|more|propozycj\w*|suggestions?|alternatives?|options?|results?)\b/g, " ")
    : normalized;
  const intent = functionalRefinement(intentText, before);
  if (!intent?.simple || (change.criteria.functionalGroup && change.criteria.functionalGroup !== intent.group)) return change;
  const allNamedGroups = functionalGroupNames.filter((group) =>
    positiveClauses(text).some((clause) => positivelyMentions(clause, functionalGroups[group].aliases, false, "purpose")));
  if (allNamedGroups.length !== 1 || allNamedGroups[0] !== intent.group) return change;
  return {
    ...change,
    operation: alternative && before.shownIds.length ? "more" : "refine",
    criteria: { ...change.criteria, functionalGroup: intent.group },
    // A model's generic defaults do not replace established user choices.
    ...(explicitConstraints(text).requestedCount === undefined ? { requestedCount: undefined } : {}),
    ...(change.preferences?.length === 0 ? { preferences: undefined } : {}),
    ...(change.persistentPreferences?.length === 0 ? { persistentPreferences: undefined } : {}),
  };
}

function redundantOutdoorFurnitureQuery(text: string, query: string): boolean {
  if (!outdoorFurnitureIntent(text)) return false;
  const queryWords = fold(query).split(/[^a-z]+/).filter(Boolean);
  if (!queryWords.length || !queryWords.includes("furniture") ||
      queryWords.some((word) => !["outdoor", "outdoors", "garden", "patio", "furniture", "for", "the"].includes(word))) return false;
  const cleaned = fold(text).replace(/\b(?:under|below|up\s+to|at\s+most|ponizej|do|maksymalnie|maximum|max)\s*(?:eur\s*)?\d+(?:[.,]\d{1,2})?\s*(?:eur|euros?)?\b/g, " ");
  const allowed = new Set(["show", "me", "please", "find", "looking", "for", "i", "am", "could", "you", "would", "like", "want", "need", "some", "the", "garden", "outdoor", "outdoors", "patio", "furniture", "pokaz", "wyswietl", "szukam", "chce", "poprosze", "meble", "mebli", "mebel", "ogrodowe", "ogrodowych", "ogrodu", "do", "na", "zewnatrz", "czy", "mozesz"]);
  return cleaned.split(/[^a-z]+/).filter(Boolean).every((word) => allowed.has(word));
}

/** Model-inferred functions have closed membership; explicit hard facets need current source evidence. */
export function resolveExplicitFacets(
  text: string,
  before: AgentState,
  change: Transition,
  filters: ExplicitFacet[],
) {
  const issues: string[] = [];
  filters = filters.map(normalizeTypeFacet);
  const proposed = change;
  change = normalizeFunctionalTransition(text, before, change, filters);
  if (change !== proposed) {
    // The only accepted incoming facets here echo the established kind. Keep its
    // existing domain value without adding a department that the shopper never named.
    filters = [];
  }
  const criteria = { ...change.criteria };
  const materialScope = criteria.query ? materialTypeScope(text, criteria.query, filters, criteria.requiredFeatures ?? []) : undefined;
  if (criteria.query !== undefined) criteria.query = canonicalSemanticQuery(criteria.query);
  if (materialScope) {
    const { typeId, material, terms } = materialScope;
    criteria.query = productTypes[typeId].en;
    filters = filters.map(filter => {
      if (!filter.userQuote || fold(text).includes(fold(filter.userQuote))) return filter;
      // Groq may lemmatize source quotes ("kubek" for "kubków"). Replace only an
      // exact closed label for the very same material or directly requested type.
      const isType = filter.facet === "type" && filter.value === typeId &&
        aliases(filter).some(alias => fold(alias) === fold(filter.userQuote!));
      const isMaterial = filter.facet === "material" && catalogMaterial(filter.value)?.key === material &&
        new RegExp(`^(?:${terms.map(escapeTerm).join("|")})\\w*$`).test(fold(filter.userQuote));
      return isType || isMaterial ? { ...filter, userQuote: text } : filter;
    });
    if (!filters.some(filter => filter.facet === "material" && catalogMaterial(filter.value)?.key === material))
      filters = [...filters, { facet: "material", value: material, userQuote: text }];
    if (!filters.some(filter => filter.facet === "type" || filter.facet === "excludeType"))
      filters = [...filters, { facet: "type", value: typeId, userQuote: text }];
    if ((change.operation === "new" || change.operation === "browse") && criteria.useEnvironment &&
        !/\b(?:outdoor\w*|indoor\w*|ogrod\w*|dom\w*|zewnatrz|wewnatrz|garden|patio)\b/.test(fold(text))) delete criteria.useEnvironment;
  }
  // A literal product-type query is useful without a guessed use case (a mug
  // does not require coffee). Keep the user's query, and omit redundant guesses.
  const queryTypes = criteria.query
    ? Object.entries(productTypes).filter(([, type]) => fold(type.en) === fold(criteria.query!) &&
      positiveClauses(text).some(clause => positivelyMentions(clause, [type.en, type.pl, ...type.aliases], true)))
    : [];
  if (queryTypes.length === 1) {
    const [typeId, namedType] = queryTypes[0];
    const group = criteria.functionalGroup;
    if (group && group !== before.criteria.functionalGroup && !mentions(text, functionalGroups[group].aliases))
      delete criteria.functionalGroup;
    filters = filters.filter(filter => filter.facet !== "kind" || filter.value !== namedType.kind ||
      mentions(text, aliases(filter)) || (filter.userQuote && !fold(text).includes(fold(filter.userQuote))));
    const typeNames = [namedType.en, namedType.pl, ...namedType.aliases];
    if (!filters.some(filter => filter.facet === "type" || filter.facet === "excludeType") &&
        directlyRequestsProductType(text, typeNames)) {
      filters = [...filters, { facet: "type", value: typeId }];
    }

  }
  const explicit = explicitConstraints(text);
  issues.push(...explicit.issues);
  const retained = new Set([...(change.remove ?? [])]);
  // Unasked spending limits must not silently hide products. The transition still carries a saved limit.
  const budgetLanguage = mentionsBudget(text) || /\b(?:bud[zż]et\w*|budget|euros?|eur|zlot\w*|dollars?|pounds?)\b|[€£$]/.test(fold(text));
  if (!budgetLanguage && explicit.maxPrice === undefined) {
    delete criteria.maxPrice;
    delete criteria.targetPrice;
  }
  if (explicit.maxPrice !== undefined) {
    criteria.maxPrice = explicit.maxPrice;
    delete criteria.targetPrice;
    retained.delete("maxPrice");
    retained.delete("targetPrice");
  }
  // A price or use-case request does not implicitly restrict the assortment to available items.
  const stockContext = positiveClauses(text).some((clause) =>
    /\b(?:in[ -]stock|availab\w*|dostepn\w*|od reki|na stanie)\b/.test(clause));
  if (criteria.inStockOnly && !stockContext &&
      ((change.operation === "new" || change.operation === "browse") || !before.criteria.inStockOnly))
    delete criteria.inStockOnly;
  if (explicit.inStockOnly) {
    criteria.inStockOnly = true;
    retained.delete("inStockOnly");
  }
  if (explicit.requestedCount !== undefined && criteria.query) {
    // The catalog's legacy budget parser also understands "up to N". Do not
    // pass it a result-count bound in the semantic query as if it were EUR.
    criteria.query = criteria.query.replace(
      /\b(?:under|below|up to|less than)\s+(?:4|5|10|20)\s+(?=(?:(?!(?:eur|usd|gbp|pln)\b)[a-z]+\s+){0,2}(?:products?|items?|options?|proposals?|recommendations?)\b)/gi,
      "",
    );
  }
  change = {
    ...change,
    ...(explicit.requestedCount === undefined
      ? {}
      : { requestedCount: explicit.requestedCount }),
    ...(change.remove ? { remove: [...retained] } : {}),
  };
  const fresh = change.operation === "new" || change.operation === "browse";
  const departmentNamed = /\bcategory\b|\bdepartment\b|kategori/.test(fold(text));
  // Do not turn an unresolved negation, accessory or compound scope into an
  // unfiltered catalog browse when the model supplied no meaningful scope.
  const mentionsOutdoorAndFurniture = /\b(?:garden|outdoor|outdoors|patio|ogrod\w*)\b/.test(fold(text)) &&
    mentions(text, productKinds.furniture.aliases);
  if (fresh && !departmentNamed && mentionsOutdoorAndFurniture && !outdoorFurnitureIntent(text) &&
      !filters.length && !criteria.query && !criteria.productKind && !criteria.productType &&
      !criteria.productTypes?.length && !criteria.functionalGroup)
    issues.push("The outdoor furniture scope is ambiguous; correct or clarify the search.");
  // Provider labels such as "Garden" can describe use rather than a shop
  // department. Keep the department only when the shopper explicitly chose it.
  if (fresh && outdoorFurnitureIntent(text)) {
    const categories = filters.filter((filter) => filter.facet === "category");
    const categoriesGrounded = categories.every((filter) => {
      const label = fold(filter.value);
      return (!filter.userQuote || fold(text).includes(fold(filter.userQuote))) &&
        (label === "garden" || label === "furniture" || outdoorFurnitureIntent(filter.value));
    });
    if (categoriesGrounded && filters.every((filter) => filter.facet === "category")) {
      if (criteria.useEnvironment && criteria.useEnvironment !== "outdoor") {
        issues.push("Outdoor furniture conflicts with the proposed use environment; correct the criteria.");
      } else {
        criteria.productKind = "furniture";
        criteria.useEnvironment = "outdoor";
        if (!criteria.query || redundantOutdoorFurnitureQuery(text, criteria.query)) criteria.query = "";
        if (!departmentNamed) filters = filters.filter((filter) => filter.facet !== "category");
      }
    }
  }
  const kindLabels = filters
    .filter((filter) => filter.facet === "category" && Object.hasOwn(productKinds, fold(filter.value)))
    .map((filter) => filter.value);
  const kindEvidence = [criteria.query, ...kindLabels].filter(Boolean).join(" ");
  const recovered: ReturnType<typeof recoverKind> = kindEvidence ? recoverKind(text, kindEvidence) : {};
  // A translated kind may have the same name as a shop department. Only the
  // shopper can select that department; a grounded ordinary kind spans departments.
  if (!departmentNamed && recovered.kind) {
    const kind = recovered.kind;
    filters = filters.map((filter) => filter.facet === "category" && fold(filter.value) === fold(kind)
      ? { ...filter, facet: "kind", value: kind } : filter);
  }
  // A refinement already inherits its recorded kind. Do not introduce a
  // merchandising department when the model repeats that kind in the wrong field.
  const carriedKind = before.criteria.productKind;
  if (change.operation === "refine" && carriedKind && !departmentNamed &&
      !mentions(text, aliases({ facet: "kind", value: carriedKind })) &&
      !change.remove?.includes("productKind") && !recovered.kind && !recovered.ambiguous) {
    filters = filters.filter((filter) => !(filter.facet === "category" &&
      fold(filter.value) === fold(carriedKind)));
  }
  const statedPurpose = (value: string, quote: string) =>
    functionalGroupNames.find((group) => group === value && fold(text).includes(fold(quote)) &&
      positiveClauses(quote).some((clause) => positivelyMentions(clause, functionalGroups[group].aliases, false, "purpose")));
  const featureGroups = functionalGroupNames.filter((group) =>
    criteria.requiredFeatures?.includes(group) && statedPurpose(group, text));
  if (featureGroups.length === 1 && !criteria.functionalGroup) criteria.functionalGroup = featureGroups[0];
  const oldTypes = new Set(
    before.criteria.productTypes ??
      (before.criteria.productType ? [before.criteria.productType] : []),
  );
  const proposedTypes = new Set(
    filters
      .filter((filter) => filter.facet === "type")
      .map((filter) => filter.value),
  );
  const sameTypes =
    oldTypes.size === proposedTypes.size &&
    [...oldTypes].every((type) => proposedTypes.has(type));
  const includes: string[] = [],
    excludes: string[] = [];
  const materialFilters = [
    ...filters.filter(filter => filter.facet === "material"),
    ...(criteria.requiredFeatures ?? []).filter(feature => catalogMaterial(feature)).map(value => ({ value, userQuote: undefined })),
  ];
  if (materialFilters.length) {
    const priorFeatures = !fresh && !change.remove?.includes("requiredFeatures") ? before.criteria.requiredFeatures ?? [] : [];
    const required = new Set([
      ...priorFeatures.filter(feature => change.operation !== "change" || !catalogMaterial(feature)),
      ...(criteria.requiredFeatures ?? []).filter(feature => !catalogMaterial(feature)),
    ]);
    for (const { value, userQuote } of materialFilters) {
      const material = catalogMaterial(value);
      const carried = !fresh && priorFeatures.includes(material?.key ?? value) && !userQuote && !mentions(text, material?.terms ?? [value]);
      if (!material || (!carried && !hardMaterialMention(text, material.terms, userQuote))) {
        issues.push("Use a catalog material only when CURRENT requires it. Keep a preference soft and leave an accessory's material with its own product.");
      } else required.add(material.key);
    }
    if (required.size > 8) issues.push("Too many required features. Clarify which ones are essential.");
    else criteria.requiredFeatures = [...required];
  }
  for (const filter of filters) {
    if (filter.facet === "material") continue;
    if (filter.facet === "type") {
      const group = statedPurpose(filter.value, filter.userQuote ?? text);
      if (group && (!criteria.functionalGroup || criteria.functionalGroup === group)) {
        criteria.functionalGroup = group;
        continue;
      }
    }
    const vocabulary =
      filter.facet === "kind"
        ? allowedCriteria.productKind
        : filter.facet === "category"
          ? allowedCriteria.category
          : allowedCriteria.productType;
    if (!vocabulary.includes(filter.value)) {
      issues.push(`Invalid ${filter.facet}: ${filter.value}`);
      continue;
    }
    const carried =
      !fresh &&
      (filter.facet === "kind"
        ? before.criteria.productKind === filter.value
        : filter.facet === "category"
          ? before.criteria.category === filter.value
          : filter.facet === "excludeType"
            ? before.criteria.excludeTypes?.includes(filter.value)
            : sameTypes && oldTypes.has(filter.value));
    const quote = filter.userQuote ?? text;
    const realQuote = fold(text).includes(fold(quote));
    const named =
      realQuote &&
      mentions(
        quote,
        aliases(filter),
        filter.facet === "kind" && filter.value === "decor",
      );
    const negative = /\b(?:not|no|without|exclude|except|nie|bez)|zadn/.test(
      fold(quote),
    );
    const categoryChoice =
      filter.facet !== "category" ||
      departmentNamed;
    if (
      !carried &&
      (!named ||
        !categoryChoice ||
        (filter.facet === "excludeType" && !negative))
    ) {
      issues.push(
        `Ungrounded ${filter.facet} ${filter.value}. Only quote an explicit CURRENT requirement; otherwise use a functionalGroup or an English semantic query. Garden alone is outdoor use, not a merchandising category or a gardening kind.`,
      );
      continue;
    }
    if (filter.facet === "kind") criteria.productKind = filter.value;
    else if (filter.facet === "category") {
      criteria.category = filter.value;
      criteria.categoryExplicit = true;
    } else if (filter.facet === "excludeType") excludes.push(filter.value);
    else includes.push(filter.value);
  }
  if (
    !criteria.productKind &&
    (fresh ||
      (!before.criteria.productKind &&
        !before.criteria.productType &&
        !before.criteria.productTypes?.length)) &&
    !filters.some((filter) => filter.facet === "kind") &&
    criteria.query
  ) {
    if (recovered.ambiguous)
      issues.push(
        "Multiple product kinds or conflicting product types were named; clarify the intended scope.",
      );
    else if (recovered.kind && !includes.length)
      criteria.productKind = recovered.kind;
  }
  if (includes.length) {
    criteria.productTypes = [...new Set(includes)];
    delete criteria.productType;
    change.remove = [
      ...new Set([...(change.remove ?? []), "productType" as const]),
    ];
    const kinds = [
      ...new Set(
        includes.flatMap((type) =>
          productTypes[type] ? [productTypes[type].kind] : [],
        ),
      ),
    ];
    if (
      kinds.length === 1 &&
      !filters.some((filter) => filter.facet === "kind")
    )
      criteria.productKind = kinds[0];
    if (change.criteria.query === undefined) criteria.query = "";
  }
  if (excludes.length)
    criteria.excludeTypes = [
      ...new Set([
        ...(fresh ? [] : (before.criteria.excludeTypes ?? [])),
        ...excludes,
      ]),
    ];
  if (criteria.requiredFeatures?.length) {
    const effective = { ...(fresh ? {} : before.criteria), ...criteria };
    for (const key of change.remove ?? []) delete effective[key];
    const structural = [
      ...(effective.productKind
        ? aliases({ facet: "kind", value: effective.productKind })
        : []),
      ...(effective.category
        ? aliases({ facet: "category", value: effective.category })
        : []),
      ...[
        ...(effective.productTypes ?? []),
        ...(effective.productType ? [effective.productType] : []),
      ].flatMap((value) => aliases({ facet: "type", value })),
      ...(effective.functionalGroup ? [effective.functionalGroup] : []),
      ...(effective.useEnvironment === "outdoor" ||
      effective.useEnvironment === "both"
        ? [
            "garden",
            "outdoor",
            "outdoors",
            "ogrod",
            "ogrodowy",
            "ogrodowe",
            "do ogrodu",
            "na zewnatrz",
          ]
        : []),
      ...(effective.useEnvironment === "indoor" ||
      effective.useEnvironment === "both"
        ? ["indoor", "indoors"]
        : []),
      ...(effective.inStockOnly
        ? ["in stock", "available", "dostepny", "dostepne"]
        : []),
    ].map((value) => fold(value).trim());
    criteria.requiredFeatures = criteria.requiredFeatures.filter(
      (feature) => !structural.includes(fold(feature).trim()),
    );
  }
  if (
    criteria.productKind &&
    criteria.productKind !== before.criteria.productKind &&
    !includes.length
  ) {
    change = {
      ...change,
      remove: [
        ...new Set([
          ...(change.remove ?? []),
          "productType" as const,
          "productTypes" as const,
        ]),
      ],
    };
    if (change.criteria.query === undefined) criteria.query = "";
  }
  const group = criteria.functionalGroup;
  if (
    criteria.productKind &&
    criteria.productKind !== before.criteria.productKind &&
    !group &&
    before.criteria.functionalGroup &&
    !groupScopeTypes(
      before.criteria.functionalGroup,
      { ...before.criteria, ...criteria },
      products,
    ).length
  ) {
    change.remove = [
      ...new Set([...(change.remove ?? []), "functionalGroup" as const]),
    ];
  }
  if (group) {
    const carried = !fresh && before.criteria.functionalGroup === group;
    const implied =
      includes.length > 0 &&
      includes.every((type) => functionalGroups[group].types.includes(type));
    if (
      !carried &&
      !implied &&
      !mentions(text, functionalGroups[group].aliases)
    )
      issues.push(
        `Ungrounded functionalGroup ${group}. Generic furniture does not imply seating; omit the group unless CURRENT names that function.`,
      );
    const effective = { ...(fresh ? {} : before.criteria), ...criteria };
    if (includes.some((type) => !functionalGroups[group].types.includes(type)))
      issues.push(
        `Functional group ${group} cannot discard explicitly named types. Remove the inferred group or clarify the request.`,
      );
    if (!groupScopeTypes(group, effective, products).length)
      issues.push(
        `Functional group ${group} conflicts with the active scope. For a new topic use operation new to reset unrelated conditions; otherwise clarify the conflicting hard requirements. Do not claim catalog absence.`,
      );
  }
  return issues.length
    ? {
        error: "Invalid hard constraints",
        code: "UNGROUNDED_FACET",
        issues,
        allowedValues: {
          ...allowedCriteria,
          functionalGroup: Object.keys(functionalGroups),
        },
      }
    : { change: { ...change, criteria } };
}

/** Identify a positive functional request against an existing compatible scope.
 * Only a closed vocabulary is eligible for automatic interpretation; anything
 * else must still be interpreted by the model and checked through catalog search. */
export function functionalRefinement(text: string, before: AgentState) {
  if (!before.resultIds.length && !before.lastIds.length && !Object.keys(before.criteria).length) return;
  if (/["“”„'?!;]/.test(text)) return;
  const clauses = positiveClauses(text).map((clause) => clause.trim()).filter(Boolean);
  if (clauses.length !== 1) return;
  const clause = clauses[0].trim();
  if (!/\b(?:szukam|potrzebuje|chce|poprosze|pokaz|wyswietl|looking|need|want|find|show|search)\b/.test(clause)) return;
  if (/\b(?:nie\s+(?:chce|potrzebuje|szukam)|(?:do|does)\s+not\s+(?:want|need)|dont\s+(?:want|need))\b/.test(clause)) return;
  if (/\b(?:compare|comparison|versus|porown\w*|detail\w*|information|informac\w*|szczegol\w*|wiecej\s+o|tell\s+me\s+more|add|cart|koszyk\w*|dodaj)\b/.test(clause)) return;
  const groups = functionalGroupNames.filter((group) =>
    positivelyMentions(clause, functionalGroups[group].aliases, false, "purpose") &&
    groupScopeTypes(group, before.criteria, products).length > 0,
  );
  if (groups.length !== 1) return;
  const group = groups[0];
  const narrowedTypes = before.criteria.productTypes ??
    (before.criteria.productType ? [before.criteria.productType] : []);
  if (narrowedTypes.some((type) => !functionalGroups[group].types.includes(type))) return;
  let remainder = clause;
  for (const alias of functionalGroups[group].aliases) {
    const term = fold(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    remainder = remainder.replace(new RegExp(`\\b${term}\\w*`, "g"), " ");
  }
  const neutral = new Set([
    "i", "im", "am", "a", "an", "some", "something", "somewhere", "anything",
    "to", "on", "for", "me", "please", "looking", "need", "want", "find", "show", "search",
    "szukam", "potrzebuje", "chce", "poprosze", "pokaz", "wyswietl", "mi", "cos", "czegos",
    "czegokolwiek", "do", "na", "czym", "moge", "sie", "jakiegos", "jakies", "miejsca", "zeby",
  ]);
  const simple = remainder.split(/[^a-z0-9]+/).filter(Boolean).every((word) => neutral.has(word));
  return { group, simple };
}
