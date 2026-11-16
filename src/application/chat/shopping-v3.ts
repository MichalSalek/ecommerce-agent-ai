import { z } from "zod";
import { products } from "@/data/products";
import { searchInput } from "./tool-inputs";

export const criteriaSchema = searchInput
  .omit({ newSearch: true, excludeIds: true, limit: true })
  .partial();
const ids = z.array(z.string().min(1).max(100)).max(100);
export const agentStateSchema = z.object({
  language: z.enum(["en", "pl"]),
  languageChosen: z.boolean().default(false),
  scope: z.string().max(200),
  criteria: criteriaSchema,
  preferences: z.array(z.string().max(150)).max(8),
  persistentPreferences: z.array(z.string().max(150)).max(8),
  requestedCount: z.number().int().min(1).max(1000),
  shownIds: ids,
  rejectedIds: ids,
  lastIds: ids,
  resultIds: ids.max(10).default([]),
  comparisonIds: ids.max(10),
  selectedIds: ids.max(10),
});
export type AgentState = z.infer<typeof agentStateSchema>;
export const initialAgentState = (): AgentState => ({
  language: "en",
  languageChosen: false,
  scope: "",
  criteria: {},
  preferences: [],
  persistentPreferences: [],
  requestedCount: 5,
  shownIds: [],
  rejectedIds: [],
  lastIds: [],
  resultIds: [],
  comparisonIds: [],
  selectedIds: [],
});
export const transitionSchema = z.object({
  operation: z.enum(["new", "refine", "change", "more", "browse"]),
  language: z.enum(["en", "pl"]),
  scope: z.string().max(200).optional(),
  criteria: criteriaSchema,
  remove: z
    .array(
      z.enum([
        "query",
        "functionalGroup",
        "category",
        "categoryExplicit",
        "productKind",
        "productType",
        "productTypes",
        "useEnvironment",
        "maxPrice",
        "targetPrice",
        "excludeTypes",
        "requiredFeatures",
        "inStockOnly",
      ]),
    )
    .max(14)
    .optional(),
  requestedCount: z.number().int().min(1).max(1000).optional(),
  preferences: z.array(z.string().max(150)).max(8).optional(),
  persistentPreferences: z.array(z.string().max(150)).max(8).optional(),
  rejectedIds: ids.optional(),
});
export type Transition = z.infer<typeof transitionSchema>;
export const resultOutcomeSchema = z.enum([
  "matches",
  "no-match",
  "exhausted",
  "unavailable",
  "unconfirmed-feature",
  "no-assortment",
  "invalid-criteria",
]);
export const searchEvidenceSchema = z
  .object({
    evidenceId: z.string().min(1).max(150),
    products: z.array(z.object({ id: z.string().min(1).max(100) })).max(10),
    appliedCriteria: criteriaSchema,
    outcome: resultOutcomeSchema,
    requestedCount: z.number().int().positive().max(1000),
    scopeTotal: z.number().int().nonnegative().max(products.length),
    totalMatches: z.number().int().nonnegative().max(products.length),
    unseenMatches: z.number().int().nonnegative().max(products.length),
    remainingMatches: z.number().int().nonnegative().max(products.length),
    newlyShownCount: z.number().int().min(0).max(10).optional(),
  })
  .superRefine((result, context) => {
    if (
      result.totalMatches > result.scopeTotal ||
      result.products.length > result.totalMatches ||
      result.products.length > Math.min(10, result.requestedCount) ||
      new Set(result.products.map((product) => product.id)).size !==
        result.products.length ||
      result.unseenMatches > result.totalMatches ||
      result.remainingMatches > result.unseenMatches ||
      (result.newlyShownCount !== undefined &&
        (result.newlyShownCount > result.products.length ||
          result.remainingMatches !==
            result.unseenMatches - result.newlyShownCount))
    )
      context.addIssue({
        code: "custom",
        message: "Inconsistent catalog counters.",
      });
  });
