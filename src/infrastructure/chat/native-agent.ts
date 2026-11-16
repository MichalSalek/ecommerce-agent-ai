import { createHash } from "node:crypto";
import {
  generateText,
  createUIMessageStream,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  ToolChoiceViolationError,
} from "ai";
import { products } from "@/data/products";
import { verifiedRejections } from "@/application/chat/rejections";
import { queryLanguageError } from "@/application/chat/query-language";
import {
  resolveExplicitFacets,
  type ExplicitFacet,
} from "@/application/chat/explicit-facets";
import { expandFunctionalGroup } from "@/domain/catalog/functional-groups";
import { type CatalogService } from "@/application/catalog/catalog-service";
import { criteriaError, meetsFeature } from "@/domain/catalog/requirements";
import type { Product, ProductSearch } from "@/domain/catalog/product";
import { getStorePolicy } from "@/domain/catalog/policies";
import {
  nativeTools,
  agentInstructions,
  answerSchema,
  cartProposalSchema,
  type PresentedAnswer,
} from "@/application/chat/native-tools";
import {
  prepareCartProposal,
  hasCartInstruction,
} from "@/application/chat/cart-authorization";
import {
  transitionState,
  sanitizeState,
  initialAgentState,
  categoryCards,
  comparison,
  type AgentState,
  type Transition,
  type TurnCheckpoint,
  type SearchEvidence,
  type Comparison,
  type TurnStatus,
  transitionSchema,
} from "@/application/chat/shopping-v3";
import type { ChatMessage } from "@/types/shop";
import type { CartAction } from "@/application/chat/cart-action";
import type { ChatRuntime } from "./runtime";

type Evidence = {
  id: string;
  tool: string;
  input: unknown;
  output: unknown;
  productIds: string[];
};
export interface AgentTurn {
  text: string;
  userMessageId: string;
  conversationId?: string;
  state: AgentState;
  history?: ModelMessage[];
  cart?: { productId: string; quantity: number }[];
}
export interface AgentResult {
  answer: string;
  presentation: PresentedAnswer;
  checkpoint: TurnCheckpoint;
  search?: SearchEvidence;
  categories?: ReturnType<typeof categoryCards>;
  comparison?: Comparison;
  cart?: CartAction;
  evidence: Evidence[];
  status: TurnStatus;
}
interface Resolution {
  before: AgentState;
  after: AgentState;
  transition?: Transition;
  search?: SearchEvidence;
}
// Bounded, per-process retry resolution. The serialized checkpoint covers reload/server replacement.
const resolutions = new Map<
  string,
  { expires: number; resolution: Resolution }
