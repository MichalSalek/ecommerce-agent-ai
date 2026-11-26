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
  pendingCartIntent: z.string().min(1).max(100).optional(),
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
    evidenceKind: z.enum(["search", "selection"]).optional(),
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
  readResult: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("policy"), topic: z.string().max(200) }),
      z.object({
        kind: z.literal("overview"),
        total: z.number().int().min(0).max(products.length),
      }),
    ])
    .optional(),
});
export type TurnCheckpoint = z.infer<typeof checkpointSchema>;
export const turnStatusSchema = z.object({
  status: z.enum(["complete", "partial", "provider-limit", "connection-error"]),
  code: z
    .enum([
      "MODEL_RESPONSE_INCOMPLETE",
      "PROVIDER_RATE_LIMIT",
      "TIMEOUT",
      "NETWORK_ERROR",
      "APPLICATION_ERROR",
      "BUSY",
      "REQUEST_LIMIT",
    ])
    .optional(),
  message: z.string().max(500).optional(),
  retryAt: z.number().int().nonnegative().optional(),
  retryAfter: z.number().nonnegative().optional(),
  providerLimit: z
    .object({
      metric: z.enum(["tokens", "requests"]),
      window: z.enum(["minute", "day"]),
      limit: z.number().nonnegative(),
      used: z.number().nonnegative(),
      requested: z.number().nonnegative(),
    })
    .optional(),
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
const operationFields = {
  id: z.string().min(1).max(200),
  kind: z.enum([
    "search",
    "details",
    "comparison",
    "categories",
    "overview",
    "policy",
    "cart",
    "conversation",
  ]),
};
export const operationSchema = z.discriminatedUnion("status", [
  z.object({ ...operationFields, status: z.literal("completed") }).strict(),
  z
    .object({
      ...operationFields,
      status: z.literal("needs-input"),
      question: z.string().min(1).max(1000),
      choices: ids.max(10).optional(),
      input: z.enum(["selection", "quantity", "confirm"]).optional(),
      quantity: z.number().int().min(1).max(99).optional(),
    })
    .strict(),
  z
    .object({
      ...operationFields,
      status: z.literal("awaiting-device"),
      cartOperationId: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      ...operationFields,
      status: z.literal("failed"),
      error: turnStatusSchema,
    })
    .strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export const adviceSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not-requested") }).strict(),
  z
    .object({ status: z.literal("included"), text: z.string().min(1).max(400) })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: z.string().min(1).max(100),
      retryAt: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);
export type Advice = z.infer<typeof adviceSchema>;
/** Legacy status is an adapter of the operation, never of optional advice. */
export function operationTurnStatus(
  operation: Operation,
  usage?: TurnStatus["usage"],
): TurnStatus {
  return {
    ...(operation.status === "failed"
      ? operation.error
      : { status: "complete" as const }),
    ...(usage ? { usage } : {}),
  };
}
export const chatProgressSchema = z.object({
  phase: z.enum([
    "understanding",
    "catalog",
    "details",
    "comparison",
    "cart",
    "answer",
    "provider-wait",
    "provider-switch",
  ]),
  startedAt: z.number().int().nonnegative(),
  retryAt: z.number().int().nonnegative().optional(),
});
export type ChatProgress = z.infer<typeof chatProgressSchema>;
const catalogId = z
  .string()
  .refine(
    (id) => products.some((product) => product.id === id),
    "Unknown catalog product.",
  );
export const shoppingActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("compare"),
    productIds: z
      .array(catalogId)
      .min(2)
      .max(10)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Choose distinct products.",
      ),
  }),
  z.object({ type: z.literal("details"), productId: catalogId }),
  z.object({
    type: z.literal("search"),
    preset: z.enum([
      "coffee",
      "garden",
      "seating",
      "outdoor",
      "budget",
      "gift",
      "gift-home-fragrance",
    ]),
    requestedCount: z.number().int().min(1).max(1000).optional(),
  }),
  z.object({
    type: z.literal("category"),
    name: z
      .string()
      .refine((name) => products.some((product) => product.category === name)),
  }),
  z.object({ type: z.literal("categories") }),
  z.object({ type: z.literal("more") }),
  z.object({ type: z.literal("availability") }),
  z.object({
    type: z.literal("policy"),
    topic: z.enum(["delivery", "returns", "delivery-and-returns", "payments"]),
  }),
  z.object({
    type: z.literal("cart"),
    productId: catalogId.optional(),
    selection: z.enum(["selected", "first", "cheapest"]).default("selected"),
    quantity: z.number().int().min(1).max(99).default(1),
  }),
  z.object({
    type: z.literal("advice"),
    operationId: z.string().min(1).max(200),
  }),
]);
export type ShoppingAction = z.infer<typeof shoppingActionSchema>;
export const shoppingStarters: {
  label: string;
  text: string;
  action: ShoppingAction;
}[] = [
  {
    label: "My morning coffee",
    text: "I need something for my morning coffee",
    action: { type: "search", preset: "coffee" },
  },
  {
    label: "Garden furniture",
    text: "Show me garden furniture up to €150",
    action: { type: "search", preset: "garden" },
  },
  {
    label: "Finds up to €25",
    text: "What can I buy for €25 or less?",
    action: { type: "search", preset: "budget" },
  },
  {
    label: "Delivery & returns",
    text: "How much is delivery and how long do I have to return an item?",
    action: { type: "policy", topic: "delivery-and-returns" },
  },
];
export const shoppingExamples: {
  label: string;
  text: string;
  action: ShoppingAction;
}[] = [
  { ...shoppingStarters[1], label: "Garden budget" },
  {
    label: "Refine",
    text: "I need something to sit on",
    action: { type: "search", preset: "seating" },
  },
  {
    label: "Alternatives",
    text: "Show me different options",
    action: { type: "more" },
  },
  {
    label: "Correction",
    text: "Show me outdoor furniture, not planters",
    action: { type: "search", preset: "outdoor" },
  },
  {
    label: "Compare",
    text: "Compare mugs and carafe",
    action: { type: "compare", productIds: ["mugs", "carafe"] },
  },
  {
    label: "Add",
    text: "Add two of the cheaper option to my cart",
    action: { type: "cart", selection: "cheapest", quantity: 2 },
  },
  { ...shoppingStarters[0], label: "Coffee" },
  {
    label: "Availability",
    text: "Show only in-stock products",
    action: { type: "availability" },
  },
  {
    label: "Gift",
    text: "Find a candle or diffuser under €25",
    action: { type: "search", preset: "gift-home-fragrance" },
  },
  {
    label: "Delivery",
    text: "How much is delivery?",
    action: { type: "policy", topic: "delivery" },
  },
];
export const chatMetadataSchema = z.object({
  shoppingAction: shoppingActionSchema.optional(),
});
export type ChatMetadata = z.infer<typeof chatMetadataSchema>;
/** Read-only compatibility for buttons emitted before user-message metadata existed. */
export function legacyButtonAction(
  text: string,
  state: AgentState,
): ShoppingAction | undefined {
  const group = state.resultIds.length ? state.resultIds : state.lastIds;
  if (
    text.trim() === "Compare these products" &&
    group.length >= 2 &&
    group.length <= 10
  )
    return shoppingActionSchema.parse({ type: "compare", productIds: group });
  if (text.trim() === "Tell me more about the first product" && group[0])
    return shoppingActionSchema.parse({ type: "details", productId: group[0] });
  return undefined;
}

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
