import { createHash } from "node:crypto";
import {
  generateText,
  createUIMessageStream,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { products } from "@/data/products";
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
  authorizeCart,
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
          (e.output as { total: number }).total === 0),
    )
  )
    throw new Error("Check the exact catalog scope before claiming absence.");
  if (
    new Set(answer.productIds).size !== answer.productIds.length ||
    answer.productIds.some(
      (id) => !cited.some((e) => e.productIds.includes(id)),
    )
  )
    throw new Error("Products require cited evidence.");
  if (
    answer.view === "products" &&
    search &&
    (search.products.length !== answer.productIds.length ||
      search.products.some((p) => !answer.productIds.includes(p.id)))
  )
    throw new Error(
      "Present the complete search page, respecting the requested count.",
    );
  if (
    answer.claim &&
    answer.claim !== "none" &&
    !cited.some(
      (e) =>
        (e.output as SearchEvidence)?.outcome === answer.claim ||
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
  const counts = cited.flatMap((e) => {
    const record = e.output as Record<string, unknown>;
    return [
      "total",
      "scopeTotal",
      "totalMatches",
      "unseenMatches",
      "remainingMatches",
      "requestedCount",
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
    };
    return [
      ...e.productIds.flatMap((id) =>
        products.filter((p) => p.id === id).map((p) => p.price),
      ),
      record?.appliedCriteria?.maxPrice,
      record?.appliedCriteria?.targetPrice,
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
  if (/(?:USD|\$|PLN)\s*\d|\d+\s*(?:USD|PLN)\b/i.test(withoutReferences))
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
        state.requestedCount = limit ?? 5;
        state.shownIds = [
          ...new Set([...state.shownIds, ...(excludeIds ?? []), ...ids]),
        ];
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
  const key = turnKey(turn);
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
  const execution = executeAgent(model, catalog, turn, signal, options, key);
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
  const recent: ModelMessage[] =
    turn.history
      ?.slice(-4)
      .flatMap((m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
          ? [{ role: m.role, content: m.content.slice(-700) }]
          : [],
      ) ?? [];
  const stateForModel = Object.fromEntries(
    Object.entries({
      ...before,
      language: before.languageChosen ? before.language : undefined,
      shownIds: undefined,
      rejectedIds: before.rejectedIds,
      last: before.lastIds.flatMap((id) =>
        products
          .filter((p) => p.id === id)
          .map((p) => ({ id: p.id, name: p.name, price: p.price })),
      ),
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
          unitPrice: p.price,
        })),
    ) ?? [];
  const messages: ModelMessage[] = [
    ...recent,
    {
      role: "user",
      content: `Shopping state (preferences, not facts): ${JSON.stringify(stateForModel)}\nDevice cart snapshot: ${JSON.stringify(localCart)}\nCURRENT message: ${turn.text}`,
    },
  ];
  let correction = false;
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
    evidence,
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
    const { proposeCart: cartTool, ...readTools } = nativeTools;
    let tools: ToolSet = hasCartInstruction(turn.text)
      ? nativeTools
      : readTools;
    if (evidence.length && !correction) {
      tools = { presentAnswer: nativeTools.presentAnswer };
      // A multi-operation cart or detail request can use the remaining sequential budget.
      if (step < 3 && hasCartInstruction(turn.text))
        tools = { ...tools, proposeCart: cartTool };
    }
    if (step === 3) tools = { presentAnswer: nativeTools.presentAnswer };
    usage.calls++;
    let generated: Awaited<ReturnType<typeof generateText>>;
    try {
      generated = await generateText({
        model,
        system: agentInstructions,
        messages,
        tools,
        toolChoice: "required",
        temperature: 0.1,
        maxOutputTokens: 1024,
        maxRetries: 0,
        providerOptions: options.providerOptions,
        abortSignal: signal,
      });
    } catch (error) {
      const invalidCall =
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        error.statusCode === 400 &&
        "responseBody" in error &&
        typeof error.responseBody === "string" &&
        error.responseBody.includes("tool_use_failed");
      if (!invalidCall || correction || step === 3) throw error;
      correction = true;
      messages.push({
        role: "user",
        content:
          "The native tool call was invalid. Correct it once using exactly one registered tool and its schema. If you have results, finish with presentAnswer.",
      });
      continue;
    }
    usage.inputTokens += generated.usage.inputTokens ?? 0;
    usage.outputTokens += generated.usage.outputTokens ?? 0;
    usage.cachedInputTokens +=
      generated.usage.inputTokenDetails?.cacheReadTokens ?? 0;
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
        throw new Error("Invalid tool input. Correct the tool schema once.");
      if (name === "presentAnswer") {
        const answer = answerSchema.parse(call.input);
        if (search && !cart && !compared && answer.view !== "products")
          throw new Error(
            "Present the verified search page using view products, including an empty result.",
          );
        const text = validatePresentation(answer, evidence, search);
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
        signal.throwIfAborted();
        console.log("[AGENT] usage", JSON.stringify(usage));
        return result(answer, text, "complete");
      }
      switch (name) {
        case "searchProducts": {
          const proposed = transitionSchema.parse(call.input);
          if (!resolution) {
            const candidate = change
              ? structuredClone(after)
              : transitionState(before, proposed);
            const invalid = criteriaError(candidate.criteria);
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
              appliedCriteria: after.criteria,
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
          break;
        }
        case "getCatalogOverview": {
          const input = call.input as {
            criteria: Partial<ProductSearch>;
            useActive?: boolean;
          };
          const criteria = {
            ...(input.useActive ? after.criteria : {}),
            ...input.criteria,
          };
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
          output = product
            ? compactProduct(product, true)
            : { error: "Unknown product ID. Use a verified ID." };
          break;
        }
        case "compareProducts": {
          const { productIds } = call.input as { productIds: string[] };
          if (
            new Set(productIds).size !== productIds.length ||
            productIds.some((id) => !products.some((p) => p.id === id))
          )
            throw new Error("Use distinct canonical product IDs.");
          compared = comparison(productIds);
          after.comparisonIds = productIds;
          output = {
            ...compared,
            products: productIds.map((id) =>
              compactProduct(products.find((p) => p.id === id)!, true),
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
          const proposal = cartProposalSchema.parse(call.input);
          const error = authorizeCart(turn.text, after, proposal);
          if (error) {
            output = { error };
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
          ? (search?.products.map((p) => p.id) ?? [])
          : name === "getProductDetails" && !hasError
            ? [(call.input as { productId: string }).productId]
            : name === "compareProducts"
              ? (compared?.productIds ?? [])
              : name === "proposeCart" && !hasError
                ? (cart?.items?.map((p) => p.productId) ?? [])
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
      const rejected =
        name in nativeTools
          ? addEvidence(name, call.input, {
              error:
                error instanceof Error ? error.message : "Invalid tool input.",
            })
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
                  error:
                    error instanceof Error
                      ? error.message
                      : "Invalid tool input.",
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
            if (record.tool === "searchProducts" && result.search) {
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