>();
const completed = new Map<string, { expires: number; result: AgentResult }>();
const pending = new Map<string, Promise<AgentResult>>();
const compactProduct = (p: Product, detail = false) => ({
  id: p.id,
  name: p.name,
  priceEUR: p.price,
  inStock: p.inStock,
  features: detail ? p.features : p.features.slice(0, 2),
  ...(detail
    ? {
        material: p.material,
        dimensions: p.dimensions,
        description: p.fullDescription,
        limitations: p.limitations,
      }
    : {}),
});
function cleanCaches() {
  for (const map of [resolutions, completed]) {
    for (const [key, value] of map)
      if (value.expires < Date.now()) map.delete(key);
    while (map.size > 300) map.delete(map.keys().next().value!);
  }
}
function turnKey(turn: AgentTurn) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        turn.conversationId ?? "",
        turn.userMessageId,
        turn.text,
        turn.state,
      ]),
    )
    .digest("hex");
}
function numericText(text: string, evidence: Evidence[]) {
  return text
    .replace(/\[\[(price|name):([^\]]+)\]\]/g, (_match, kind, id) => {
      if (!evidence.some((e) => e.productIds.includes(id)))
        throw new Error("Unverified product reference.");
      const product = products.find((p) => p.id === id)!;
      return kind === "price"
        ? `${product.price.toFixed(2)} EUR`
        : product.name;
    })
    .replace(/\[\[count:([^:]+):([^\]]+)\]\]/g, (_match, id, field) => {
      const record = evidence.find((e) => e.id === id)?.output;
      const value =
        record && typeof record === "object" && field in record
          ? (record as Record<string, unknown>)[field]
          : undefined;
      if (typeof value !== "number")
        throw new Error("Unverified count reference.");
      return String(value);
    });
}
function validatePresentation(
  answer: PresentedAnswer,
  evidence: Evidence[],
  search?: SearchEvidence,
) {
  if (answer.evidenceIds.some((id) => !evidence.some((e) => e.id === id)))
    throw new Error("Unknown evidence ID.");
  const cited = evidence.filter((e) => answer.evidenceIds.includes(e.id));
  const foldedReply = answer.text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l");
  if (
    /\bi(?:'ve| have)?\s+added\b|\bwe(?:'ve| have)?\s+added\b|\b(?:was|were|have been|has been)\s+added\b|(?:^|[.!?]\s+)(?:added|saved)\b|dodal(?:em|am)|\bdodano\b|zostal.{0,25}dodan/i.test(
      foldedReply,
    )
  )
    throw new Error(
      "Only the browser may confirm a saved cart operation. Say the selection is prepared and the device will confirm after saving.",
    );
  const offerWords =
    /\b(?:discounts?|promotions?|promo codes?|free|sale)\b|rabat|gratis|darmo/i.test(
      answer.text,
    );
  const denyingOffer =
    /\bno (?:discounts?|promotions?|promo codes?|free)|\bnot free\b|(?:cannot|can't|do not|don't|does not|doesn't).{0,60}(?:offer|apply|provide|discount|promo|free)|(?:nie|brak).{0,50}(?:rabat|promoc|darmo|gratis)/i.test(
      answer.text,
    );
  const approximateBudget = cited.some(
    (record) =>
      (record.output as SearchEvidence)?.appliedCriteria?.targetPrice !==
      undefined,
  );
  if (
    (offerWords && !denyingOffer) ||
    (/%/.test(answer.text) && !approximateBudget)
  )
    throw new Error(
      "There is no verified promotion, free offer or discount. Use canonical prices and policies.",
    );
  if (
    answer.view === "products" &&
    search &&
    !evidence.some(
      (record) =>
        record.tool === "getProductDetails" &&
        record.productIds.some((id) => answer.productIds.includes(id)),
    )
  ) {
    const source = evidence.find((record) => record.id === search.evidenceId);
    if (source && !cited.includes(source)) {
      cited.push(source);
      answer.evidenceIds.push(source.id);
    }
    if (
      answer.productIds.some(
        (id) => !cited.some((record) => record.productIds.includes(id)),
      )
    )
      throw new Error("Products require cited evidence.");
    // The application owns the requested page size; an omitted presentation ID never hides a matching card.
    answer.productIds = search.products.map((product) => product.id);
  }
  const absence =
    /\b(?:no (?:products|items|stock|matches)|nothing (?:available|in stock)|we (?:do not|don't) (?:have|stock)|brak (?:produkt|asortyment|dopasowa)|nie (?:mamy|ma (?:produkt|takich)))/i.test(
      answer.text,
    );
  if (
    absence &&
    !cited.some(
      (e) =>
        (e.tool === "searchProducts" &&
          (e.output as SearchEvidence).products?.length === 0) ||
        (e.tool === "getCatalogOverview" &&
          (e.output as { total: number }).total === 0) ||
        (e.tool === "deviceCart" &&
          (e.output as { totalUnits: number }).totalUnits === 0 &&
          /cart|basket|koszyk/i.test(answer.text)),
    )
  )
    throw new Error("Check the exact catalog scope before claiming absence.");
  if (
    /we (?:do not|don't) (?:have|stock)|nie mamy|brak asortymentu/i.test(
      answer.text,
    ) &&
    !/\bmore\b|additional|new options|kolejn|nowych/i.test(answer.text) &&
    cited.some(
      (record) =>
        record.tool === "searchProducts" &&
        ["exhausted", "unconfirmed-feature"].includes(
          (record.output as SearchEvidence).outcome,
        ),
    )
  )
    throw new Error(
      "Shown items or an unconfirmed feature do not establish absence of assortment.",
    );
  if (
    new Set(answer.productIds).size !== answer.productIds.length ||
    answer.productIds.some(
      (id) => !cited.some((e) => e.productIds.includes(id)),
    )
  )
    throw new Error("Products require cited evidence.");
  if (
    answer.claim &&
    answer.claim !== "none" &&
    !cited.some(
      (e) =>
        (e.output as SearchEvidence)?.outcome === answer.claim ||
        (answer.claim === "unavailable" &&
          e.productIds.some((id) =>
            products.some((product) => product.id === id && !product.inStock),
          )) ||
        (answer.claim === "no-assortment" &&
          e.tool === "getCatalogOverview" &&
          (e.output as { total: number }).total === 0),
    )
  )
    throw new Error("Absence requires a measured scoped result.");
  if (/https?:|www\.|\]\(|<\w|\[\[(?!price:|name:|count:)/i.test(answer.text))
    throw new Error(
      "Use canonical cards and supported references, not URLs/markup.",
    );
  // Prices in advice are resolved by the application. Avoid unchecked numeric currency claims.
  const withoutReferences = answer.text.replace(/\[\[[^\]]+\]\]/g, "");
  if (cited.length) {
    const facts = cited.flatMap((record) => [
      record.output,
      ...record.productIds.flatMap((id) => products.filter((p) => p.id === id)),
      ...(record.output &&
      typeof record.output === "object" &&
      "differencesCents" in record.output
        ? (record.output as Comparison).differencesCents.map(
            (row) => row.cents / 100,
          )
        : []),
    ]);
    const numbers =
      JSON.stringify(facts)
        .match(/\d+(?:[.,]\d+)?/g)
        ?.map((value) => Number(value.replace(",", "."))) ?? [];
    const numberWords = [
      "zero",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
    ];
    for (const [number, word] of numberWords.entries())
      if (new RegExp(`\\b${word}\\b`, "i").test(JSON.stringify(facts)))
        numbers.push(number);
    for (const token of withoutReferences.match(/\d+(?:[.,]\d+)?/g) ?? []) {
      if (!numbers.includes(Number(token.replace(",", "."))))
        throw new Error(
          "Unverified numerical fact. Use the executed catalog/policy evidence.",
        );
    }
    if (
      /(?:all.*(?:in stock|available)|wszystk.*dostępn)/i.test(answer.text) &&
      !/(?:not all|nie wszystk)/i.test(answer.text) &&
      cited.some((record) =>
        record.productIds.some(
          (id) => products.find((p) => p.id === id)?.inStock === false,
        ),
      )
    )
      throw new Error("Not all cited products are in stock.");
  }
  const counts = cited.flatMap((e) => {
    const record = e.output as Record<string, unknown>;
    return [
      "total",
      "scopeTotal",
      "totalMatches",
      "unseenMatches",
      "remainingMatches",
      "requestedCount",
      "totalLines",
      "totalUnits",
    ]
      .flatMap((field) =>
        typeof record?.[field] === "number" ? [record[field] as number] : [],
      )
      .concat(
        ...["products", "categories"].flatMap((field) =>
          Array.isArray(record?.[field])
            ? [(record[field] as unknown[]).length]
            : [],
        ),
      )
      .concat(
        Array.isArray(record?.categories)
          ? record.categories.flatMap((category) =>
              category &&
              typeof category === "object" &&
              "count" in category &&
              typeof category.count === "number"
                ? [category.count]
                : [],
            )
          : [],
      );
  });
  for (const match of withoutReferences.matchAll(
    /\b(\d+)\s+(?:products?|items?|matches|categories|produkt\w*|kategor\w*|dopasowa\w*)\b/gi,
  ))
    if (!counts.includes(Number(match[1])))
      throw new Error(
        "Unverified catalog count. Use [[count:EVIDENCE:FIELD]].",
      );
  const amounts = cited.flatMap((e) => {
    const record = e.output as {
      appliedCriteria?: ProductSearch;
      differencesCents?: { cents: number }[];
      policy?: string;
      totalEUR?: number;
    };
    return [
      ...e.productIds.flatMap((id) =>
        products.filter((p) => p.id === id).map((p) => p.price),
      ),
      record?.appliedCriteria?.maxPrice,
      record?.appliedCriteria?.targetPrice,
      record?.totalEUR,
      ...(record?.differencesCents ?? []).map((p) => p.cents / 100),
      ...(record?.policy?.match(/\d+(?:\.\d+)?/g) ?? []).map(Number),
    ].filter((n): n is number => typeof n === "number");
  });
  for (const match of withoutReferences.matchAll(
    /(?:EUR|€)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:EUR|euros?|€)\b/gi,
  )) {
    const amount = Number((match[1] ?? match[2]).replace(",", "."));
    if (!amounts.includes(amount))
      throw new Error(
        "Unverified monetary amount. Use [[price:ID]] or a verified criterion.",
      );
  }
  if (
    /(?:USD|GBP|PLN|[$£¥₹])\s*\d|\d+\s*(?:USD|GBP|PLN|zł|zl|£|¥|₹)\b/i.test(
      withoutReferences,
    )
  )
    throw new Error("The catalog is priced in EUR; do not convert currencies.");
  return numericText(answer.text, cited);
}
export function stateFromMessages(
  messages: ChatMessage[],
  userMessageId: string,
): AgentState {
  const current = messages.findIndex((m) => m.id === userMessageId);
  let state = initialAgentState();
  let previousUser: ChatMessage | undefined;
  for (const message of messages.slice(
    0,
    current < 0 ? messages.length : current,
  )) {
    if (message.role === "user") {
      previousUser = message;
      continue;
    }
    if (message.role !== "assistant") continue;
    const checkpoint = message.parts.findLast(
      (p) => p.type === "data-shoppingState",
    );
    if (
      checkpoint?.type === "data-shoppingState" &&
      previousUser?.id === checkpoint.data.userMessageId &&
      previousUser.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join(" ") === checkpoint.data.text
    ) {
      state = sanitizeState(checkpoint.data.after);
      continue;
    }
    // Migration uses recorded tool inputs/results, never reinterprets old customer language.
    for (const part of message.parts) {
      if (
        !part.type.startsWith("tool-") ||
        !("output" in part) ||
        part.state !== "output-available"
      )
        continue;
      const output = part.output;
      const rows = Array.isArray(output)
        ? output
        : output &&
            typeof output === "object" &&
            "products" in output &&
            Array.isArray(output.products)
          ? output.products
          : output && typeof output === "object" && "id" in output
            ? [output]
            : [];
      const ids = rows.flatMap((p: unknown) =>
        p &&
        typeof p === "object" &&
        "id" in p &&
        typeof p.id === "string" &&
        products.some((row) => row.id === p.id)
          ? [p.id]
          : [],
      );
      if (part.type === "tool-searchProducts") {
        const input = part.input as ProductSearch & { newSearch?: boolean };
        if (input.newSearch)
          state = { ...initialAgentState(), language: state.language };
        const { excludeIds, limit, newSearch, ...criteria } = input;
        state.criteria = criteria;
        state.requestedCount = 5;
        state.shownIds = [
          ...new Set([...state.shownIds, ...(excludeIds ?? []), ...ids]),
        ];
        state.resultIds = ids.slice(0, 10);
      }
      if (ids.length) state.lastIds = ids;
      if (part.type === "tool-compareProducts") state.comparisonIds = ids;
    }
  }
  return sanitizeState(state);
}
export async function runAgent(
  model: LanguageModel,
  catalog: CatalogService,
  turn: AgentTurn,
  signal: AbortSignal,
  options: Partial<ChatRuntime> = {},
): Promise<AgentResult> {
  cleanCaches();
  const resolutionKey = turnKey(turn);
  const key =
    resolutionKey +
    ":" +
    createHash("sha256")
      .update(JSON.stringify(turn.cart ?? null))
      .digest("hex");
  if (completed.has(key)) {
    signal.throwIfAborted();
    return structuredClone(completed.get(key)!.result);
  }
  const existing = pending.get(key);
  if (existing) {
    await existing.catch(() => undefined);
    signal.throwIfAborted();
    if (completed.has(key)) return structuredClone(completed.get(key)!.result);
  }
  const execution = executeAgent(
    model,
    catalog,
    turn,
    signal,
    options,
    resolutionKey,
  );
  pending.set(key, execution);
  try {
    const result = await execution;
    signal.throwIfAborted();
    if (result.status.status === "complete")
      completed.set(key, { expires: Date.now() + 3600000, result });
    return result;
  } finally {
    if (pending.get(key) === execution) pending.delete(key);
  }
}
async function executeAgent(
  model: LanguageModel,
  catalog: CatalogService,
  turn: AgentTurn,
  signal: AbortSignal,
  options: Partial<ChatRuntime>,
  key: string,
): Promise<AgentResult> {
  let resolution = resolutions.get(key)?.resolution;
  const before = resolution?.before ?? sanitizeState(turn.state);
  let after = resolution?.after ?? structuredClone(before);
  let search = resolution?.search;
  let change = resolution?.transition;
  let categories: ReturnType<typeof categoryCards> | undefined,
    compared: Comparison | undefined,
    cart: CartAction | undefined;
  const evidence: Evidence[] = [];
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    calls: 0,
  };
  const accountUsage = (fallback?: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  }) => {
    const measured = options.takeUsage?.() ?? [];
    for (const sample of measured.length
      ? measured
      : fallback
        ? [fallback]
        : []) {
      usage.inputTokens += sample.inputTokens;
      usage.outputTokens += sample.outputTokens;
      usage.cachedInputTokens += sample.cachedInputTokens;
    }
  };
  const recent: ModelMessage[] =
    turn.history
      ?.slice(-2)
      .flatMap((m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
          ? [{ role: m.role, content: m.content.slice(-350) }]
          : [],
      ) ?? [];
  const budgetCriteria = {
    ...(before.criteria.maxPrice === undefined
      ? {}
      : { maxPrice: before.criteria.maxPrice }),
    ...(before.criteria.targetPrice === undefined
      ? {}
      : { targetPrice: before.criteria.targetPrice }),
  };
  const preferenceEvidence: Evidence | undefined = Object.keys(budgetCriteria)
    .length
    ? {
        id: "preferences",
        tool: "userPreferences",
        input: { source: "typed user budget" },
        output: { appliedCriteria: budgetCriteria },
        productIds: [],
      }
    : undefined;
  const selectedProducts = before.lastIds
    .flatMap((id) => products.filter((product) => product.id === id))
    .map((product) => compactProduct(product));
  const selectionEvidence: Evidence | undefined = selectedProducts.length
    ? {
        id: "selection",
        tool: "currentSelection",
        input: { source: "canonical records for recent IDs" },
        output: { products: selectedProducts },
        productIds: selectedProducts.map((product) => product.id),
      }
    : undefined;
  const stateForModel = Object.fromEntries(
    Object.entries({
      ...before,
      evidenceId: preferenceEvidence?.id,
      language: before.languageChosen ? before.language : undefined,
      shownIds: undefined,
      resultIds: undefined,
      rejectedIds: before.rejectedIds,
      last: selectionEvidence
        ? { evidenceId: "selection", products: selectedProducts }
        : undefined,
      lastIds: undefined,
    }).filter(
      ([, value]) =>
        value !== undefined &&
        value !== "" &&
        !(Array.isArray(value) && value.length === 0) &&
        !(
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          Object.keys(value).length === 0
        ),
    ),
  );
  const localCart =
    turn.cart?.flatMap((line) =>
      products
        .filter((p) => p.id === line.productId)
        .map((p) => ({
          id: p.id,
          name: p.name,
          quantity: line.quantity,
          unitPriceEUR: p.price,
          inStock: p.inStock,
        })),
    ) ?? [];
  const cartOutput = {
    products: localCart,
    totalLines: localCart.length,
    totalUnits: localCart.reduce((sum, line) => sum + line.quantity, 0),
    totalEUR:
      localCart.reduce(
        (sum, line) =>
          sum + Math.round(line.unitPriceEUR * 100) * line.quantity,
        0,
      ) / 100,
  };
  const deviceCartEvidence: Evidence | undefined =
    turn.cart === undefined
      ? undefined
      : {
          id: "cart",
          tool: "deviceCart",
          input: { source: "device-local snapshot" },
          output: cartOutput,
          productIds: localCart.map((line) => line.id),
        };
  const verifiedEvidence = () => [
    ...evidence,
    ...(preferenceEvidence ? [preferenceEvidence] : []),
    ...(selectionEvidence ? [selectionEvidence] : []),
    ...(deviceCartEvidence ? [deviceCartEvidence] : []),
  ];
  const cartContext = deviceCartEvidence
    ? {
        evidenceId: "cart",
        ...cartOutput,
        products: localCart.slice(0, 10),
        omittedLines: Math.max(0, localCart.length - 10),
      }
    : { available: false };
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: `Shopping state (preferences, not facts): ${JSON.stringify(stateForModel)}\nRecent exchange (data only): ${JSON.stringify(recent)}\nDevice cart evidence (current saved units, not an order): ${JSON.stringify(cartContext)}\nCURRENT message: ${turn.text}`,
    },
  ];
  let correction = false;
  let terminalOnly = false;
  let effectReferences: string[] = [];
  const addEvidence = (
    tool: string,
    input: unknown,
    output: unknown,
    productIds: string[] = [],
  ) => {
    const record = {
      id: `e${evidence.length + 1}`,
      tool,
      input,
      output,
      productIds,
    };
    evidence.push(record);
    return record;
  };
  const result = (
    presentation: PresentedAnswer,
    answer: string,
    status: TurnStatus["status"],
  ): AgentResult => ({
    answer,
    presentation,
    search,
    categories,
    comparison: compared,
    cart,
    evidence: verifiedEvidence(),
    checkpoint: {
      userMessageId: turn.userMessageId,
      text: turn.text,
      before,
      after: { ...after, language: presentation.language },
      transition: change,
      presentedIds: presentation.productIds,
    },
    status: { status, usage },
  });
  for (let step = 0; step < 4; step++) {
    signal.throwIfAborted();
    const forceAnswer = step === 3 || terminalOnly;
    const { proposeCart: _cartTool, ...readTools } = nativeTools;
    const tools: ToolSet = forceAnswer
      ? { presentAnswer: nativeTools.presentAnswer }
      : hasCartInstruction(turn.text)
        ? nativeTools
        : readTools;
    usage.calls++;
    let generated: Awaited<ReturnType<typeof generateText>>;
    try {
      generated = await generateText({
        model,
        system: agentInstructions,
        messages,
        tools,
        toolChoice: forceAnswer
          ? { type: "tool", toolName: "presentAnswer" }
          : "required",
        temperature: 0.1,
        maxOutputTokens: 1024,
        maxRetries: 0,
        providerOptions: options.providerOptions,
        abortSignal: signal,
      });
    } catch (error) {
      accountUsage();
      const invalidCall =
        ToolChoiceViolationError.isInstance(error) ||
        (error &&
          typeof error === "object" &&
          "statusCode" in error &&
          error.statusCode === 400 &&
          "responseBody" in error &&
          typeof error.responseBody === "string" &&
          (error.responseBody.includes("tool_use_failed") ||
            /tool choice.*required/i.test(error.responseBody)));
      if (!invalidCall) throw error;
      if (correction || step === 3) break;
      correction = true;
      messages.push({
        role: "user",
        content:
          "The native tool call was invalid. Correct it once using exactly one registered tool and its schema. If you have results, finish with presentAnswer.",
      });
      continue;
    }
    accountUsage({
      inputTokens: generated.usage.inputTokens ?? 0,
      outputTokens: generated.usage.outputTokens ?? 0,
      cachedInputTokens:
        generated.usage.inputTokenDetails?.cacheReadTokens ?? 0,
    });
    console.log(
      "[AGENT] inference",
      JSON.stringify({
        input: generated.usage.inputTokens,
        output: generated.usage.outputTokens,
        cached: generated.usage.inputTokenDetails?.cacheReadTokens ?? 0,
        limits: Object.fromEntries(
          Object.entries(generated.response.headers ?? {}).filter(([name]) =>
            /ratelimit|retry-after/.test(name),
          ),
        ),
      }),
    );
    if (generated.toolCalls.length !== 1) {
      if (correction) break;
      correction = true;
      messages.push({
        role: "user",
        content:
          "Call exactly one valid native tool. Use presentAnswer to finish.",
      });
      continue;
    }
    const call = generated.toolCalls[0];
    const name = call.toolName;
    console.log(
      "[AGENT] tool",
      JSON.stringify({ name, invalid: "invalid" in call && call.invalid }),
    );
    let output: unknown;
    try {
      if ("invalid" in call && call.invalid)
        throw new Error(
          name === "searchProducts" || name === "getCatalogOverview"
            ? "Invalid input. Hard kind/type/category belong in explicitFilters with CURRENT source words. Functional needs use functionalGroup, not a guessed subtype list."
            : "Invalid tool input. Correct the tool schema once.",
        );
      if (name === "presentAnswer") {
        const answer = answerSchema.parse(call.input);
        if (
          answer.productIds.some(
            (id) =>
              !verifiedEvidence().some((record) =>
                record.productIds.includes(id),
              ),
          )
        )
          throw new Error("Unverified product reference.");
        if (
          compared &&
          !cart &&
          (answer.view === "none" || answer.view === "comparison")
        ) {
          answer.view = "comparison";
          answer.productIds = compared.productIds;
          const source = evidence.find(
            (record) => record.tool === "compareProducts",
          );
          if (source && !answer.evidenceIds.includes(source.id))
            answer.evidenceIds.push(source.id);
        } else if (categories && !search && answer.view === "none")
          answer.view = "categories";
        else if (
          search &&
          answer.view === "none" &&
          answer.productIds.length &&
          (search.products.length !== before.lastIds.length ||
            search.products.some(
              (product) => !before.lastIds.includes(product.id),
            ))
        )
          answer.view = "products";
        const text = validatePresentation(answer, verifiedEvidence(), search);
        after.languageChosen = true;
        if (answer.view === "categories" && !categories)
          throw new Error("Read categories first.");
        if (
          answer.view === "comparison" &&
          (!compared ||
            compared.productIds.some((id) => !answer.productIds.includes(id)))
        )
          throw new Error("Read the complete comparison first.");
        if (answer.productIds.length) {
          after.lastIds = answer.productIds;
          after.selectedIds =
            answer.productIds.length === 1 ? answer.productIds : [];
          if (search)
            after.shownIds = [
              ...new Set([...after.shownIds, ...answer.productIds]),
            ];
        }
        if (
          search &&
          (answer.view === "products" || answer.view === "comparison")
        )
          after.resultIds = search.products.map((product) => product.id);
        signal.throwIfAborted();
        console.log("[AGENT] usage", JSON.stringify(usage));
        return result(answer, text, "complete");
      }
      switch (name) {
        case "searchProducts": {
          const raw = call.input as {
            mode?: "recommend" | "lookup";
            rejections?: { productId: string; userQuote: string }[];
            explicitFilters?: ExplicitFacet[];
          };
          let proposed = transitionSchema.parse({
            ...(call.input as object),
            rejectedIds: verifiedRejections(
              turn.text,
              before,
              raw.rejections ?? [],
            ),
          });
          if (raw.mode === "lookup") {
            const fresh = initialAgentState();
            const checked = resolveExplicitFacets(
              turn.text,
              fresh,
              { ...proposed, operation: "new" },
              raw.explicitFilters ?? [],
            );
            if ("error" in checked) {
              output = checked;
              break;
            }
            const lookupCriteria: ProductSearch = {
              query: "",
              ...checked.change.criteria,
              limit: 10,
            };
            const invalid =
              criteriaError(lookupCriteria) ??
              queryLanguageError(lookupCriteria.query);
            if (invalid) {
              output = invalid;
              break;
            }
            const found = await catalog.searchResult(lookupCriteria);
            output = {
              lookupOnly: true,
              appliedCriteria: lookupCriteria,
              products: found.products.map((product) =>
                compactProduct(product, true),
              ),
              totalMatches: found.totalMatches,
            };
            effectReferences = found.products.map((product) => product.id);
            break;
          }
          if (!resolution) {
            const verified = resolveExplicitFacets(
              turn.text,
              before,
              proposed,
              raw.explicitFilters ?? [],
            );
            if ("error" in verified) {
              output = verified;
              break;
            }
            proposed = verified.change;
            const candidate = change
              ? structuredClone(after)
              : transitionState(before, proposed);
            const invalid =
              criteriaError(candidate.criteria) ??
              queryLanguageError(candidate.criteria.query);
            if (invalid) {
              output = invalid;
              break;
            }
            change ??= proposed;
            after = candidate;
            const criteria: ProductSearch = {
              query: "",
              ...after.criteria,
              limit: Math.min(10, after.requestedCount),
              excludeIds:
                proposed.operation === "more"
                  ? [...new Set([...after.shownIds, ...after.rejectedIds])]
                  : after.rejectedIds,
            };
            const scoped = {
              category: criteria.category,
              productKind: criteria.productKind,
              productType: criteria.productType,
              productTypes: criteria.productTypes,
              functionalGroup: criteria.functionalGroup,
              useEnvironment: criteria.useEnvironment,
            };
            const scope = await catalog.overview(scoped);
            const found = await catalog.searchResult(criteria);
            const unknownFeature = criteria.requiredFeatures?.some(
              (feature) => !products.some((p) => meetsFeature(p, feature)),
            );
            const withoutStock =
              criteria.inStockOnly && found.totalMatches === 0
                ? await catalog.searchResult({
                    ...criteria,
                    inStockOnly: false,
                    excludeIds: undefined,
                  })
                : undefined;
            const outcome: SearchEvidence["outcome"] = found.products.length
              ? "matches"
              : found.totalMatches
                ? "exhausted"
                : scope.total === 0
                  ? "no-assortment"
                  : unknownFeature
                    ? "unconfirmed-feature"
                    : withoutStock?.totalMatches
                      ? "unavailable"
                      : "no-match";
            const unseenMatches =
              found.matchedIds?.filter(
                (id) =>
                  !after.shownIds.includes(id) &&
                  !after.rejectedIds.includes(id),
              ).length ?? found.unseenMatches;
            const newlyShownCount = found.products.filter(
              (p) => !after.shownIds.includes(p.id),
            ).length;
            search = {
              evidenceId: "",
              products: found.products.map((p) => ({ id: p.id })),
              appliedCriteria: {
                ...after.criteria,
                ...(after.criteria.functionalGroup
                  ? {
                      productTypes:
                        after.criteria.productTypes ??
                        expandFunctionalGroup(after.criteria.functionalGroup),
                    }
                  : {}),
              },
              outcome,
              requestedCount: after.requestedCount,
              scopeTotal: scope.total,
              totalMatches: found.totalMatches,
              unseenMatches,
              remainingMatches: Math.max(0, unseenMatches - newlyShownCount),
              newlyShownCount,
            };
            resolution = { before, after, transition: change, search };
            resolutions.set(key, {
              expires: Date.now() + 3600000,
              resolution: structuredClone(resolution),
            });
          }
          search = structuredClone(resolution.search!);
          after = structuredClone(resolution.after);
          search.evidenceId = `e${evidence.length + 1}`;
          output = {
            ...search,
            products: search.products.map((row) =>
              compactProduct(products.find((p) => p.id === row.id)!),
            ),
          };
          effectReferences = search.products.map((product) => product.id);
          if (
            (call.input as { continueWith?: string }).continueWith ===
              "presentAnswer" &&
            !hasCartInstruction(turn.text)
          )
            terminalOnly = true;
          break;
        }
        case "getCatalogOverview": {
          const input = call.input as {
            criteria: Partial<ProductSearch>;
            useActive?: boolean;
            explicitFilters?: ExplicitFacet[];
          };
          const checked = resolveExplicitFacets(
            turn.text,
            after,
            {
              operation: input.useActive ? "refine" : "browse",
              language: after.language,
              criteria: input.criteria,
            },
            input.explicitFilters ?? [],
          );
          if ("error" in checked) {
            output = checked;
            break;
          }
          const criteria = transitionState(after, checked.change).criteria;
          output =
            criteriaError(criteria) ??
            (await catalog.overview({ ...criteria, excludeIds: undefined }));
          if (
            !(output && typeof output === "object" && "error" in output) &&
            !change
          ) {
            change = {
              operation: input.useActive ? "refine" : "browse",
              language: after.language,
              criteria,
            };
            after = transitionState(before, change);
          }
          break;
        }
        case "getCategories":
          categories = categoryCards();
          output = { categories };
          break;
        case "getProductDetails": {
          const input = call.input as { productId: string };
          const product = await catalog.details(input.productId);
          if (product) effectReferences = [product.id];
          output = product
            ? compactProduct(product, true)
            : { error: "Unknown product ID. Use a verified ID." };
          break;
        }
        case "compareProducts": {
          const refs = (call.input as { productIds: string[] }).productIds;
          let productIds = refs.map(
            (ref) =>
              products.find(
                (product) =>
                  product.id === ref ||
                  product.name.toLowerCase() === ref.toLowerCase(),
              )?.id ?? ref,
          );
          if (
            new Set(productIds).size !== productIds.length ||
            productIds.some((id) => !products.some((p) => p.id === id))
          )
            throw new Error("Use distinct canonical product IDs.");
          const current = turn.text.toLowerCase();
          const named = products
            .flatMap((product) => {
              const positions = [product.id, product.name].flatMap((label) => {
                const escaped = label
                  .toLowerCase()
                  .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const match = new RegExp(
                  `(?:^|[^a-z0-9-])${escaped}(?=$|[^a-z0-9-])`,
                ).exec(current);
                return match ? [match.index] : [];
              });
              return positions.length
                ? [{ id: product.id, position: Math.min(...positions) }]
                : [];
            })
            .sort((a, b) => a.position - b.position)
            .map((product) => product.id);
          let unnamed = current;
          for (const label of products
            .filter((product) => named.includes(product.id))
            .flatMap((product) => [product.id, product.name])
            .sort((a, b) => b.length - a.length)) {
            const escaped = label
              .toLowerCase()
              .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            unnamed = unnamed.replace(
              new RegExp(`(?:^|[^a-z0-9-])${escaped}(?=$|[^a-z0-9-])`, "g"),
              " ",
            );
          }
          const directList = !unnamed
            .replace(
              /\b(?:compare|and|with|vs|versus|to|please|could|can|you|the|products?|items?)\b/g,
              "",
            )
            .replace(/[\s.,?!&:;'"/()-]+/g, "");
          if (directList && named.length >= 2) {
            if (named.some((id) => !productIds.includes(id)))
              throw new Error(
                `Include the explicitly named products: ${named.join(", ")}.`,
              );
            // Resolve a direct canonical list in source order; incidental lookup hits cannot expand it.
            productIds = named;
          }
          compared = comparison(productIds);
          after.comparisonIds = productIds;
          effectReferences = productIds;
          output = {
            ...compared,
            products: productIds.map((id) =>
              compactProduct(
                products.find((p) => p.id === id)!,
                true,
              ),
            ),
          };
          break;
        }
        case "getPolicy":
          output = {
            policy: getStorePolicy((call.input as { topic: string }).topic),
          };
          break;
        case "proposeCart": {
          let proposal = cartProposalSchema.parse(call.input);
          const effectState = effectReferences.length
            ? {
                ...after,
                lastIds: effectReferences,
                selectedIds:
                  effectReferences.length === 1
                    ? effectReferences
                    : after.selectedIds,
              }
            : after;
          const prepared = prepareCartProposal(
            turn.text,
            effectState,
            proposal,
            { resolvedThisTurn: effectReferences.length > 0 },
          );
          const error = "error" in prepared ? prepared.error : undefined;
          if ("proposal" in prepared) proposal = prepared.proposal;
          if (error) {
            terminalOnly = true;
            output = {
              status: "needs-clarification",
              reason: error,
              ...(proposal.items.some((item) =>
                products.some(
                  (product) =>
                    product.id === item.productId && !product.inStock,
                ),
              )
                ? { outcome: "unavailable" }
                : {}),
              candidates: [
                ...new Set([
                  ...after.lastIds,
                  ...proposal.items.map((item) => item.productId),
                ]),
              ].flatMap((id) =>
                products
                  .filter((product) => product.id === id)
                  .map((product) => compactProduct(product)),
              ),
            };
            break;
          }
          const operationId = createHash("sha256")
            .update(
              JSON.stringify([
                turn.conversationId ?? "",
                turn.userMessageId,
                "addToCart",
              ]),
            )
            .digest("hex");
          cart = {
            operationId,
            userMessageId: turn.userMessageId,
            ...proposal.items[0],
            items: proposal.items,
          };
          after.selectedIds = proposal.items.map((p) => p.productId);
          output = {
            status: "proposal-only",
            maxUnitsPerProduct: 99,
            maxItemsPerAction: 10,
            totalUnits: proposal.items.reduce(
              (sum, item) => sum + item.quantity,
              0,
            ),
            totalEUR:
              proposal.items.reduce(
                (sum, item) =>
                  sum +
                  Math.round(
                    products.find((product) => product.id === item.productId)!
                      .price * 100,
                  ) *
                    item.quantity,
                0,
              ) / 100,
            items: proposal.items.map((p) => ({
              ...p,
              ...compactProduct(
                products.find((row) => row.id === p.productId)!,
              ),
            })),
            note: "Browser has not saved this operation. Do not claim added.",
          };
          break;
        }
        default:
          throw new Error("Unknown tool. Use a registered native tool.");
      }
      const hasError =
        output && typeof output === "object" && "error" in output;
      if (hasError) {
        if (correction) break;
        correction = true;
      }
      const ids =
        name === "searchProducts"
          ? output &&
            typeof output === "object" &&
            "products" in output &&
            Array.isArray(output.products)
            ? output.products.map((product) => product.id)
            : []
          : name === "getProductDetails" && !hasError
            ? [(call.input as { productId: string }).productId]
            : name === "compareProducts"
              ? (compared?.productIds ?? [])
              : name === "proposeCart" && !hasError
                ? (cart?.items?.map((p) => p.productId) ??
                  (terminalOnly &&
                  output &&
                  typeof output === "object" &&
                  "candidates" in output &&
                  Array.isArray(output.candidates)
                    ? output.candidates.map((product) => product.id)
                    : []))
                : [];
      const record = addEvidence(name, call.input, output, ids);
      messages.push(
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: call.toolCallId,
              toolName: name,
              input: call.input,
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: call.toolCallId,
              toolName: name,
              output: {
                type: "json",
                value: JSON.parse(
                  JSON.stringify({
                    evidenceId: record.id,
                    ...(output as object),
                  }),
                ),
              },
            },
          ],
        },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn(
        "[AGENT] rejected tool",
        JSON.stringify({
          tool: name,
          error: error instanceof Error ? error.message : "Invalid input",
        }),
      );
      if (correction) break;
      correction = true;
      const rejection = {
        error: error instanceof Error ? error.message : "Invalid tool input.",
        ...(name === "proposeCart"
          ? { maxUnitsPerProduct: 99, maxItemsPerAction: 10 }
          : {}),
      };
      const rejected =
        name in nativeTools
          ? addEvidence(name, call.input, rejection)
          : undefined;
      // A rejected presentation is never emitted. One native correction stays within four inferences.
      messages.push(
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: call.toolCallId,
              toolName: name,
              input: call.input,
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: call.toolCallId,
              toolName: name,
              output: {
                type: "json",
                value: {
                  ...(rejected ? { evidenceId: rejected.id } : {}),
                  ...rejection,
                },
              },
            },
          ],
        },
      );
    }
  }
  cart = undefined;
  if (search) {
    after.lastIds = search.products.map((p) => p.id);
    after.shownIds = [...new Set([...after.shownIds, ...after.lastIds])];
  }
  const answer: PresentedAnswer = {
    text:
      after.language === "pl"
        ? "Nie udało się dokończyć odpowiedzi. Zachowuję sprawdzone wyniki; możesz spróbować ponownie."
        : "I could not finish the response. The verified results are kept; you can retry.",
    language: after.language,
    evidenceIds: evidence.map((e) => e.id),
    productIds: search?.products.map((p) => p.id) ?? [],
    view: search ? "products" : "none",
  };
  return result(answer, answer.text, "partial");
}

