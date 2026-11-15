import type { ModelMessage } from "ai";
import { products } from "@/data/products";
import type { ProductSearch } from "@/domain/catalog/product";
import { searchInput } from "./tool-inputs";
import { userText, requestedBudget } from "./conversation";
import { categoryLabels } from "@/domain/catalog/category-labels";
import { productTypes, productKinds } from "@/domain/catalog/taxonomy";

export function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l");
}
export function resultProducts(value: unknown) {
  const rows = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        "products" in value &&
        Array.isArray(value.products)
      ? value.products
      : value && typeof value === "object" && "id" in value
        ? [value]
        : [];
  return rows.flatMap((row) =>
    row && typeof row === "object" && "id" in row
      ? products.filter((p) => p.id === row.id)
      : [],
  );
}
export interface ShoppingState {
  criteria: ProductSearch;
  shownIds: string[];
  rejectedIds: string[];
  rejectedTypes: string[];
  lastIds: string[];
}
export function shoppingState(messages: ModelMessage[]): ShoppingState {
  let state: ShoppingState = {
    criteria: { query: "" },
    shownIds: [],
    rejectedIds: [],
    rejectedTypes: [],
    lastIds: [],
  };
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    if (message.role === "user" && messageIndex !== messages.length - 1) {
      const need = interpretNeed(userText(message), state);
      if (need.recognized && !need.complex) {
        const criteria = mergeNeed(
          state,
          need.patch,
          need.newSearch,
          need.more,
        );
        if (need.newSearch)
          state = {
            criteria,
            shownIds: [],
            rejectedIds: [],
            rejectedTypes: [],
            lastIds: [],
          };
        else state.criteria = criteria;
      }
    }
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "tool-call" && part.toolName === "searchProducts") {
        const parsed = searchInput.safeParse(part.input);
        if (!parsed.success) continue;
        if (parsed.data.newSearch)
          state = {
            criteria: { query: "" },
            shownIds: [],
            rejectedIds: [],
            rejectedTypes: [],
            lastIds: [],
          };
        state.criteria = { ...state.criteria, ...parsed.data };
        state.rejectedTypes = parsed.data.excludeTypes ?? state.rejectedTypes;
      }
      if (
        part.type === "tool-result" &&
        part.output.type === "json" &&
        ["searchProducts", "compareProducts", "getProductDetails"].includes(
          part.toolName,
        )
      ) {
        const ids = resultProducts(part.output.value).map((p) => p.id);
        state.lastIds = ids;
        if (part.toolName === "searchProducts")
          state.shownIds = [...new Set([...state.shownIds, ...ids])];
      }
    }
  }
  return state;
}
function matchesAlias(
  text: string,
  value: { en: string; pl: string; aliases: readonly string[] },
) {
  return [value.en, value.pl, ...value.aliases].some((alias) => {
    const normalized = normalize(alias);
    return (
      normalized.length >= 3 &&
      new RegExp(
        `\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "i",
      ).test(text)
    );
  });
}
export interface InterpretedNeed {
  patch: Partial<ProductSearch>;
  newSearch: boolean;
  more: boolean;
  recognized: boolean;
  complex: boolean;
  overview: boolean;
}
/** Concepts and clause polarity are independent of sentence templates. Ambiguous language goes to the validated planner. */
export function interpretNeed(
  text: string,
  state: ShoppingState,
): InterpretedNeed {
  const normalized = normalize(text);
  const clauses = normalized.split(/[,;.!?]|\b(?:but|ale)\b/);
  const negativeClauses = clauses.flatMap((clause) => {
    const position = clause.search(
      /\b(?:not|no|without|exclude|except|nie|bez)\b/,
    );
    if (position < 0) return [];
    // "A planter is not furniture" corrects classification; the rejected subject is before the negation.
    return /\b(?:is|to)\s+(?:not|nie)\b/.test(clause)
      ? [clause]
      : [clause.slice(position)];
  });
  const positive = negativeClauses.reduce(
    (s, clause) => s.replace(clause, " "),
    normalized,
  );
  const types = Object.entries(productTypes).filter(([, value]) =>
    matchesAlias(positive, value),
  );
  const kinds = Object.entries(productKinds).filter(([, value]) =>
    matchesAlias(positive, value),
  );
  const excluded = Object.entries(productTypes)
    .filter(([, value]) =>
      negativeClauses.some((clause) => matchesAlias(clause, value)),
    )
    .map(([key]) => key);
  // A correction names the rejected object before "is not a ..." as well as after "not ...".
  const rejected = state.lastIds.filter((id) => {
    const p = products.find((p) => p.id === id)!;
    return (
      excluded.includes(p.productType) ||
      negativeClauses.some(
        (c) => c.includes(normalize(p.name)) || c.includes(p.id),
      )
    );
  });
  const patch: Partial<ProductSearch> = {};
  if (types.length === 1) {
    patch.productType = types[0][0];
    patch.productKind = types[0][1].kind;
  }
  if (kinds.length === 1) patch.productKind = kinds[0][0];
  if (/\b(?:outdoor|outside|garden|patio|balcon)|ogrod|balkon/.test(positive))
    patch.useEnvironment = "outdoor";
  if (/\bindoor\b|\binside\b|wnetrz|salon|living room/.test(positive))
    patch.useEnvironment = "indoor";
  if (/\bgrill|barbecue|\bbbq\b/.test(positive)) patch.productType = "grill";
  if (
    /\bplants?\b|rosliny|roslin\b/.test(positive) &&
    !/plant(?:er|ing)|don|podlew|water/.test(positive)
  )
    patch.productType = "living-plant";
  const categories = [...new Set(products.map((p) => p.category))];
  const explicitCategory = /\bcategory\b|kategori/.test(positive);
  const requestedCategory = positive.match(
    /(?:category|kategori\w*)\s*[:=]?\s+([a-z]+)/,
  )?.[1];
  for (const category of categories) {
    if (
      (explicitCategory &&
        (requestedCategory === category.toLowerCase() ||
          (!!requestedCategory &&
            normalize(categoryLabels[category] ?? "").startsWith(
              requestedCategory,
            )))) ||
      normalize(text).trim() === category.toLowerCase()
    ) {
      patch.category = category;
      patch.categoryExplicit = explicitCategory;
    }
  }
  if (/\bgarden\b|ogrod/.test(positive) && !explicitCategory)
    delete patch.category;
  if (/do domu|for (?:my |the )?home|for (?:my |the )?house/.test(positive)) {
    patch.category = "Home";
    patch.useEnvironment = "indoor";
  }
  if (
    /coffee|kaw/.test(positive) &&
    !/medical|medycz|health advice/.test(positive)
  )
    patch.query = "coffee";
  if (/\b(?:in.stock|only available)\b|tylko dostepn/.test(normalized))
    patch.inStockOnly = true;
  const budget = requestedBudget(text);
  if (budget) {
    patch.maxPrice = budget.mode === "max" ? budget.amount : undefined;
    patch.targetPrice = budget.mode === "around" ? budget.amount : undefined;
  }
  const more =
    /\b(?:more|another|alternatives?|different|else|next)\b|wiecej|inneg|inne\b|kolejn|jeszcze/.test(
      normalized,
    ) && !/details|wiecej o/.test(normalized);
  const prior = state.criteria;
  const kindChanged =
    !!patch.productKind &&
    !!prior.productKind &&
    patch.productKind !== prior.productKind;
  const typeChanged =
    !!patch.productType &&
    !!prior.productType &&
    patch.productType !== prior.productType &&
    patch.productKind !== prior.productKind &&
    !more;
  const queryChanged = !!patch.query && patch.query !== prior.query;
  const incompatibleEnvironment =
    !!patch.productKind &&
    !!prior.useEnvironment &&
    !patch.useEnvironment &&
    patch.productKind !== prior.productKind &&
    !products.some(
      (p) =>
        p.productKind === patch.productKind &&
        (p.useEnvironment === prior.useEnvironment ||
          p.useEnvironment === "both"),
    );
  const newSearch =
    incompatibleEnvironment ||
    /new (?:search|topic)|nowy temat|instead|zamiast|forget|zapomnij/.test(
      normalized,
    ) ||
    kindChanged ||
    typeChanged ||
    queryChanged;
  if (excluded.length)
    patch.excludeTypes = [...new Set([...state.rejectedTypes, ...excluded])];
  if (rejected.length)
    state.rejectedIds = [...new Set([...state.rejectedIds, ...rejected])];
  const overview =
    /what (?:do you|does.*) (?:have|sell|offer)|assortment|asortyment|co macie|co (?:jest|mamy) w|what.*types|jakie.*rodzaje/.test(
      normalized,
    );
  // Unsupported positive qualifiers must never silently be assumed true.
  for (const [pattern, feature] of [
    [/certif|certyf/, "certified"],
    [/waterproof|wodoodporn/, "waterproof"],
    [/weatherproof|mrozoodpor/, "weatherproof"],
    [/dishwasher|zmywar/, "dishwasher"],
    [/fireproof|ognioodpor/, "fireproof"],
  ] as const)
    if (pattern.test(positive))
      patch.requiredFeatures = [...(patch.requiredFeatures ?? []), feature];
  let residual = positive;
  const knownAliases = [
    ...Object.values(productTypes),
    ...Object.values(productKinds),
  ].flatMap((value) => [value.en, value.pl, ...value.aliases]);
  for (const alias of knownAliases.sort((a, b) => b.length - a.length)) {
    const escaped = normalize(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped.length >= 3)
      residual = residual.replace(new RegExp(`\\b${escaped}\\w*`, "g"), " ");
  }
  residual = residual.replace(
    /\b(?:outdoor\w*|outside|indoor\w*|inside|garden\w*|ogrod\w*|balkon\w*|patio|balcon\w*|home|house|domu|salon\w*|living room|coffee|kaw\w*|morning|ritual|rytual\w*|grill\w*|barbecue|bbq|plants?|roslin\w*)\b/g,
    " ",
  );
  residual = residual.replace(
    /\b(?:waterproof|wodoodporn\w*|weatherproof|mrozoodpor\w*|certif\w*|certyf\w*|dishwasher|zmywar\w*|fireproof|ognioodpor\w*)\b/g,
    " ",
  );
  const stop =
    /^(?:a|an|the|i|my|me|we|our|your|you|it|them|this|that|those|these|what|which|can|could|would|please|show|find|need|want|looking|look|for|to|of|on|in|at|with|and|some|something|anything|any|only|under|below|up|less|than|around|about|approximately|roughly|eur|euro|euros|usd|dollars|products?|items?|options?|suggestions?|recommend|more|other|different|alternatives?|else|next|new|topic|search|instead|available|stock|gift|co|cos|czegos|jakies|jakie|jakis|te|ten|to|tym|tych|a|i|ale|do|dla|w|z|na|od|o|po|za|nie|bez|czy|prosze|poprosze|umiesz|odpisac|pisac|polsku|angielsku|pokaz|pokazcie|pokazac|mozesz|szukam|chce|potrzebuje|polec|polecasz|polecacie|macie|mam|mamy|mnie|mi|produkt\w*|propozycj\w*|ofert\w*|inne\w*|wiecej|kolejn\w*|jeszcze|maksymalnie|ponizej|okolo|mniej|wiecej|dolar\w*|prezent|tylko|dostepn\w*|zamiast|tego|teraz|nowy|temat|how|much|buy|stock|only|in|kategor\w*|category|categories|przyklady|przyklad)$/;
  const unresolved = residual
    .split(/[^a-z]+/)
    .filter((word) => word.length > 1 && !stop.test(word));
  const complex = unresolved.length > 0 || types.length > 1 || kinds.length > 1;
  return {
    patch,
    newSearch,
    more,
    recognized: !!Object.keys(patch).length || more || overview,
    complex,
    overview,
  };
}
export function mergeNeed(
  state: ShoppingState,
  patch: Partial<ProductSearch>,
  newSearch: boolean,
  more: boolean,
): ProductSearch & { newSearch: boolean } {
  const base = newSearch ? { query: "" } : state.criteria;
  const merged = { ...base, ...patch, limit: 2, newSearch };
  if (patch.productKind && patch.productKind !== base.productKind) {
    delete merged.productType;
    if (!patch.category && !base.categoryExplicit) delete merged.category;
  }
  if (patch.productType) {
    merged.productType = patch.productType;
    if (!patch.productTypes) delete merged.productTypes;
  }
  if (patch.productTypes) {
    merged.productTypes = patch.productTypes;
    if (!patch.productType) delete merged.productType;
  }
  if (
    patch.productType &&
    patch.productKind &&
    !patch.category &&
    base.category &&
    !newSearch &&
    base.category !== "Home" &&
    !base.categoryExplicit
  )
    delete merged.category;
  if ((patch.productKind || patch.productType) && patch.query === undefined)
    merged.query = "";
  if (
    patch.useEnvironment === "outdoor" &&
    !patch.category &&
    base.category === "Garden" &&
    !base.categoryExplicit
  )
    delete merged.category;
  merged.excludeTypes = newSearch
    ? patch.excludeTypes
    : [
        ...new Set([
          ...(state.rejectedTypes ?? []),
          ...(patch.excludeTypes ?? []),
        ]),
      ];
  merged.excludeIds = !newSearch
    ? [
        ...new Set([
          ...state.shownIds,
          ...state.rejectedIds,
          ...(patch.excludeIds ?? []),
        ]),
      ]
    : newSearch
      ? []
      : state.rejectedIds;
  return merged;
}
