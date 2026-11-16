import { products } from "@/data/products";
import { productKinds, productTypes } from "@/domain/catalog/taxonomy";
import {
  functionalGroups,
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
/** Model-inferred functions have closed membership; explicit hard facets need current source evidence. */
export function resolveExplicitFacets(
  text: string,
  before: AgentState,
  change: Transition,
  filters: ExplicitFacet[],
) {
  const issues: string[] = [];
  const criteria = { ...change.criteria };
  const fresh = change.operation === "new" || change.operation === "browse";
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
      /\bcategory\b|\bdepartment\b|kategori/.test(fold(text));
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