export function createNativeAgentStream(
  runtime: ChatRuntime,
  catalog: CatalogService,
  turn: AgentTurn,
  signal: AbortSignal,
  options: {
    contract?: "shopping-v2" | "shopping-v3";
    onSettled?: () => void;
  } = {},
) {
  return createUIMessageStream<ChatMessage>({
    execute: async ({ writer }) => {
      try {
        const result = await runAgent(
          runtime.model,
          catalog,
          turn,
          signal,
          runtime,
        );
        signal.throwIfAborted();
        writer.write({ type: "start", messageId: crypto.randomUUID() });
        writer.write({ type: "text-start", id: "answer" });
        const manualCart =
          result.cart &&
          !(
            options.contract === "shopping-v3" ||
            (options.contract === "shopping-v2" &&
              result.cart.items?.length === 1)
          );
        writer.write({
          type: "text-delta",
          id: "answer",
          delta:
            result.answer +
            (manualCart
              ? result.checkpoint.after.language === "pl"
                ? " Użyj przycisków Add to cart na kartach produktów, aby dodać je na tym urządzeniu."
                : " Use Add to cart on the product cards to add these items on this device."
              : ""),
        });
        writer.write({ type: "text-end", id: "answer" });
        if (options.contract === "shopping-v3") {
          writer.write({ type: "data-shoppingState", data: result.checkpoint });
          if (result.presentation.view === "products" && result.search)
            writer.write({ type: "data-products", data: result.search });
          else if (
            result.presentation.view === "products" &&
            result.presentation.productIds.length
          )
            writer.write({
              type: "data-products",
              data: {
                evidenceKind: "selection",
                evidenceId: result.presentation.evidenceIds[0] ?? "",
                products: result.presentation.productIds.map((id) => ({ id })),
                appliedCriteria: {},
                outcome: "matches",
                requestedCount: result.presentation.productIds.length,
                scopeTotal: result.presentation.productIds.length,
                totalMatches: result.presentation.productIds.length,
                unseenMatches: result.presentation.productIds.length,
                remainingMatches: 0,
              },
            });
          if (result.presentation.view === "categories" && result.categories)
            writer.write({ type: "data-categories", data: result.categories });
          if (result.presentation.view === "comparison" && result.comparison)
            writer.write({ type: "data-comparison", data: result.comparison });
          writer.write({ type: "data-turnStatus", data: result.status });
        } else {
          // Presentation adapters share the same engine and preserve the old result shape.
          for (const record of result.evidence) {
            if (
              ![
                "searchProducts",
                "getProductDetails",
                "compareProducts",
                "getCategories",
                "getPolicy",
                "getCatalogOverview",
              ].includes(record.tool)
            )
              continue;
            let output: unknown = record.output;
            let input = record.input;
            if (
              record.tool === "searchProducts" &&
              (record.output as { lookupOnly?: boolean })?.lookupOnly
            ) {
              output = record.productIds.flatMap((id) =>
                products.filter((product) => product.id === id),
              );
              input = {
                ...(record.output as { appliedCriteria: ProductSearch })
                  .appliedCriteria,
                limit: 10,
              };
            } else if (record.tool === "searchProducts" && result.search) {
              const rows = result.search.products.flatMap((row) =>
                products.filter((p) => p.id === row.id),
              );
              output =
                options.contract === "shopping-v2"
                  ? { ...result.search, products: rows }
                  : rows;
              input = {
                query: "",
                ...result.search.appliedCriteria,
                limit: Math.min(10, result.search.requestedCount),
              };
            } else if (record.tool === "getCategories")
              output = result.categories?.map((c) => c.name) ?? [];
            else if (record.tool === "getPolicy")
              output = (record.output as { policy: string }).policy;
            else if (record.productIds.length)
              output =
                record.tool === "getProductDetails"
                  ? products.find((p) => p.id === record.productIds[0])
                  : {
                      products: record.productIds.flatMap((id) =>
                        products.filter((p) => p.id === id),
                      ),
                      missingIds: [],
                    };
            writer.write({
              type: "tool-input-available",
              toolCallId: record.id,
              toolName: record.tool,
              input,
            });
            writer.write({
              type: "tool-output-available",
              toolCallId: record.id,
              output,
            });
          }
          if (manualCart && result.cart) {
            const ids = (result.cart.items ?? [result.cart]).map(
              (item) => item.productId,
            );
            writer.write({
              type: "tool-input-available",
              toolCallId: "manual-cart",
              toolName: "searchProducts",
              input: { query: "", limit: ids.length },
            });
            writer.write({
              type: "tool-output-available",
              toolCallId: "manual-cart",
              output: products.filter((p) => ids.includes(p.id)),
            });
          }
        }
        if (
          result.cart &&
          turn.conversationId &&
          (options.contract === "shopping-v3" ||
            (options.contract === "shopping-v2" &&
              result.cart.items?.length === 1))
        ) {
          signal.throwIfAborted();
          writer.write({
            type: "data-cartAction",
            id: result.cart.operationId,
            data: result.cart,
          });
        }
        writer.write({ type: "finish" });
      } catch (error) {
        if (
          signal.aborted &&
          !(
            signal.reason instanceof Error &&
            signal.reason.name === "TimeoutError"
          )
        )
          return;
        const status =
          error && typeof error === "object" && "statusCode" in error
            ? error.statusCode
            : undefined;
        const headers =
          error && typeof error === "object" && "responseHeaders" in error
            ? (error.responseHeaders as Record<string, string>)
            : {};
        const retryAfter = Number(headers?.["retry-after"]);
        writer.write({
          type: "data-turnStatus",
          data: {
            status: status === 429 ? "provider-limit" : "connection-error",
            ...(Number.isFinite(retryAfter) ? { retryAfter } : {}),
          },
        });
        writer.write({
          type: "error",
          errorText:
            status === 429
              ? `The model provider has reached its limit. ${retryAfter ? `Retry in ${retryAfter} seconds.` : "Please retry later."}`
              : "The assistant could not connect. Your message is saved; please retry.",
        });
        console.error(
          "[AGENT] failed",
          JSON.stringify({
            status,
            limits: Object.fromEntries(
              Object.entries(headers ?? {}).filter(([name]) =>
                /ratelimit|retry-after/i.test(name),
              ),
            ),
            kind: error instanceof Error ? error.name : "unknown",
            message: error instanceof Error ? error.message.slice(0, 1000) : "",
          }),
        );
      } finally {
        options.onSettled?.();
      }
    },
  });
}
