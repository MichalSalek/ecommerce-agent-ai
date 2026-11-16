import type { Product, ProductSearch } from "./product";
export const functionalGroupNames = ["seating", "coffee", "music"] as const;
export type FunctionalGroup = (typeof functionalGroupNames)[number];
export const functionalGroups: Record<
  FunctionalGroup,
  { types: readonly string[]; aliases: readonly string[] }
> = {
  seating: {
    types: ["chair", "bench", "lounger", "sofa", "stool"],
    aliases: [
      "sit",
      "sitting",
      "seating",
      "seat",
      "siedzen",
      "siedzi",
      "usią",
      "usiad",
    ],
  },
  coffee: {
    types: [
      "mug",
      "carafe",
      "coffee-dripper",
      "coffee-grinder",
      "kettle",
      "scale",
    ],
    aliases: [
      "coffee",
      "brew",
      "brewing",
      "kawa",
      "kawy",
      "kawę",
      "kawie",
      "kawą",
      "parzeni",
    ],
  },
  music: {
    types: ["headphones", "speaker"],
    aliases: [
      "music",
      "audio",
      "listen",
      "listening",
      "muzyk",
      "słucha",
      "slucha",
      "dźwię",
      "dzwie",
    ],
  },
};
export function expandFunctionalGroup(group: FunctionalGroup): string[] {
  return [...functionalGroups[group].types];
}
export function groupScopeTypes(
  group: FunctionalGroup,
  scope: Partial<ProductSearch>,
  catalog: readonly Product[],
): string[] {
  const types = expandFunctionalGroup(group);
  return types.filter((type) =>
    catalog.some(
      (product) =>
        product.productType === type &&
        (!scope.productKind || scope.productKind === product.productKind) &&
        (!scope.category || scope.category === product.category) &&
        (!scope.useEnvironment ||
          scope.useEnvironment === product.useEnvironment ||
          product.useEnvironment === "both"),
    ),
  );
}
