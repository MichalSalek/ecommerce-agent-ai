import { products } from "@/data/products";
import { productKinds, productTypes } from "@/domain/catalog/taxonomy";
import {
  functionalGroups,
  functionalGroupNames,
  groupScopeTypes,
} from "@/domain/catalog/functional-groups";
import { allowedCriteria } from "@/domain/catalog/requirements";
import { categoryLabels } from "@/domain/catalog/category-labels";
import type { AgentState, Transition } from "./shopping-v3";
export type ExplicitFacet = {
  facet: "kind" | "type" | "excludeType" | "category";
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
/** Model-inferred functions have closed membership; explicit hard facets need current source evidence. */
export function resolveExplicitFacets(
  text: string,
  before: AgentState,
  change: Transition,
  filters: ExplicitFacet[],
) {
  const issues: string[] = [];
  const criteria = { ...change.criteria };
  const explicit = explicitConstraints(text);
  issues.push(...explicit.issues);
  const retained = new Set([...(change.remove ?? [])]);
  if (explicit.maxPrice !== undefined) {
    criteria.maxPrice = explicit.maxPrice;
    delete criteria.targetPrice;
    retained.delete("maxPrice");
    retained.delete("targetPrice");
  }
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
  const recovered: ReturnType<typeof recoverKind> = criteria.query ? recoverKind(text, criteria.query) : {};
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
  for (const filter of filters) {
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
