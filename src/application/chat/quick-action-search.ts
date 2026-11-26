import { products } from "@/data/products";
import { expandFunctionalGroup } from "@/domain/catalog/functional-groups";
import type { AgentState, ShoppingAction, Transition } from "@/application/chat/shopping-v3";

type QuickSearchAction = Extract<ShoppingAction, { type: "search" | "category" | "more" | "availability" }>;

export function hasActiveQuickSearch(before: AgentState): boolean {
  const visible = before.lastIds.length > 1 ? before.lastIds :
    before.resultIds.length ? before.resultIds : before.lastIds;
  return !!(before.scope || Object.keys(before.criteria).length) &&
    visible.length > 0 && visible.every((id) => before.shownIds.includes(id));
}

export function resolveQuickSearch(action: QuickSearchAction, before: AgentState, language: AgentState["language"]): Transition {
  let criteria: Transition["criteria"] = {},
    operation: Transition["operation"] = "new";
  let remove: Transition["remove"];
  let scope = "collection";
  if (action.type === "search") {
    if (action.preset === "coffee") {
      criteria = { functionalGroup: "coffee" };
      scope = "coffee";
    }
    if (action.preset === "seating") {
      const prior = before.criteria;
      const seatingTypes = expandFunctionalGroup("seating");
      const categoryHasSeats = !prior.category || products.some((product) =>
        product.category === prior.category && seatingTypes.includes(product.productType),
      );
      const priorTypes = prior.productTypes ?? (prior.productType ? [prior.productType] : []);
      const unrelatedTypes = priorTypes.length > 0 && !priorTypes.some((type) =>
        products.some((product) => product.productType === type && product.productKind === "furniture"),
      );
      const unrelated = (prior.productKind && prior.productKind !== "furniture") ||
        (prior.functionalGroup && prior.functionalGroup !== "seating") || !categoryHasSeats || unrelatedTypes ||
        (!!prior.query && prior.productKind !== "furniture");
      criteria = { functionalGroup: "seating" };
      scope = "seating";
      operation = unrelated ? "new" : "refine";
      if (!unrelated) {
        remove = ["query"];
        if (prior.productType && !seatingTypes.includes(prior.productType)) remove.push("productType");
        if (prior.productTypes?.some((type) => !seatingTypes.includes(type))) remove.push("productTypes");
      }
    }
    if (action.preset === "garden" || action.preset === "outdoor") {
      const prior = before.criteria;
      const priorTypes = prior.productTypes ?? (prior.productType ? [prior.productType] : []);
      const priorFurniture = prior.productKind === "furniture" || (!prior.productKind && priorTypes.length > 0 && priorTypes.every((type) =>
        products.some((product) => product.productType === type && product.productKind === "furniture"),
      ));
      const relatedOutdoor = priorFurniture || prior.productKind === "gardening" ||
        prior.productType === "planter" || !!prior.productTypes?.includes("planter") ||
        prior.useEnvironment === "outdoor" || /\b(?:garden|outdoor)\b/i.test(before.scope);
      const hasSubject = !!(prior.productKind || prior.productType || prior.productTypes?.length ||
        prior.functionalGroup || prior.category || prior.query || prior.useEnvironment);
      const unrelated = hasSubject && !relatedOutdoor;
      criteria = {
        productKind: "furniture",
        useEnvironment: "outdoor",
        ...(action.preset === "garden" ? { maxPrice: 150 } : {
          excludeTypes: [...new Set([...(priorFurniture ? prior.excludeTypes ?? [] : []), "planter"])],
        }),
      };
      scope = "outdoor furniture";
      operation = action.preset === "outdoor" && !unrelated ? "change" : "new";
      if (action.preset === "outdoor" && !unrelated) {
        remove = ["query", "functionalGroup", "category", "categoryExplicit", "productType", "productTypes"];
        if (!priorFurniture) remove.push("requiredFeatures");
      }
    }
    if (action.preset === "budget" || action.preset === "gift")
      criteria = {
        maxPrice: 25,
        ...(action.preset === "gift" ? { query: "gift" } : {}),
      };
    if (action.preset === "gift-home-fragrance") {
      criteria = { productTypes: ["candle", "diffuser"], maxPrice: 24.99 };
      scope = "candles and diffusers";
    }
  } else if (action.type === "category") {
    criteria = { category: action.name, categoryExplicit: true };
    scope = action.name;
  } else {
    operation = action.type === "more" ? "more" : "refine";
    scope = before.scope;
    criteria = action.type === "availability" ? { inStockOnly: true } : {};
  }
  return {
    operation, language, scope, criteria,
    ...(remove?.length ? { remove } : {}),
    requestedCount: action.type === "search" ? action.requestedCount : undefined,
  };
}