export type SearchEvidence = z.infer<typeof searchEvidenceSchema>;
export const categoryCardsSchema = z
  .array(
    z.object({
      name: z.string(),
      count: z.number().int().nonnegative(),
      exampleId: z.string(),
    }),
  )
  .max(10);
export type CategoryCard = z.infer<typeof categoryCardsSchema>[number];
export function categoryCards(): CategoryCard[] {
  return [...new Set(products.map((p) => p.category))].sort().map((name) => {
    const rows = products
      .filter((p) => p.category === name)
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      name,
      count: rows.length,
      exampleId: (rows.find((p) => p.inStock) ?? rows[0]).id,
    };
  });
}
export const comparisonSchema = z.object({
  productIds: ids.min(2).max(10),
  cheapestIds: ids.max(10),
  differencesCents: z
    .array(
      z.object({
        productId: z.string(),
        cents: z.number().int().nonnegative(),
      }),
    )
    .max(10),
});
export type Comparison = z.infer<typeof comparisonSchema>;
export function comparison(productIds: string[]): Comparison {
  const rows = products.filter((p) => productIds.includes(p.id));
  const minimum = Math.min(...rows.map((p) => Math.round(p.price * 100)));
  return {
    productIds,
    cheapestIds: rows
      .filter((p) => Math.round(p.price * 100) === minimum)
      .map((p) => p.id),
    differencesCents: rows.map((p) => ({
      productId: p.id,
      cents: Math.round(p.price * 100) - minimum,
    })),
  };
}
export const checkpointSchema = z.object({
  userMessageId: z.string().max(150),
  text: z.string().max(12000),
  before: agentStateSchema,
  after: agentStateSchema,
  transition: transitionSchema.optional(),
  presentedIds: ids.max(10),
});
export type TurnCheckpoint = z.infer<typeof checkpointSchema>;
export const turnStatusSchema = z.object({
  status: z.enum(["complete", "partial", "provider-limit", "connection-error"]),
  retryAfter: z.number().nonnegative().optional(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cachedInputTokens: z.number(),
      calls: z.number(),
    })
    .optional(),
});
export type TurnStatus = z.infer<typeof turnStatusSchema>;

/** State sent by the browser is a preference hint. Product facts always come from the catalog. */
export function sanitizeState(value: unknown): AgentState {
  const parsed = agentStateSchema.safeParse(value);
  if (!parsed.success) return initialAgentState();
  const state = parsed.data;
  for (const field of [
    "shownIds",
    "rejectedIds",
    "lastIds",
    "resultIds",
    "comparisonIds",
    "selectedIds",
  ] as const)
    state[field] = [...new Set(state[field])].filter((id) =>
      products.some((p) => p.id === id),
    );
  state.lastIds = state.lastIds.slice(0, 10);
  return state;
}
export function transitionState(
  before: AgentState,
  change: Transition,
): AgentState {
  const fresh = change.operation === "new" || change.operation === "browse";
  const after = fresh
    ? {
        ...initialAgentState(),
        persistentPreferences: before.persistentPreferences,
        languageChosen: before.languageChosen,
      }
    : structuredClone(before);
  after.language = change.language;
  after.scope = change.scope ?? (fresh ? "" : before.scope);
  after.criteria = { ...after.criteria, ...change.criteria };
  for (const key of change.remove ?? []) delete after.criteria[key];
  // Type changes cannot retain the previous kind by accident.
  if (change.criteria.productType && !change.criteria.productKind)
    delete after.criteria.productKind;
  if (change.criteria.maxPrice !== undefined) delete after.criteria.targetPrice;
  if (change.criteria.targetPrice !== undefined) delete after.criteria.maxPrice;
  after.requestedCount =
    change.requestedCount ?? (fresh ? 5 : before.requestedCount);
  after.preferences = change.preferences ?? after.preferences;
  after.persistentPreferences =
    change.persistentPreferences ?? after.persistentPreferences;
  after.rejectedIds = [
    ...new Set([...after.rejectedIds, ...(change.rejectedIds ?? [])]),
  ];
  return sanitizeState(after);
}
