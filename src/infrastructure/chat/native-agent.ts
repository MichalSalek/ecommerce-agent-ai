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
import { productTypes } from "@/domain/catalog/taxonomy";
import { type CatalogService } from "@/application/catalog/catalog-service";
import { criteriaError, meetsFeature } from "@/domain/catalog/requirements";
import type { Product, ProductSearch } from "@/domain/catalog/product";
import { getStorePolicy } from "@/domain/catalog/policies";
import {
  nativeTools,
  agentInstructions,
  adviceInstructions,
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
  type ChatProgress,
  type ShoppingAction,
  shoppingActionSchema,
  transitionSchema,
  operationTurnStatus,
  type Operation,
  type Advice,
} from "@/application/chat/shopping-v3";
import type { ChatMessage } from "@/types/shop";
import type { CartAction } from "@/application/chat/cart-action";
import type { ChatRuntime } from "./runtime";
import {
  assistantTextError,
  catalogFactAbsenceError,
  resolveLanguage,
} from "@/application/chat/assistant-text";
import {
  comparisonSummary,
  detailsSummary,
  searchSummary,
  categoriesSummary,
  policySummary,
} from "@/application/chat/operation-summary";
import {
  pendingCartIntent,
  rememberCartIntent,
  forgetCartIntent,
  resolveCartOperand,
  type PendingCartIntent,
} from "@/application/chat/cart-intent";

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
  action?: ShoppingAction;
  adviceFor?: AgentResult;
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
  operation: Operation;
  advice: Advice;
}
interface Resolution {
  before: AgentState;
  after: AgentState;
  transition?: Transition;
  search?: SearchEvidence;
}
type AgentOptions = Partial<ChatRuntime> & {
  onProgress?: (progress: ChatProgress) => void;
};
function rejectionCode(reason: string) {
  if (/^[A-Z_]{1,80}$/.test(reason)) return reason;
  if (/count/i.test(reason)) return "UNVERIFIED_COUNT";
  if (/monetary|price|currency|currencies/i.test(reason))
    return "UNVERIFIED_PRICE";
  if (/measurement|dimension/i.test(reason)) return "UNVERIFIED_MEASUREMENT";
  if (/language/i.test(reason)) return "WRONG_LANGUAGE";
  if (/stock|available/i.test(reason)) return "UNVERIFIED_AVAILABILITY";
  if (/duration|policy/i.test(reason)) return "UNVERIFIED_POLICY";
  if (/reference|evidence/i.test(reason)) return "UNVERIFIED_REFERENCE";
  return "INVALID_MODEL_OUTPUT";
}
// Bounded, per-process retry resolution. The serialized checkpoint covers reload/server replacement.
const resolutions = new Map<
  string,
  { expires: number; resolution: Resolution }
>();
const completed = new Map<string, { expires: number; result: AgentResult }>();
const pending = new Map<string, Promise<AgentResult>>();
const operationResults = new Map<
  string,
  { expires: number; result: AgentResult }
>();
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
const foldComparison = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l");
function literalProductList(text: string): string[] {
  const current = foldComparison(text);
  const named = products
    .flatMap((product) => {
      const positions = [product.id, product.name].flatMap((label) => {
        const escaped = foldComparison(label).replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        );
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
  let remaining = current;
  for (const label of products
    .filter((product) => named.includes(product.id))
    .flatMap((product) => [product.id, product.name])
    .sort((a, b) => b.length - a.length)) {
    const escaped = foldComparison(label).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    remaining = remaining.replace(
      new RegExp(`(?:^|[^a-z0-9-])${escaped}(?=$|[^a-z0-9-])`, "g"),
      " ",
    );
  }
  const residue = remaining
    .replace(
      /\b(?:compare|porownaj|and|i|oraz|with|vs|versus|to|z|please|prosze|could|can|you|czy|mozesz|the|products?|items?|produkty|produktow)\b/g,
      "",
    )
    .replace(/[\s.,?!&:;'"/()-]+/g, "");
  return !residue && named.length >= 2 ? named : [];
}
function queryListGrounded(ids: string[], text: string): boolean {
  const current = foldComparison(text);
  if (
    /["'“”„]/.test(current) ||
    /\b(?:not|no|without|except|excluding|nie|bez|oprocz|poza)\b/.test(current)
  )
    return false;
  const used = new Set<number>();
  return ids.every((id) => {
    const product = products.find((p) => p.id === id)!;
    const type = productTypes[product.productType];
    return [
      product.id,
      product.name,
      ...(type ? [type.en, type.pl, ...type.aliases] : []),
    ].some((label) => {
      const escaped = foldComparison(label).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      const match = new RegExp(`\\b${escaped}`).exec(current);
      if (!match || used.has(match.index)) return false;
      used.add(match.index);
      return true;
    });
  });
}
function directComparisonRequest(text: string): boolean {
  return /^(?:(?:please|prosze|could you|can you|czy mozesz)\s+)*(?:compare|porownaj)\b/.test(
    foldComparison(text).trim(),
  );
}
function hasDistinctComparisonSubjects(text: string): boolean {
  const candidates = products.filter((product) =>
    queryListGrounded([product.id], text),
  );
  return candidates.some((product, index) =>
    candidates.slice(index + 1).some((other) =>
      queryListGrounded([product.id, other.id], text),
    ),
  );
}
function cleanCaches() {
  for (const map of [resolutions, completed, operationResults]) {
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
        turn.action,
      ]),
    )
    .digest("hex");
}
function numericText(text: string, evidence: Evidence[]) {
  return text
    .replace(/\[\[amount:([^:]+):([^\]]+)\]\]/g, (_match, id, field) => {
      const record = evidence.find((e) => e.id === id)?.output;
      const value =
        field === "totalEUR" &&
        record &&
        typeof record === "object" &&
        field in record
          ? (record as { totalEUR: number }).totalEUR
          : undefined;
      if (typeof value !== "number")
        throw new Error("Unverified monetary reference.");
      return `${value.toFixed(2)} EUR`;
    })
    .replace(
      /\[\[(difference|dimensions):([^\]]+)\]\]/g,
      (_match, kind, id) => {
        const record = evidence.find((e) => e.productIds.includes(id));
        const product = products.find((p) => p.id === id);
        if (!record || !product)
          throw new Error("Unverified measurement reference.");
        if (kind === "dimensions") return product.dimensions;
        const row = evidence
          .flatMap((e) => (e.output as Comparison)?.differencesCents ?? [])
          .find((row) => row.productId === id);
        if (!row) throw new Error("Unverified difference reference.");
        return `${(row.cents / 100).toFixed(2)} EUR`;
      },
    )
    .replace(/\[\[(price|name):([^\]]+)\]\](\s+EUR\b)?/g, (_match, kind, id, suffix) => {
      if (!evidence.some((e) => e.productIds.includes(id)))
        throw new Error("Unverified product reference.");
      const product = products.find((p) => p.id === id)!;
      return kind === "price"
        ? `${product.price.toFixed(2)} EUR`
        : product.name + (suffix ?? "");
    })
    .replace(/\[\[count:([^:]+):([^\]]+)\]\]/g, (_match, id, field) => {
      const record = evidence.find((e) => e.id === id)?.output;
      const value =
        field === "productCount" &&
        record &&
        typeof record === "object" &&
        "productIds" in record &&
        Array.isArray(record.productIds)
          ? record.productIds.length
          : record && typeof record === "object" && field in record
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
  const knownProducts = products.filter((product) =>
    cited.some((record) => record.productIds.includes(product.id)),
  );
  const missingFact = catalogFactAbsenceError(answer.text, {
    price: knownProducts.some((product) => Number.isFinite(product.price)),
    dimensions: knownProducts.some((product) => !!product.dimensions),
  });
  if (missingFact) throw new Error(missingFact);
  if (
    /\b(?:smaller|larger|bigger|taller|shorter|lighter|heavier|faster|slower|(?:less|more)\s+space)\b|mniejsz|większ|wyższ|niższ|lżejsz|cięższ|szybsz|wolniejsz|mniej.{0,20}miejsc|więcej.{0,20}miejsc/i.test(
      answer.text,
    )
  )
    throw new Error("UNVERIFIED_PHYSICAL_COMPARISON");
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
    /\b(?:no (?:products|items|stock|matches|assortment)|nothing (?:available|in stock)|we (?:do not|don't) (?:have|stock)|brak (?:produkt|asortyment|dopasowa)|nie (?:mamy|ma (?:produkt|takich)))/i.test(
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
    /we (?:do not|don't) (?:have|stock)|no assortment|nie mamy|brak asortymentu/i.test(
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
  if (
    /https?:|www\.|\]\(|<\w|\[\[(?!price:|name:|count:|difference:|dimensions:|amount:)/i.test(
      answer.text,
    )
  )
    throw new Error(
      "Use canonical cards and supported references, not URLs/markup.",
    );
  // Prices in advice are resolved by the application. Avoid unchecked numeric currency claims.
  const withoutReferences = answer.text.replace(/\[\[[^\]]+\]\]/g, "");
  if (cited.length) {
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
        Array.isArray(record?.productIds) ? [record.productIds.length] : [],
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
  const countWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    jeden: 1,
    dwa: 2,
    trzy: 3,
    cztery: 4,
    pięć: 5,
    sześć: 6,
    siedem: 7,
    osiem: 8,
    dziewięć: 9,
    dziesięć: 10,
  };
  for (const match of withoutReferences.matchAll(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|jeden|dwa|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć)\s+(?:products?|items?|matches|categories|produkt\w*|kategor\w*|dopasowa\w*)\b/gi,
  ))
    if (
      !counts.includes(countWords[match[1].toLowerCase()]) &&
      !(
        countWords[match[1].toLowerCase()] === 10 &&
        /(?:up to|at most)\s*$/i.test(withoutReferences.slice(0, match.index))
      )
    )
      throw new Error("Unverified catalog count.");
  const units = cited
    .filter((e) => e.tool === "deviceCart" || e.tool === "proposeCart")
    .flatMap((e) => {
      const value = e.output as {
        totalUnits?: number;
        products?: { quantity?: number }[];
        items?: { quantity?: number }[];
      };
      return [
        value.totalUnits,
        ...(value.products ?? value.items ?? []).map((row) => row.quantity),
      ].filter((n): n is number => typeof n === "number");
    });
  for (const match of withoutReferences.matchAll(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|jeden|dwa|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć)\s+(?:units?|pieces?|sztuk\w*)\b/gi,
  ))
    if (!units.includes(countWords[match[1].toLowerCase()] ?? Number(match[1])))
      throw new Error("Unverified cart unit count.");
  if (
    /\b\d+(?:[.,]\d+)?\s*(?:mm|cm|metres?|meters?|kg|grams?|kilograms?|litres?|liters?|ml|watts?|hours?)\b/i.test(
      withoutReferences,
    )
  )
    throw new Error("Unverified measurement. Use [[dimensions:ID]].");
  const policies = cited
    .filter((e) => e.tool === "getPolicy")
    .map((e) => (e.output as { policy: string }).policy);
  for (const match of withoutReferences.matchAll(
    /\b(\d+)\s+(?:business\s+)?(?:days?|dni|dniach)\b/gi,
  ))
    if (
      !policies.some((policy) =>
        (policy.match(/\d+/g) ?? ([] as string[])).includes(match[1]),
      )
    )
      throw new Error("Unverified policy duration.");
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
    if (
      !amounts.includes(amount) ||
      !cited.some((e) => e.tool === "getPolicy" || e.tool === "userPreferences")
    )
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
      state.language = resolveLanguage(
        message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(" "),
        state.language,
        !!message.metadata?.shoppingAction,
      );
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
/** Read-only reconstruction after reload. Cart effects are deliberately excluded. */
export function adviceResultFromMessages(
  messages: ChatMessage[],
  operationId: string,
): AgentResult | undefined {
  const message = messages.findLast(
    (m) =>
      m.role === "assistant" &&
      m.parts.some(
        (p) =>
          p.type === "data-operation" &&
          p.data.id === operationId &&
          p.data.status === "completed",
      ),
  );
  if (!message) return;
  const operation = message.parts.find((p) => p.type === "data-operation");
  const checkpoint = message.parts.find((p) => p.type === "data-shoppingState");
  if (
    operation?.type !== "data-operation" ||
    operation.data.status !== "completed" ||
    checkpoint?.type !== "data-shoppingState" ||
    operation.data.kind === "cart"
  )
    return;
  const searchPart = message.parts.find((p) => p.type === "data-products");
  const comparisonPart = message.parts.find(
    (p) => p.type === "data-comparison",
  );
  const categoryPart = message.parts.find((p) => p.type === "data-categories");
  const search =
    searchPart?.type === "data-products" ? searchPart.data : undefined;
  const compared =
    comparisonPart?.type === "data-comparison"
      ? comparisonPart.data
      : undefined;
  const categories =
    categoryPart?.type === "data-categories" ? categoryPart.data : undefined;
  const ids =
    compared?.productIds ??
    search?.products.map((p) => p.id) ??
    checkpoint.data.presentedIds;
  const language = checkpoint.data.after.language;
  const readResult = checkpoint.data.readResult;
  const text = compared
    ? comparisonSummary(compared, language)
    : operation.data.kind === "details" && ids[0]
      ? detailsSummary(ids[0], language)
      : search
        ? searchSummary(search, language)
        : categories
          ? categoriesSummary(categories, language)
          : readResult?.kind === "policy"
            ? policySummary(readResult.topic, language)
            : readResult?.kind === "overview"
              ? language === "pl"
                ? `Liczba produktów w wybranym zakresie: ${readResult.total}.`
                : `There are ${readResult.total} products in this part of the collection.`
              : undefined;
  if (!text) return;
  const output = {
    ...(readResult?.kind === "policy"
      ? { policy: getStorePolicy(readResult.topic) }
      : readResult?.kind === "overview"
        ? { total: readResult.total }
        : {}),
    ...(compared ?? search ?? {}),
    ...(categories ? { categories } : {}),
    products: ids
      .flatMap((id) => products.filter((p) => p.id === id))
      .map((p) => compactProduct(p, true)),
  };
  return {
    operation: operation.data,
    advice: { status: "not-requested" },
    status: { status: "complete" },
    answer: text,
    presentation: {
      text,
      language,
      productIds: ids,
      evidenceIds: ["restored"],
      view: compared
        ? "comparison"
        : categories
          ? "categories"
          : readResult
            ? "none"
            : "products",
    },
    checkpoint: checkpoint.data,
    search,
    comparison: compared,
    categories,
    evidence: [
      {
        id: "restored",
        tool: compared
          ? "compareProducts"
          : operation.data.kind === "details"
            ? "getProductDetails"
            : categories
              ? "getCategories"
              : readResult?.kind === "policy"
                ? "getPolicy"
                : readResult?.kind === "overview"
                  ? "getCatalogOverview"
                  : "searchProducts",
        input: readResult?.kind === "policy" ? { topic: readResult.topic } : {},
        output,
        productIds: ids,
      },
    ],
  };
}
export function needsModel(turn: Pick<AgentTurn, "text" | "action">): boolean {
  return turn.action
    ? turn.action.type === "advice"
    : !(
        /^(?:tak|yes|ok|okay|sure|confirm|potwierdzam|nie|no|cancel|anuluj|never mind)[.!\s]*$/i.test(
          turn.text.trim(),
        ) ||
        (hasCartInstruction(turn.text) &&
          !/^(?:please |prosze )?(?:find|show|search|compare|znajdz|pokaz|porownaj)\b/i.test(
            turn.text,
          ))
      );
}
function requestedCartQuantity(text: string): number | undefined {
  const normalized = text.toLowerCase();
  const match = normalized.match(
    /(?:add|dodaj|buy|take)\s+(\d+|two|dwie|dwa|one|jedna|jeden)\b/,
  );
  if (!match) return 1;
  const words: Record<string, number> = {
    two: 2,
    dwie: 2,
    dwa: 2,
    one: 1,
    jedna: 1,
    jeden: 1,
  };
  const n = words[match[1]] ?? Number(match[1]);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : undefined;
}
export async function runAgent(
  model: LanguageModel,
  catalog: CatalogService,
  turn: AgentTurn,
  signal: AbortSignal,
  options: AgentOptions = {},
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
    if (
      !(
        result.operation.status === "completed" &&
        signal.reason?.name === "TimeoutError"
      )
    )
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
  options: AgentOptions,
  key: string,
): Promise<AgentResult> {
  let resolution = resolutions.get(key)?.resolution;
  const before = resolution?.before ?? sanitizeState(turn.state);
  const pendingIntent = pendingCartIntent(
    turn.conversationId,
    before.pendingCartIntent,
  );
  const language = resolveLanguage(
    turn.text,
    before.language,
    !!turn.action,
    pendingIntent?.language,
  );
  let after = resolution?.after ?? structuredClone(before);
  after.language = language;
  after.languageChosen = true;
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
      language,
      shownIds: undefined,
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
  const progress = (phase: ChatProgress["phase"], retryAt?: number) => {
    signal.throwIfAborted();
    options.onProgress?.({
      phase,
      startedAt: Date.now(),
      ...(retryAt === undefined ? {} : { retryAt }),
    });
  };
  options.setWaitListener?.((milliseconds) =>
    progress("provider-wait", Date.now() + milliseconds),
  );
  options.setSwitchListener?.(() => progress("provider-switch"));
  let correction = false;
  let terminalOnly = false;
  let effectReferences: string[] = [];
  let committed: AgentResult | undefined;
  let expectedRead: "compareProducts" | "getProductDetails" | undefined;
  let productComparisonPending = false;
  let comparisonLookupRequired = false;
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
  const operationId = createHash("sha256")
    .update(
      JSON.stringify([
        turn.conversationId ?? "",
        turn.userMessageId,
        "shopping-operation",
      ]),
    )
    .digest("hex");
  const result = (
    presentation: PresentedAnswer,
    answer: string,
    status: TurnStatus["status"],
  ): AgentResult => {
    const kind: Operation["kind"] = cart
      ? "cart"
      : compared
        ? "comparison"
        : productComparisonPending
          ? "comparison"
          : search
            ? "search"
            : categories
              ? "categories"
              : evidence.some((e) => e.tool === "getProductDetails")
                ? "details"
                : evidence.some((e) => e.tool === "getPolicy")
                  ? "policy"
                  : evidence.some((e) => e.tool === "getCatalogOverview")
                    ? "overview"
                    : "conversation";
    const failure: TurnStatus = {
      status,
      usage,
      ...(status === "partial"
        ? {
            code: "MODEL_RESPONSE_INCOMPLETE",
            message:
              language === "pl"
                ? "Nie udało się dokończyć odpowiedzi. Możesz ponowić tę wiadomość."
                : "The response could not be completed. You can retry this message.",
          }
        : {}),
    };
    const operation: Operation =
      status !== "complete"
        ? { id: operationId, kind, status: "failed", error: failure }
        : cart
          ? {
              id: operationId,
              kind,
              status: "awaiting-device",
              cartOperationId: cart.operationId,
            }
          : { id: operationId, kind, status: "completed" };
    return {
      answer,
      presentation,
      search,
      categories,
      comparison: compared,
      cart,
      evidence: verifiedEvidence(),
      operation,
      advice: { status: "not-requested" },
      checkpoint: {
        userMessageId: turn.userMessageId,
        text: turn.text,
        before,
        after: { ...after, language },
        transition: change,
        presentedIds: presentation.productIds,
        ...(kind === "policy"
          ? {
              readResult: {
                kind: "policy" as const,
                topic: (
                  evidence.findLast((e) => e.tool === "getPolicy")!.input as {
                    topic: string;
                  }
                ).topic,
              },
            }
          : kind === "overview"
            ? {
                readResult: {
                  kind: "overview" as const,
                  total: (
                    evidence.findLast((e) => e.tool === "getCatalogOverview")!
                      .output as { total: number }
                  ).total,
                },
              }
            : {}),
      },
      status: operationTurnStatus(operation, usage),
    };
  };
  const finishCatalog = (): AgentResult | undefined => {
    if (committed) return committed;
    if (expectedRead === "compareProducts" && !compared) return;
    if (
      expectedRead === "getProductDetails" &&
      !evidence.some(
        (e) => e.tool === "getProductDetails" && e.productIds.length,
      )
    )
      return;
    const detail = evidence.findLast(
      (e) => e.tool === "getProductDetails" && e.productIds.length,
    );
    const policy = evidence.findLast((e) => e.tool === "getPolicy");
    const overview = evidence.findLast(
      (e) =>
        e.tool === "getCatalogOverview" &&
        e.output &&
        typeof e.output === "object" &&
        "total" in e.output,
    );
    if (
      !compared &&
      !search &&
      !categories &&
      !detail &&
      !policy &&
      !overview &&
      !cart
    )
      return;
    const ids =
      cart?.items?.map((item) => item.productId) ??
      compared?.productIds ??
      (detail ? detail.productIds : search?.products.map((p) => p.id)) ??
      [];
    if (ids.length) {
      after.lastIds = ids;
      after.selectedIds = ids.length === 1 ? ids : [];
    }
    if (compared || (search && !detail))
      after.resultIds =
        compared?.productIds ?? search!.products.map((p) => p.id);
    if (search)
      after.shownIds = [
        ...new Set([...after.shownIds, ...search.products.map((p) => p.id)]),
      ];
    const text = cart
      ? language === "pl"
        ? "Przekazuję wybrane produkty do zapisania na tym urządzeniu."
        : "Your selection is ready for this device to save."
      : compared
        ? comparisonSummary(compared, language)
        : detail
          ? detailsSummary(detail.productIds[0], language)
          : search
            ? searchSummary(search, language)
            : categories
              ? categoriesSummary(categories, language)
              : policy
                ? policySummary(
                    (policy.input as { topic: string }).topic,
                    language,
                  )
                : language === "pl"
                  ? `Liczba produktów w wybranym zakresie: ${(overview!.output as { total: number }).total}.`
                  : `There are ${(overview!.output as { total: number }).total} products in this part of the collection.`;
    committed = result(
      {
        text,
        language,
        evidenceIds: evidence.map((e) => e.id),
        productIds: ids,
        view: cart
          ? "none"
          : compared
            ? "comparison"
            : detail || search
              ? "products"
              : categories
                ? "categories"
                : "none",
      },
      text,
      "complete",
    );
    operationResults.set(committed.operation.id, {
      expires: Date.now() + 3_600_000,
      result: structuredClone(committed),
    });
    return committed;
  };
  const unavailableAdvice = (
    reason: string,
    failure?: TurnStatus,
  ): AgentResult => {
    const ready = finishCatalog()!;
    const field = /count/i.test(reason)
      ? "count"
      : /monetary|price|currency/i.test(reason)
        ? "price"
        : /measurement|physical/i.test(reason)
          ? "dimensions"
          : /language/i.test(reason)
            ? "language"
            : "text";
    console.warn(
      "[AGENT] advice rejected",
      JSON.stringify({
        operationId: ready.operation.id,
        ...options.currentRoute?.(),
        stage: "advice",
        rejection: rejectionCode(reason),
        field,
        finish: providerFinish,
        length: adviceLength,
        usage,
      }),
    );
    return {
      ...ready,
      advice: {
        status: "unavailable",
        reason: rejectionCode(reason),
        ...(failure?.retryAt ? { retryAt: failure.retryAt } : {}),
      },
      status: operationTurnStatus(ready.operation, usage),
    };
  };
  const question = (
    text: string,
    choices: string[] = [],
    kind: "selection" | "quantity" | "confirm" = "selection",
    quantity?: number,
    reuseIntent?: PendingCartIntent,
  ): AgentResult => {
    const actionType = turn.action?.type;
    const operationKind: Operation["kind"] =
      actionType === "advice"
        ? "conversation"
        : actionType &&
            [
              "search",
              "category",
              "categories",
              "more",
              "availability",
            ].includes(actionType)
          ? "search"
          : "cart";
    delete after.pendingCartIntent;
    if (!reuseIntent) forgetCartIntent(turn.conversationId);
    if (operationKind !== "cart") forgetCartIntent(turn.conversationId);
    else if (reuseIntent) after.pendingCartIntent = reuseIntent.nonce;
    else if (turn.conversationId && choices.length) {
      const intent = rememberCartIntent({
        conversationId: turn.conversationId,
        sourceMessageId: turn.userMessageId,
        sourceText: turn.text,
        kind,
        productIds: choices,
        quantity,
        language,
      });
      after.pendingCartIntent = intent.nonce;
    }
    const value = result(
      { text, language, view: "none", productIds: [], evidenceIds: [] },
      text,
      "complete",
    );
    value.operation = {
      id: operationId,
      kind: operationKind,
      status: "needs-input",
      question: text,
      choices,
      ...(operationKind === "cart"
        ? { input: kind, ...(quantity ? { quantity } : {}) }
        : {}),
    };
    value.status = operationTurnStatus(value.operation, usage);
    return value;
  };
  const createCart = (
    items: { productId: string; quantity: number }[],
    sourceMessageId = turn.userMessageId,
  ) => {
    cart = {
      operationId: createHash("sha256")
        .update(
          JSON.stringify([
            turn.conversationId ?? "",
            sourceMessageId,
            "addToCart",
          ]),
        )
        .digest("hex"),
      userMessageId: turn.userMessageId,
      ...items[0],
      items,
    };
    delete after.pendingCartIntent;
    forgetCartIntent(turn.conversationId);
    return finishCatalog()!;
  };
  let providerFinish: string | undefined;
  let adviceLength = 0;
  // Resolve a pending server-owned cart intention, never old model prose or a browser-supplied nonce alone.
  const confirmation =
    /^(?:tak|yes|ok|okay|sure|confirm|potwierdzam)[.!\s]*$/i.test(
      turn.text.trim(),
    );
  const refusal = /^(?:nie|no|cancel|anuluj|never mind)[.!\s]*$/i.test(
    turn.text.trim(),
  );
  if (refusal) {
    forgetCartIntent(turn.conversationId);
    delete after.pendingCartIntent;
    const text =
      language === "pl"
        ? "Anuluję oczekujący wybór. Możemy szukać dalej."
        : "The pending selection is cancelled. We can keep looking.";
    return result(
      { text, language, view: "none", productIds: [], evidenceIds: [] },
      text,
      "complete",
    );
  }
  if (confirmation) {
    if (pendingIntent && pendingIntent.kind !== "confirm") {
      return question(
        pendingIntent.kind === "quantity"
          ? language === "pl"
            ? "Podaj całkowitą liczbę sztuk od 1 do 99."
            : "Enter a whole number of units from 1 to 99."
          : language === "pl"
            ? "Który produkt dodać do koszyka? Wybierz konkretny produkt."
            : "Which product should I add to your cart? Choose a specific product.",
        pendingIntent.productIds,
        pendingIntent.kind,
        pendingIntent.quantity,
        pendingIntent,
      );
    }
    if (
      pendingIntent?.kind === "confirm" &&
      pendingIntent.productIds.length === 1 &&
      pendingIntent.quantity
    ) {
      const product = products.find(
        (p) => p.id === pendingIntent.productIds[0],
      );
      if (product?.inStock)
        return createCart(
          [{ productId: product.id, quantity: pendingIntent.quantity }],
          pendingIntent.sourceMessageId,
        );
    }
    return question(
      language === "pl"
        ? "Wybierz produkt i użyj przycisku dodania do koszyka. Nie mam aktualnej zgody na konkretny zapis."
        : "Choose a product and use its add button. There is no current confirmation for a specific cart addition.",
      pendingIntent?.productIds ?? before.selectedIds,
    );
  }
  if (pendingIntent && !turn.action && !hasCartInstruction(turn.text)) {
    const chosen = pendingIntent.productIds.filter(
      (id) =>
        turn.text.toLowerCase().includes(id) ||
        turn.text
          .toLowerCase()
          .includes(products.find((p) => p.id === id)!.name.toLowerCase()),
    );
    if (
      pendingIntent.kind === "selection" &&
      chosen.length === 1 &&
      pendingIntent.quantity
    ) {
      if (products.find((p) => p.id === chosen[0])?.inStock)
        return createCart(
          [{ productId: chosen[0], quantity: pendingIntent.quantity }],
          pendingIntent.sourceMessageId,
        );
    }
    if (
      pendingIntent.kind === "quantity" &&
      pendingIntent.productIds.length === 1 &&
      /^\d+$/.test(turn.text.trim())
    ) {
      const quantity = Number(turn.text.trim());
      if (
        quantity >= 1 &&
        quantity <= 99 &&
        products.find((p) => p.id === pendingIntent.productIds[0])?.inStock
      )
        return createCart(
          [{ productId: pendingIntent.productIds[0], quantity }],
          pendingIntent.sourceMessageId,
        );
      return question(
        language === "pl"
          ? "Podaj całkowitą liczbę sztuk od 1 do 99."
          : "Enter a whole number of units from 1 to 99.",
        pendingIntent.productIds,
        "quantity",
      );
    }
    forgetCartIntent(turn.conversationId);
    delete after.pendingCartIntent;
  }
  if (
    hasCartInstruction(turn.text) &&
    !turn.action &&
    !/^(?:please |prosze )?(?:find|show|search|compare|znajdz|pokaz|porownaj)\b/i.test(
      turn.text,
    )
  ) {
    forgetCartIntent(turn.conversationId);
    delete after.pendingCartIntent;
    const operand = resolveCartOperand(turn.text, before)!;
    if ("proposal" in operand) {
      if (
        operand.proposal.items.length === 1 &&
        /(?:confirm with me|ask me.*confirm|ask.*first|potwierdz.*najpierw|zapytaj.*potwierdz)/i.test(
          turn.text,
        )
      ) {
        const item = operand.proposal.items[0],
          name = products.find((p) => p.id === item.productId)!.name;
        return question(
          language === "pl"
            ? `Czy dodać ${item.quantity} × ${name} do koszyka?`
            : `Should I add ${item.quantity} × ${name} to your cart?`,
          [item.productId],
          "confirm",
          item.quantity,
        );
      }
      return createCart(operand.proposal.items);
    }
    const text =
      operand.error === "unavailable"
        ? language === "pl"
          ? "Wybrany produkt jest niedostępny. Wybierz inny produkt."
          : "The selected product is out of stock. Choose another product."
        : operand.error === "quantity"
          ? language === "pl"
            ? "Ile sztuk dodać? Podaj liczbę całkowitą od 1 do 99."
            : "How many units should I add? Enter a whole number from 1 to 99."
          : language === "pl"
            ? "Który produkt dodać do koszyka? Wybierz konkretny produkt."
            : "Which product should I add to your cart? Choose a specific product.";
    return question(
      text,
      operand.candidates,
      operand.error === "quantity" ? "quantity" : "selection",
      operand.error === "quantity"
        ? undefined
        : requestedCartQuantity(turn.text),
    );
  }
  let forcedCall:
    | { toolName: string; toolCallId: string; input: unknown }
    | undefined;
  if (turn.action) {
    const action = shoppingActionSchema.parse(turn.action);
    if (action.type === "advice") {
      const source =
        operationResults.get(action.operationId)?.result ?? turn.adviceFor;
      if (
        !source ||
        source.operation.id !== action.operationId ||
        source.operation.status !== "completed"
      )
        return question(
          language === "pl"
            ? "Wybierz ponownie wynik, który mam wyjaśnić."
            : "Choose the result you would like me to explain again.",
        );
      committed = structuredClone(source);
      committed.cart = undefined;
      committed.checkpoint = {
        ...committed.checkpoint,
        userMessageId: turn.userMessageId,
        text: turn.text,
        before,
        after: { ...before, language },
      };
      committed.advice = { status: "not-requested" };
      committed.answer = source.comparison
        ? comparisonSummary(source.comparison, language)
        : source.operation.kind === "details" &&
            source.presentation.productIds[0]
          ? detailsSummary(source.presentation.productIds[0], language)
          : source.search
            ? searchSummary(source.search, language)
            : source.categories
              ? categoriesSummary(source.categories, language)
              : source.answer;
      committed.presentation = {
        ...committed.presentation,
        language,
        text: committed.answer,
      };
      evidence.push(
        ...source.evidence.filter(
          (e) => !["deviceCart", "proposeCart"].includes(e.tool),
        ),
      );
      search = source.search;
      categories = source.categories;
      compared = source.comparison;
      terminalOnly = true;
      messages.push({
        role: "user",
        content: `Explain the already completed result only. Do not execute catalog or cart operations. Evidence: ${JSON.stringify(evidence)}.`,
      });
    } else if (action.type === "cart") {
      if (before.pendingCartIntent && !pendingIntent)
        return question(
          language === "pl"
            ? "Poprzednia prośba wygasła. Podaj ponownie liczbę sztuk wybranego produktu."
            : "The previous request expired. Enter the number of units for the selected product again.",
          action.productId ? [action.productId] : before.selectedIds,
          "quantity",
        );
      const source =
        pendingIntent &&
        action.productId &&
        pendingIntent.productIds.includes(action.productId)
          ? pendingIntent
          : undefined;
      const quantity = source?.quantity ?? action.quantity;
      const text = action.productId
        ? `Add ${quantity} ${products.find((p) => p.id === action.productId)!.name} to my cart`
        : `Add ${quantity} of the ${action.selection === "selected" ? "selected product" : action.selection} to my cart`;
      const operand = resolveCartOperand(text, before)!;
      if ("proposal" in operand)
        return createCart(operand.proposal.items, source?.sourceMessageId);
      return question(
        language === "pl"
          ? "Wybierz dostępny produkt, który mam dodać do koszyka."
          : "Choose an available product to add to your cart.",
        operand.candidates,
        "selection",
        quantity,
      );
    } else if (action.type === "compare")
      forcedCall = {
        toolName: "compareProducts",
        toolCallId: "ui-read",
        input: { productIds: action.productIds },
      };
    else if (action.type === "details")
      forcedCall = {
        toolName: "getProductDetails",
        toolCallId: "ui-read",
        input: { productId: action.productId },
      };
    else if (action.type === "categories")
      forcedCall = {
        toolName: "getCategories",
        toolCallId: "ui-read",
        input: {},
      };
    else if (action.type === "policy")
      forcedCall = {
        toolName: "getPolicy",
        toolCallId: "ui-read",
        input: { topic: action.topic },
      };
    else {
      if (
        (action.type === "more" || action.type === "availability") &&
        !before.scope &&
        !Object.keys(before.criteria).length &&
        !before.resultIds.length
      )
        return question(
          language === "pl"
            ? "Najpierw wybierz kategorię lub powiedz, jakiego produktu szukasz."
            : "First choose a category or tell me which products you need.",
        );
      let criteria: Transition["criteria"] = {},
        operation: Transition["operation"] = "new";
      let scope = "collection";
      if (action.type === "search") {
        if (action.preset === "coffee") {
          criteria = { functionalGroup: "coffee" };
          scope = "coffee";
        }
        if (action.preset === "seating") {
          criteria = { functionalGroup: "seating" };
          scope = "seating";
          operation = "refine";
        }
        if (action.preset === "garden" || action.preset === "outdoor") {
          criteria = {
            productKind: "furniture",
            useEnvironment: "outdoor",
            ...(action.preset === "garden" ? { maxPrice: 150 } : {}),
          };
          scope = "outdoor furniture";
          operation = action.preset === "outdoor" ? "change" : "new";
        }
        if (action.preset === "budget" || action.preset === "gift")
          criteria = {
            maxPrice: 25,
            ...(action.preset === "gift" ? { query: "gift" } : {}),
          };
      } else if (action.type === "category") {
        criteria = { category: action.name, categoryExplicit: true };
        scope = action.name;
      } else {
        operation = action.type === "more" ? "more" : "refine";
        scope = before.scope;
        criteria = action.type === "availability" ? { inStockOnly: true } : {};
      }
      forcedCall = {
        toolName: "searchProducts",
        toolCallId: "ui-read",
        input: {
          operation,
          language,
          scope,
          criteria,
          mode: "recommend",
          requestedCount:
            action.type === "search" ? action.requestedCount : undefined,
          continueWith: "presentAnswer",
        },
      };
    }
    if (action.type !== "advice") {
      forgetCartIntent(turn.conversationId);
      delete after.pendingCartIntent;
    }
  }
  for (let step = 0; step < (productComparisonPending ? 5 : 4); step++) {
    if (committed && signal.reason?.name === "TimeoutError")
      return unavailableAdvice("TIMEOUT");
    signal.throwIfAborted();
    const forceAnswer =
      (productComparisonPending
        ? usage.calls >= 3 && expectedRead !== "compareProducts"
        : step === 3) || terminalOnly;
    progress(forceAnswer ? "answer" : "understanding");
    const { proposeCart: _cartTool, ...readTools } = nativeTools;
    const tools: ToolSet | undefined = committed
      ? undefined
      : comparisonLookupRequired
        ? { searchProducts: nativeTools.searchProducts }
        : forceAnswer
          ? { presentAnswer: nativeTools.presentAnswer }
          : hasCartInstruction(turn.text)
            ? nativeTools
            : readTools;
    if (terminalOnly) {
      finishCatalog();
      if (committed && (cart || (turn.action && turn.action.type !== "advice")))
        return committed;
    }
    let call: {
      toolName: string;
      toolCallId: string;
      input: unknown;
      invalid?: boolean;
    };
    if (forcedCall) {
      call = forcedCall;
      forcedCall = undefined;
    } else {
      if (productComparisonPending && usage.calls >= 4) break;
      usage.calls++;
      let generated: Awaited<ReturnType<typeof generateText>>;
      try {
        generated = await generateText({
          model,
          system: `${committed ? adviceInstructions : agentInstructions}\nApplication-resolved response language: ${language}. Always use this language.`,
          messages: committed
            ? [
                {
                  role: "user",
                  content: JSON.stringify({
                    request: turn.text,
                    records: committed.presentation.productIds
                      .flatMap((id) => products.filter((p) => p.id === id))
                      .map((p) => ({
                        name: p.name,
                        material: p.material,
                        features: p.features,
                        limitations: p.limitations,
                      })),
                  }),
                },
              ]
            : messages,
          tools,
          toolChoice: committed
            ? undefined
            : forceAnswer
              ? { type: "tool", toolName: "presentAnswer" }
              : "required",
          temperature: 0.1,
          maxOutputTokens: committed ? 192 : 1024,
          maxRetries: 0,
          providerOptions: options.providerOptions,
          abortSignal: signal,
        });
      } catch (error) {
        accountUsage();
        if (
          (committed || finishCatalog()) &&
          (!signal.aborted || signal.reason?.name === "TimeoutError")
        )
          return unavailableAdvice(
            "PROVIDER_UNAVAILABLE",
            agentFailureStatus(error, signal),
          );
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
        if (
          correction ||
          (productComparisonPending ? usage.calls >= 4 : step === 3)
        )
          break;
        correction = true;
        messages.push({
          role: "user",
          content:
            "The native tool call was invalid. Correct it once using exactly one registered tool and its schema.",
        });
        continue;
      }
      accountUsage({
        inputTokens: generated.usage.inputTokens ?? 0,
        outputTokens: generated.usage.outputTokens ?? 0,
        cachedInputTokens:
          generated.usage.inputTokenDetails?.cacheReadTokens ?? 0,
      });
      providerFinish = generated.finishReason;
      adviceLength = generated.text.length;
      console.log(
        "[AGENT] inference",
        JSON.stringify({
          operationId: committed?.operation.id ?? operationId,
          ...options.currentRoute?.(),
          stage: committed ? "advice" : "interpretation",
          finish: providerFinish,
          length: adviceLength,
          input: generated.usage.inputTokens,
          output: generated.usage.outputTokens,
          cached: generated.usage.inputTokenDetails?.cacheReadTokens ?? 0,
        }),
      );
      if (committed && generated.toolCalls.length === 0) {
        call = {
          toolName: "presentAnswer",
          toolCallId: "advice",
          input: {
            text: generated.text,
            language,
            productIds: committed.presentation.productIds,
            evidenceIds: verifiedEvidence().map((e) => e.id),
            view: committed.presentation.view,
          },
        };
      } else if (generated.toolCalls.length === 1)
        call = generated.toolCalls[0];
      else {
        if (committed) return unavailableAdvice("INVALID_TOOL_COUNT");
        if (correction) break;
        correction = true;
        messages.push({
          role: "user",
          content:
            "Call exactly one valid native tool. Use presentAnswer to finish.",
        });
        continue;
      }
    }
    const name = call.toolName;
    if (
      !turn.action &&
      !hasCartInstruction(turn.text) &&
      directComparisonRequest(turn.text) &&
      ["searchProducts", "getProductDetails", "compareProducts"].includes(name)
    ) {
      productComparisonPending = true;
      expectedRead = "compareProducts";
    }
    if (
      name === "getCatalogOverview" &&
      !turn.action &&
      !hasCartInstruction(turn.text) &&
      directComparisonRequest(turn.text) &&
      hasDistinctComparisonSubjects(turn.text)
    ) {
      productComparisonPending = true;
      expectedRead = "compareProducts";
      comparisonLookupRequired = true;
    }
    // Optional advice can never execute a catalog or cart tool.
    if (committed && name !== "presentAnswer")
      return unavailableAdvice("UNEXPECTED_ADVICE_TOOL");
    console.log(
      "[AGENT] tool",
      JSON.stringify({ name, invalid: "invalid" in call && call.invalid }),
    );
    let output: unknown;
    try {
      if (
        providerFinish &&
        ["length", "content-filter", "error"].includes(providerFinish)
      )
        throw new Error("PROVIDER_FINISH");
      if ("invalid" in call && call.invalid)
        throw new Error(
          name === "searchProducts" || name === "getCatalogOverview"
            ? "Invalid input. Hard kind/type/category belong in explicitFilters with CURRENT source words. Functional needs use functionalGroup, not a guessed subtype list."
            : "Invalid tool input. Correct the tool schema once.",
        );
      if (name === "presentAnswer") {
        finishCatalog();
        const answer = answerSchema.parse(call.input);
        if (productComparisonPending && !compared) {
          if (/\?\s*$/.test(answer.text.trim())) {
            const incomplete = assistantTextError(
              answer.text,
              providerFinish,
              language,
            );
            if (answer.language !== language) throw new Error("WRONG_LANGUAGE");
            if (incomplete) throw new Error(incomplete);
            const questionAnswer = {
              ...answer,
              productIds: [],
              view: "none" as const,
            };
            const text = validatePresentation(
              questionAnswer,
              verifiedEvidence(),
              search,
            );
            const value = result(questionAnswer, text, "complete");
            value.operation = {
              id: operationId,
              kind: "comparison",
              status: "needs-input",
              question: text,
            };
            value.status = operationTurnStatus(value.operation, usage);
            return value;
          }
          throw new Error(
            "Read the requested product comparison before answering.",
          );
        }
        adviceLength = answer.text.length;
        const incomplete = assistantTextError(
          answer.text,
          providerFinish,
          language,
        );
        if (answer.language !== language) throw new Error("WRONG_LANGUAGE");
        if (incomplete) throw new Error(incomplete);
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
        const expandedError = assistantTextError(
          text,
          providerFinish,
          language,
        );
        if (expandedError) throw new Error(expandedError);
        if (committed)
          return {
            ...committed,
            advice: { status: "included", text },
            status: operationTurnStatus(committed.operation, usage),
          };
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
        if (answer.view === "comparison" && compared)
          after.resultIds = compared.productIds;
        else if (search && answer.view === "products")
          after.resultIds = search.products.map((product) => product.id);
        signal.throwIfAborted();
        console.log("[AGENT] usage", JSON.stringify(usage));
        return result(answer, text, "complete");
      }
      switch (name) {
        case "searchProducts": {
          const recoveringComparisonLookup = comparisonLookupRequired;
          comparisonLookupRequired = false;
          progress("catalog");
          const continuation = (call.input as { continueWith?: string })
            .continueWith;
          if (
            continuation === "compareProducts" ||
            continuation === "getProductDetails"
          )
            expectedRead = productComparisonPending
              ? "compareProducts"
              : continuation;
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
          if (recoveringComparisonLookup) {
            // This is reference resolution for CURRENT, independent of recommendation filters.
            proposed = {
              operation: "new",
              language,
              criteria: { query: proposed.criteria.query ?? "" },
            };
          }
          if (raw.mode === "lookup" || productComparisonPending) {
            const fresh = initialAgentState();
            const checked = resolveExplicitFacets(
              turn.text,
              fresh,
              { ...proposed, operation: "new" },
              recoveringComparisonLookup ? [] : raw.explicitFilters ?? [],
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
            if (
              productComparisonPending &&
              raw.mode !== "lookup" &&
              continuation !== "compareProducts" &&
              continuation !== "readMore"
            ) {
              const currentIds = literalProductList(turn.text);
              const queryIds = literalProductList(lookupCriteria.query);
              const ids = currentIds.length
                ? currentIds
                : queryListGrounded(queryIds, turn.text)
                  ? queryIds
                  : [];
              if (ids.length >= 2 && ids.length <= 10)
                forcedCall = {
                  toolName: "compareProducts",
                  toolCallId: "app-comparison",
                  input: { productIds: ids },
                };
            }
            break;
          }
          if (!resolution) {
            proposed.language = language;
            const verified = turn.action
              ? { change: proposed }
              : resolveExplicitFacets(
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
            after = { ...candidate, language, languageChosen: true };
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
          after = {
            ...structuredClone(resolution.after),
            language,
            languageChosen: true,
          };
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
          if (comparisonLookupRequired) {
            output = {
              error: "A product comparison needs product IDs, not inventory counts. Use searchProducts in lookup mode with an English query for the products named in CURRENT. Omit filters from the earlier topic, then compare the resolved products.",
              code: "COMPARISON_LOOKUP_REQUIRED",
            };
            break;
          }
          progress("catalog");
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
          terminalOnly = !!turn.action;
          progress("catalog");
          categories = categoryCards();
          output = { categories };
          break;
        case "getProductDetails": {
          progress("details");
          const input = call.input as { productId: string };
          const product = await catalog.details(input.productId);
          if (product) effectReferences = [product.id];
          if (
            product &&
            productComparisonPending &&
            (call.input as { continueWith?: string }).continueWith !==
              "readMore"
          ) {
            const ids = literalProductList(turn.text);
            if (ids.length >= 2 && ids.length <= 10)
              forcedCall = {
                toolName: "compareProducts",
                toolCallId: "app-comparison",
                input: { productIds: ids },
              };
          } else if (
            !productComparisonPending &&
            product &&
            (call.input as { continueWith?: string }).continueWith !==
              "readMore" &&
            !hasCartInstruction(turn.text)
          )
            terminalOnly = true;
          output = product
            ? compactProduct(product, true)
            : { error: "Unknown product ID. Use a verified ID." };
          break;
        }
        case "compareProducts": {
          progress("comparison");
          const refs = (call.input as { productIds: string[] }).productIds;
          let productIds = refs.map(
            (ref) =>
              products.find(
                (product) =>
                  product.id === ref ||
                  product.name.toLowerCase() === ref.toLowerCase(),
              )?.id ?? ref,
          );
          const named = literalProductList(turn.text);
          if (named.length >= 2) {
            if (named.length > 10)
              throw new Error("Choose up to ten products for one comparison.");
            // Exact canonical names from CURRENT own this read, including missing or substituted model references.
            productIds = named;
          }
          if (
            new Set(productIds).size !== productIds.length ||
            productIds.some((id) => !products.some((p) => p.id === id))
          )
            throw new Error("Use distinct canonical product IDs.");
          compared = comparison(productIds);
          if (
            (call.input as { continueWith?: string }).continueWith !==
              "readMore" &&
            !hasCartInstruction(turn.text)
          )
            terminalOnly = true;
          after.comparisonIds = productIds;
          effectReferences = productIds;
          output = {
            ...compared,
            products: productIds.map((id) =>
              compactProduct(products.find((p) => p.id === id)!, true),
            ),
          };
          break;
        }
        case "getPolicy":
          terminalOnly = !!turn.action;
          output = {
            policy: getStorePolicy((call.input as { topic: string }).topic),
          };
          break;
        case "proposeCart": {
          progress("cart");
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
            const choices = [
              ...new Set([
                ...after.lastIds,
                ...proposal.items.map((item) => item.productId),
              ]),
            ].filter((id) => products.some((p) => p.id === id && p.inStock));
            return question(
              language === "pl"
                ? "Wybierz dostępny produkt i podaj liczbę sztuk od 1 do 99."
                : "Choose an available product and specify a whole number of units from 1 to 99.",
              choices,
              /units/.test(error) ? "quantity" : "selection",
              /units/.test(error)
                ? undefined
                : requestedCartQuantity(turn.text),
            );
          }
          const cartOperationId = createHash("sha256")
            .update(
              JSON.stringify([
                turn.conversationId ?? "",
                turn.userMessageId,
                "addToCart",
              ]),
            )
            .digest("hex");
          cart = {
            operationId: cartOperationId,
            userMessageId: turn.userMessageId,
            ...proposal.items[0],
            items: proposal.items,
          };
          after.selectedIds = proposal.items.map((p) => p.productId);
          terminalOnly = true;
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
      if (!hasError && (terminalOnly || turn.action)) {
        finishCatalog();
        if (
          committed &&
          (cart || (turn.action && turn.action.type !== "advice"))
        )
          return committed;
      }
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
      if (committed || finishCatalog())
        return unavailableAdvice(
          error instanceof Error
            ? error.message.slice(0, 100)
            : "INVALID_ADVICE",
        );
      console.warn(
        "[AGENT] rejected tool",
        JSON.stringify({
          tool: name,
          rejection: rejectionCode(
            error instanceof Error ? error.message : "Invalid input",
          ),
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
  if (finishCatalog()) return unavailableAdvice("MODEL_RESPONSE_INCOMPLETE");
  cart = undefined;
  const detail = evidence.findLast(
    (record) => record.tool === "getProductDetails" && record.productIds.length,
  );
  const retainedIds =
    compared?.productIds ??
    search?.products.map((product) => product.id) ??
    detail?.productIds ??
    [];
  if (search) {
    after.lastIds = search.products.map((p) => p.id);
    after.shownIds = [...new Set([...after.shownIds, ...after.lastIds])];
  }
  if (retainedIds.length) after.lastIds = retainedIds;
  if (compared || search) after.resultIds = retainedIds;
  const answer: PresentedAnswer = {
    text:
      after.language === "pl"
        ? "Nie udało się dokończyć odpowiedzi. Zachowuję sprawdzone wyniki; możesz spróbować ponownie."
        : "I could not finish the response. The verified results are kept; you can retry.",
    language: after.language,
    evidenceIds: evidence.map((e) => e.id),
    productIds: retainedIds,
    view: compared
      ? "comparison"
      : search || detail
        ? "products"
        : categories
          ? "categories"
          : "none",
  };
  return result(answer, answer.text, "partial");
}

export function agentFailureStatus(
  error: unknown,
  signal: AbortSignal,
  now = Date.now(),
  language: "en" | "pl" = "en",
): TurnStatus {
  const record =
    error && typeof error === "object"
      ? (error as {
          statusCode?: number;
          responseHeaders?: Record<string, string>;
        })
      : {};
  const headers = record.responseHeaders ?? {};
  const seconds = Number(headers["retry-after"]);
  const retryAfter =
    Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
  const unavailable =
    headers["x-aurelle-error-code"] === "provider-unavailable";
  const timedOut =
    (signal.reason instanceof Error && signal.reason.name === "TimeoutError") ||
    (error instanceof Error && error.name === "TimeoutError");
  const metric = headers["x-aurelle-quota-metric"],
    window = headers["x-aurelle-quota-window"];
  const limit = Number(headers["x-aurelle-quota-limit"]),
    used = Number(headers["x-aurelle-quota-used"]),
    requested = Number(headers["x-aurelle-quota-requested"]);
  const providerLimit: TurnStatus["providerLimit"] =
    (metric === "tokens" || metric === "requests") &&
    (window === "minute" || window === "day") &&
    [limit, used, requested].every((n) => Number.isFinite(n) && n >= 0)
      ? { metric, window, limit, used, requested }
      : undefined;
  return {
    status:
      record.statusCode === 429 && !unavailable
        ? "provider-limit"
        : "connection-error",
    code:
      record.statusCode === 429 && !unavailable
        ? "PROVIDER_RATE_LIMIT"
        : timedOut
          ? "TIMEOUT"
          : unavailable || (record.statusCode && record.statusCode >= 500)
            ? "NETWORK_ERROR"
            : "APPLICATION_ERROR",
    message:
      language === "pl"
        ? record.statusCode === 429 && !unavailable
          ? "Usługa AI osiągnęła limit. Rozmowa i koszyk są zapisane. Ponów po zakończeniu odliczania."
          : timedOut
            ? "Odpowiedź trwała zbyt długo. Wiadomość i koszyk są zapisane. Możesz ponowić tę wiadomość."
            : "Usługa AI jest chwilowo niedostępna. Wiadomość i koszyk są zapisane. Spróbuj ponownie później."
        : record.statusCode === 429 && !unavailable
          ? providerLimit?.window === "day"
            ? "The AI service has reached its daily allowance. Your chat and cart are saved. Retry when the countdown ends."
            : "The AI service is temporarily at its rate limit. Your chat and cart are saved. Retry when the countdown ends."
          : timedOut
            ? "The response took too long. Your message, earlier results and cart are saved. You can retry this message."
            : "The AI service is temporarily unavailable. Your message and cart are saved. Please retry shortly.",
    ...(retryAfter === undefined
      ? {}
      : { retryAfter, retryAt: now + retryAfter * 1000 }),
    ...(providerLimit ? { providerLimit } : {}),
  };
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
        signal.throwIfAborted();
        writer.write({ type: "start", messageId: crypto.randomUUID() });
        if (options.contract === "shopping-v3")
          writer.write({
            type: "data-progress",
            transient: true,
            data: { phase: "understanding", startedAt: Date.now() },
          });
        const result = await runAgent(runtime.model, catalog, turn, signal, {
          ...runtime,
          onProgress: (progress) => {
            if (options.contract === "shopping-v3" && !signal.aborted)
              writer.write({
                type: "data-progress",
                transient: true,
                data: progress,
              });
          },
        });
        if (
          !(
            result.operation.status === "completed" &&
            signal.reason?.name === "TimeoutError"
          )
        )
          signal.throwIfAborted();
        if (
          result.status.status === "complete" ||
          options.contract !== "shopping-v3"
        )
          writer.write({ type: "text-start", id: "answer" });
        const manualCart =
          result.cart &&
          !(
            options.contract === "shopping-v3" ||
            (options.contract === "shopping-v2" &&
              result.cart.items?.length === 1)
          );
        if (
          result.status.status === "complete" ||
          options.contract !== "shopping-v3"
        )
          writer.write({
            type: "text-delta",
            id: "answer",
            delta:
              result.answer +
              (options.contract !== "shopping-v3" &&
              result.advice.status === "included"
                ? ` ${result.advice.text}`
                : "") +
              (manualCart
                ? result.checkpoint.after.language === "pl"
                  ? " Użyj przycisków Add to cart na kartach produktów, aby dodać je na tym urządzeniu."
                  : " Use Add to cart on the product cards to add these items on this device."
                : ""),
          });
        if (
          result.status.status === "complete" ||
          options.contract !== "shopping-v3"
        )
          writer.write({ type: "text-end", id: "answer" });
        if (options.contract === "shopping-v3") {
          writer.write({ type: "data-shoppingState", data: result.checkpoint });
          writer.write({ type: "data-operation", data: result.operation });
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
          writer.write({ type: "data-advice", data: result.advice });
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
        const failure = agentFailureStatus(
          error,
          signal,
          Date.now(),
          resolveLanguage(turn.text, turn.state.language, !!turn.action),
        );
        if (options.contract === "shopping-v3") {
          writer.write({
            type: "data-operation",
            data: {
              id: createHash("sha256")
                .update(
                  JSON.stringify([
                    turn.conversationId ?? "",
                    turn.userMessageId,
                    "shopping-operation",
                  ]),
                )
                .digest("hex"),
              kind:
                turn.action?.type === "advice"
                  ? "conversation"
                  : "conversation",
              status: "failed",
              error: failure,
            },
          });
          writer.write({
            type: "data-advice",
            data: { status: "not-requested" },
          });
        }
        writer.write({
          type: "data-turnStatus",
          data: failure,
        });
        if (options.contract !== "shopping-v3")
          writer.write({
            type: "error",
            errorText:
              failure.message ?? "The assistant is temporarily unavailable.",
          });
        writer.write({ type: "finish" });
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
            operationId: turn.userMessageId,
            stage: "operation",
            ...runtime.currentRoute?.(),
          }),
        );
      } finally {
        runtime.setWaitListener?.(undefined);
        runtime.setSwitchListener?.(undefined);
        options.onSettled?.();
      }
    },
  });
}
