import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "@huggingface/transformers";
import { products } from "../src/data/products";
import { expandFunctionalGroup } from "../src/domain/catalog/functional-groups";
import { CatalogService } from "../src/application/catalog/catalog-service";
import { restoreConversation } from "../src/application/chat/history";
import {
  initialAgentState,
  transitionState,
} from "../src/application/chat/shopping-v3";
import type {
  AgentState,
  Transition,
} from "../src/application/chat/shopping-v3";
import { LanceProductRepository } from "../src/infrastructure/catalog/lance-product-repository";
import {
  TransformerEmbedding,
  embeddingProfiles,
} from "../src/infrastructure/embeddings/transformer-embedding";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import {
  createNativeAgentStream,
  runAgent,
} from "../src/infrastructure/chat/native-agent";

// Only the language model is scripted. Every catalog search uses the actual
// MiniLM encoder and LanceDB. A missing local model fails rather than downloading.
env.allowRemoteModels = false;
type Call = { name: string; input: unknown };
type Step = Call | ((messages: any[]) => Call);
let sequence = 0;
const transition = (
  operation: Transition["operation"],
  criteria: Transition["criteria"] = {},
  extra: Partial<Transition> = {},
): Transition => ({ operation, language: "en", criteria, ...extra });
// Convert trusted fixture criteria into native facets without manufacturing user quotes.
const nativeTransition = (
  operation: Transition["operation"],
  criteria: Transition["criteria"] = {},
  extra: Partial<Transition> = {},
) => {
  const {
    productKind,
    productType,
    productTypes,
    excludeTypes,
    category,
    categoryExplicit: _categoryExplicit,
    ...modelCriteria
  } = criteria;
  const explicitFilters = [
    ...(productKind ? [{ facet: "kind", value: productKind }] : []),
    ...(productType ? [{ facet: "type", value: productType }] : []),
    ...(productTypes ?? []).map((value) => ({ facet: "type", value })),
    ...(excludeTypes ?? []).map((value) => ({ facet: "excludeType", value })),
    ...(category ? [{ facet: "category", value: category }] : []),
  ];
  return {
    ...transition(operation, modelCriteria, extra),
    explicitFilters,
    continueWith: "presentAnswer" as const,
  };
};
const call = (name: string, input: unknown): Call => ({
  name,
  input:
    name === "searchProducts" && input && typeof input === "object"
      ? { mode: "recommend", ...input }
      : input,
});
const adviceContext = (messages: any[]) => {
  const user = messages.find((m) => m.role === "user");
  if (!user || typeof user.content !== "string") return undefined;
  try {
    const context = JSON.parse(user.content);
    return Array.isArray(context.records) && typeof context.request === "string"
      ? context : undefined;
  } catch {
    return undefined;
  }
};
const lastTool = (messages: any[]) => {
  const message = [...messages].reverse().find((m) => m.role === "tool");
  if (!message) {
    const context = adviceContext(messages);
    assert.ok(context, "expected a tool result or compact advice context");
    return { products: context.records };
  }
  return JSON.parse(message.content);
};
const present = (
  messages: any[],
  overrides: Record<string, unknown> = {},
): Call => {
  const evidence = lastTool(messages);
  const context = adviceContext(messages);
  const productIds = context ? [] : (evidence.products ?? []).map((p: { id: string }) => p.id);
  return call("presentAnswer", {
    text: "Here are the verified results.",
    language: "en",
    evidenceIds: context ? [] : [evidence.evidenceId],
    productIds,
    view: "products",
    ...overrides,
  });
};
async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const events: T[] = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return events;
      events.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}
function scripted(steps: Step[]) {
  let calls = 0;
  const requests: any[] = [];
  const runtime = createGroqRuntime(
    {
      baseURL: "http://127.0.0.1:8787/v1",
      modelId: "test",
      apiKey: "fixture-only",
    },
    async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      const next = steps[calls++];
      assert.ok(next, `unexpected model request ${calls}`);
      const action = typeof next === "function" ? next(body.messages) : next;
      const plainAdvice = !body.tools?.length && action.name === "presentAnswer";
      return Response.json({
        id: `completion-${calls}`,
        model: "test",
        created: 0,
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: plainAdvice ? {
              role: "assistant",
              content: (action.input as { text: string }).text,
            } : {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `call-${calls}`,
                  type: "function",
                  function: {
                    name: action.name,
                    arguments: JSON.stringify(action.input),
                  },
                },
              ],
            },
            finish_reason: plainAdvice ? "stop" : "tool_calls",
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      });
    },
  );
  return { runtime, requests, count: () => calls };
}
const run = (
  catalog: CatalogService,
  steps: Step[],
  text = "show products",
  state = initialAgentState(),
  userMessageId = `dry-${++sequence}`,
  conversationId = `visitor-${sequence}`,
) => {
  const mock = scripted(steps);
  const turn = { text, state, userMessageId, conversationId };
  return {
    mock,
    turn,
    result: runAgent(
      mock.runtime.model,
      catalog,
      turn,
      new AbortController().signal,
      mock.runtime,
    ),
  };
};

test("native agent dry run with real MiniLM and LanceDB", async (t) => {
  const path = await mkdtemp(join(tmpdir(), "aurelle-agent-dry-"));
  const embedding = new TransformerEmbedding(".data/models", "minilm");
  const catalog = new CatalogService(
    new LanceProductRepository(
      path,
      embedding,
      products,
      embeddingProfiles.minilm.maxDistance,
    ),
  );
  try {
    await t.test("read clarifications carry their own operation kind and never create a cart intention", async () => {
      for (const action of [
        { type: "more" as const },
        { type: "availability" as const },
        { type: "advice" as const, operationId: "missing-result" },
      ]) {
        const model = scripted([]);
        const result = await runAgent(model.runtime.model, catalog, {
          text: "Continue", state: initialAgentState(), userMessageId: `read-question-${++sequence}`,
          conversationId: `visitor-${sequence}`, action,
        }, new AbortController().signal, model.runtime);
        assert.equal(model.count(), 0);
        assert.equal(result.operation.status, "needs-input");
        assert.equal(result.operation.kind, action.type === "advice" ? "conversation" : "search");
        assert.equal(result.checkpoint.after.pendingCartIntent, undefined);
        assert.equal(result.cart, undefined);
      }
    });
    await t.test("UI comparison and details use canonical data without inference", async () => {
      const ids = ["mugs", "carafe", "travel-mug", "coffee-grinder", "pour-over-dripper"];
      const state = { ...initialAgentState(), criteria: { functionalGroup: "coffee" as const, maxPrice: 150 }, resultIds: ids, lastIds: ids, shownIds: ids };
      const mock = scripted([]);
      const detail = await runAgent(mock.runtime.model, catalog, {
        text: "Tell me more about Ceramic mugs", userMessageId: `ui-detail-${++sequence}`, state,
        action: { type: "details", productId: ids[0] },
      }, new AbortController().signal, mock.runtime);
      assert.equal(mock.count(), 0);
      assert.equal(detail.operation.status, "completed");
      assert.equal(detail.advice.status, "not-requested");
      assert.match(detail.answer, /Ceramic mugs/);
      assert.deepEqual(detail.presentation.productIds, [ids[0]]);
      assert.deepEqual(detail.checkpoint.after.criteria, state.criteria);
      assert.deepEqual(detail.checkpoint.after.resultIds, ids);
      assert.deepEqual(detail.checkpoint.after.lastIds, [ids[0]]);
      const events = await collect(createNativeAgentStream(mock.runtime, catalog, {
        text: "Compare the five coffee products", userMessageId: `ui-compare-${++sequence}`, state: detail.checkpoint.after,
        action: { type: "compare", productIds: ids },
      }, new AbortController().signal, { contract: "shopping-v3" }));
      assert.equal(mock.count(), 0);
      const comparison = events.find(event => event.type === "data-comparison");
      assert.ok(comparison?.type === "data-comparison");
      assert.deepEqual(comparison.data.productIds, ids);
      const operation = events.find(event => event.type === "data-operation");
      assert.ok(operation?.type === "data-operation");
      assert.equal(operation.data.status, "completed");
      const advice = events.find(event => event.type === "data-advice");
      assert.ok(advice?.type === "data-advice");
      assert.equal(advice.data.status, "not-requested");
      const status = events.find(event => event.type === "data-turnStatus");
      assert.ok(status?.type === "data-turnStatus");
      assert.equal(status.data.status, "complete");
      const summary = events.filter(event => event.type === "text-delta").map(event => event.type === "text-delta" ? event.delta : "").join("");
      assert.match(summary, /5/);
      assert.match(summary, /(?:EUR|€)/);
      assert.ok(!events.some(event => event.type === "error" || event.type === "data-cartAction"));
      const checkpoint = events.find(event => event.type === "data-shoppingState");
      assert.ok(checkpoint?.type === "data-shoppingState");
      assert.deepEqual(checkpoint.data.after.resultIds, ids);
      assert.deepEqual(checkpoint.data.after.criteria, state.criteria);
    });
    await t.test(
      "invalid UI action IDs and comparison lengths fail before model inference",
      async () => {
        for (const action of [
          { type: "details", productId: "invented" },
          { type: "compare", productIds: ["mugs", "invented"] },
          { type: "compare", productIds: ["mugs"] },
          { type: "compare", productIds: ["mugs", "mugs"] },
          {
            type: "compare",
            productIds: products.slice(0, 11).map((p) => p.id),
          },
        ]) {
          const mock = scripted([]);
          await assert.rejects(
            runAgent(
              mock.runtime.model,
              catalog,
              {
                text: "Details",
                userMessageId: `invalid-ui-${++sequence}`,
                state: initialAgentState(),
                action: action as any,
              },
              new AbortController().signal,
              mock.runtime,
            ),
          );
          assert.equal(mock.count(), 0);
        }
      },
    );
    await t.test(
      "five coffee results survive one-product detail before comparing the original group",
      async () => {
        const first = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition(
                "new",
                { functionalGroup: "coffee" },
                { requestedCount: 5 },
              ),
            ),
            present,
          ],
          "Show five coffee products",
        ).result;
        assert.equal(first.status.status, "complete");
        const ids = first.search!.products.map((p) => p.id);
        assert.equal(ids.length, 5);
        assert.deepEqual(first.checkpoint.after.resultIds, ids);
        const detail = run(
          catalog,
          [
            call("getProductDetails", { productId: ids[0] }),
            (m) =>
              present(m, {
                evidenceIds: ["e1"],
                productIds: [ids[0]],
                view: "products",
              }),
          ],
          "Tell me more about the first one",
          first.checkpoint.after,
        );
        const inspected = await detail.result;
        assert.equal(inspected.status.status, "complete");
        assert.deepEqual(inspected.checkpoint.after.lastIds, [ids[0]]);
        assert.deepEqual(inspected.checkpoint.after.resultIds, ids);
        assert.equal(detail.mock.requests[1].tool_choice, undefined);
        assert.ok(!detail.mock.requests[1].tools?.length);
        assert.equal(detail.mock.requests[1].max_tokens, 384);
        const action = run(
          catalog,
          [
            call("compareProducts", { productIds: ids }),
            (m) => present(m, { view: "comparison" }),
          ],
          "Compare these five products",
          inspected.checkpoint.after,
        );
        const compared = await action.result;
        assert.equal(compared.status.status, "complete");
        assert.equal(action.mock.count(), 2);
        assert.deepEqual(compared.comparison?.productIds, ids);
        assert.deepEqual(compared.checkpoint.after.resultIds, ids);
        assert.equal(action.mock.requests[1].tool_choice, undefined);
        assert.ok(!action.mock.requests[1].tools?.length);
        assert.equal(action.mock.requests[1].max_tokens, 384);
        assert.deepEqual(
          compared.evidence
            .filter(
              (e) => !["userPreferences", "currentSelection"].includes(e.tool),
            )
            .map((e) => e.tool),
          ["compareProducts"],
        );
        const userMessage = action.mock.requests[0].messages.find(
          (m: any) => m.role === "user",
        ).content;
        const match = userMessage.match(
          /Shopping state \(preferences, not facts\): ([^\n]+)/,
        );
        assert.ok(match);
        const sent = JSON.parse(match[1]);
        assert.deepEqual(sent.resultIds, ids);
        assert.deepEqual(
          sent.last.products.map((p: { id: string }) => p.id),
          [ids[0]],
        );
      },
    );
    await t.test(
      "v3 quota failure sends progress and one typed status that survives history restore",
      async () => {
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => {
          release = resolve;
        });
        const runtime = createGroqRuntime(
          {
            baseURL: "http://127.0.0.1:8787/v1",
            modelId: "test",
            apiKey: "fixture-only",
          },
          async () => {
            await blocked;
            return Response.json(
              {
                error: {
                  message:
                    "tokens per day: Limit 200000, Used 199453, Requested 2390 private-content",
                },
              },
              { status: 429, headers: { "retry-after": "55" } },
            );
          },
        );
        const userMessageId = `quota-${++sequence}`;
        const stream = createNativeAgentStream(
          runtime,
          catalog,
          { text: "show products", state: initialAgentState(), userMessageId },
          new AbortController().signal,
          { contract: "shopping-v3" },
        );
        const reader = stream.getReader();
        const start = await reader.read();
        const progress = await reader.read();
        assert.equal(start.value?.type, "start");
        assert.equal(progress.value?.type, "data-progress");
        assert.ok(
          progress.value?.type === "data-progress" &&
            progress.value.transient === true,
        );
        const before = Date.now();
        release();
        const events = [];
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          events.push(next.value);
        }
        reader.releaseLock();
        const after = Date.now();
        const statuses = events.filter((e) => e.type === "data-turnStatus");
        assert.equal(statuses.length, 1);
        const failure = statuses[0];
        assert.ok(failure.type === "data-turnStatus");
        assert.equal(failure.data.status, "provider-limit");
        assert.equal(failure.data.code, "PROVIDER_RATE_LIMIT");
        assert.deepEqual(failure.data.providerLimit, {
          metric: "tokens",
          window: "day",
          limit: 200000,
          used: 199453,
          requested: 2390,
        });
        assert.ok(
          failure.data.retryAt !== undefined &&
            failure.data.retryAt >= before + 55_000 &&
            failure.data.retryAt <= after + 55_000,
        );
        assert.ok(
          !events.some((e) => e.type === "error" || e.type === "text-delta"),
        );
        assert.equal(events.at(-1)?.type, "finish");
        assert.doesNotMatch(JSON.stringify(events), /private-content/);
        const snapshot = restoreConversation(
          JSON.stringify({
            version: 1,
            id: "quota-history",
            draft: "",
            messages: [
              {
                id: userMessageId,
                role: "user",
                parts: [{ type: "text", text: "show products" }],
              },
              { id: "assistant-failed", role: "assistant", parts: [failure] },
            ],
          }),
        );
        assert.ok(snapshot);
        assert.equal(snapshot.messages[0].id, userMessageId);
        assert.deepEqual(snapshot.messages[1].parts, [failure]);
      },
    );
    await t.test(
      "current selection confirms the stock of the last five products without a catalog read",
      async () => {
        const ids = [
          "mugs",
          "carafe",
          "travel-mug",
          "coffee-grinder",
          "pour-over-dripper",
        ];
        const state = {
          ...initialAgentState(),
          language: "pl" as const,
          languageChosen: true,
          lastIds: ids,
        };
        const action = run(
          catalog,
          [
            call("presentAnswer", {
              text: "Wszystkie te produkty są dostępne.",
              language: "pl",
              evidenceIds: ["selection"],
              productIds: ids,
              view: "none",
            }),
          ],
          "Czy wszystkie te produkty są dostępne?",
          state,
        );
        const result = await action.result;
        assert.equal(result.status.status, "complete");
        assert.equal(action.mock.count(), 1);
        assert.equal(result.presentation.view, "none");
        assert.deepEqual(result.presentation.productIds, ids);
        assert.equal(result.search, undefined);
        assert.ok(
          result.evidence.some(
            (e) => e.id === "selection" && e.tool === "currentSelection",
          ),
        );
        const prompt = action.mock.requests[0].messages.find(
          (m: any) => m.role === "user",
        ).content;
        assert.match(prompt, /"evidenceId":"selection"/);
        for (const id of ids) assert.ok(prompt.includes(id));
      },
    );
    await t.test(
      "current selection cannot confirm all in stock when one product is unavailable",
      async () => {
        const ids = ["mugs", "compact-keyboard"];
        const action = run(
          catalog,
          [
            call("presentAnswer", {
              text: "All these products are in stock.",
              language: "en",
              evidenceIds: ["selection"],
              productIds: ids,
              view: "none",
            }),
            call("presentAnswer", {
              text: "Not all of these products are in stock.",
              language: "en",
              evidenceIds: ["selection"],
              productIds: ids,
              view: "none",
            }),
          ],
          "Are these all in stock?",
          { ...initialAgentState(), lastIds: ids },
        );
        const result = await action.result;
        assert.equal(result.status.status, "complete");
        assert.equal(action.mock.count(), 2);
        assert.equal(result.answer, "Not all of these products are in stock.");
        assert.equal(result.presentation.view, "none");
      },
    );
    await t.test(
      "current selection does not prove catalog-wide absence",
      async () => {
        const action = run(
          catalog,
          [
            call("presentAnswer", {
              text: "There is no assortment.",
              language: "en",
              evidenceIds: ["selection"],
              productIds: [],
              view: "none",
              claim: "no-assortment",
            }),
            call("presentAnswer", {
              text: "I can check the assortment.",
              language: "en",
              evidenceIds: [],
              productIds: [],
              view: "none",
            }),
          ],
          "Is there no assortment?",
          { ...initialAgentState(), lastIds: ["mugs"] },
        );
        const result = await action.result;
        assert.equal(result.status.status, "complete");
        assert.equal(action.mock.count(), 2);
        assert.equal(result.answer, "I can check the assortment.");
      },
    );
    await t.test(
      "a Polish in-stock refinement finishes after one successful recommendation read",
      async () => {
        const state = {
          ...initialAgentState(),
          language: "pl" as const,
          languageChosen: true,
          criteria: {
            productKind: "furniture",
            useEnvironment: "outdoor" as const,
            maxPrice: 150,
          },
          requestedCount: 5,
        };
        const action = run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition(
                "refine",
                { inStockOnly: true },
                { language: "pl" },
              ),
            ),
            (m) =>
              present(m, { language: "pl", text: "Oto dostępne propozycje." }),
          ],
          "Pokaż tylko dostępne",
          state,
        );
        const result = await action.result;
        assert.equal(result.status.status, "complete");
        assert.equal(action.mock.count(), 2);
        assert.equal(action.mock.requests[1].tool_choice, undefined);
        assert.ok(!action.mock.requests[1].tools?.length);
        assert.equal(action.mock.requests[1].max_tokens, 384);
        assert.equal(result.search?.appliedCriteria.inStockOnly, true);
        assert.equal(result.presentation.language, "pl");
      },
    );
    await t.test(
      "invalid optional advice leaves the search complete without regeneration",
      async () => {
        const search = call(
          "searchProducts",
          nativeTransition("new", {}, { requestedCount: 2 }),
        );
        const mock = scripted([search, search, search]);
        const events = await collect(
          createNativeAgentStream(
            mock.runtime,
            catalog,
            {
              text: "Show two products",
              state: initialAgentState(),
              userMessageId: `choice-${++sequence}`,
              conversationId: `visitor-${sequence}`,
            },
            new AbortController().signal,
            { contract: "shopping-v3" },
          ),
        );
        const status = events.find((event) => event.type === "data-turnStatus");
        assert.ok(status?.type === "data-turnStatus");
        assert.equal(status.data.status, "complete");
        const operation = events.find((event) => event.type === "data-operation");
        const advice = events.find((event) => event.type === "data-advice");
        assert.ok(operation?.type === "data-operation" && operation.data.status === "completed");
        assert.ok(advice?.type === "data-advice" && advice.data.status === "unavailable");
        assert.ok(!events.some((event) => event.type === "error"));
        assert.equal(mock.count(), 2);
      },
    );
    await t.test("provider 429 during optional advice keeps a completed detail", async () => {
      let calls = 0;
      const runtime = createGroqRuntime({ baseURL: "http://127.0.0.1:8787/v1", modelId: "test", apiKey: "fixture-only" }, async () => {
        calls++;
        if (calls === 2) return Response.json({ error: { message: "tokens per minute: Limit 1000, Used 900, Requested 200" } }, { status: 429, headers: { "retry-after": "8" } });
        return Response.json({
          id: "detail", model: "test", created: 0, object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "getProductDetails", arguments: JSON.stringify({ productId: "mugs" }) } }] }, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        });
      });
      const events = await collect(createNativeAgentStream(runtime, catalog, { text: "Tell me about the mugs", state: initialAgentState(), userMessageId: `detail-quota-${++sequence}` }, new AbortController().signal, { contract: "shopping-v3" }));
      assert.equal(calls, 2);
      const operation = events.find(event => event.type === "data-operation");
      const advice = events.find(event => event.type === "data-advice");
      const status = events.find(event => event.type === "data-turnStatus");
      assert.ok(operation?.type === "data-operation" && operation.data.status === "completed");
      assert.ok(advice?.type === "data-advice" && advice.data.status === "unavailable");
      assert.ok(status?.type === "data-turnStatus" && status.data.status === "complete");
      assert.ok(!events.some(event => event.type === "error"));
      assert.match(events.filter(event => event.type === "text-delta").map(event => event.type === "text-delta" ? event.delta : "").join(""), /Ceramic mugs/);
    });
    await t.test("truncated optional advice is discarded after one attempt", async () => {
      let calls = 0;
      const requests: any[] = [];
      const runtime = createGroqRuntime({ baseURL: "http://127.0.0.1:8787/v1", modelId: "test", apiKey: "fixture-only" }, async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        requests.push(request);
        calls++;
        const search = call("searchProducts", nativeTransition("new", {}, { requestedCount: 2 }));
        return Response.json({
          id: `truncated-${calls}`, model: "test", created: 0, object: "chat.completion",
          choices: [{ index: 0, message: calls === 1
            ? { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: search.name, arguments: JSON.stringify(search.input) } }] }
            : { role: "assistant", content: "The best choice is" },
            finish_reason: calls === 1 ? "tool_calls" : "length" }],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        });
      });
      const result = await runAgent(runtime.model, catalog, { text: "Show two products", state: initialAgentState(), userMessageId: `truncated-${++sequence}` }, new AbortController().signal, runtime);
      assert.equal(calls, 2);
      assert.equal(requests[1].tool_choice, undefined);
        assert.ok(!requests[1].tools?.length);
      assert.equal(requests[1].max_tokens, 384);
      assert.equal(result.operation.status, "completed");
      assert.equal(result.status.status, "complete");
      assert.equal(result.advice.status, "unavailable");
      assert.equal(result.search?.products.length, 2);
      assert.doesNotMatch(result.answer, /best choice is/i);
    });
    await t.test("foreign currency cannot become catalog advice", async () => {
      const action = run(
        catalog,
        [
          call("getProductDetails", { productId: "mugs" }),
          call("presentAnswer", {
            text: "The mugs cost £18.",
            language: "en",
            evidenceIds: ["e1"],
            productIds: ["mugs"],
            view: "products",
          }),
          call("presentAnswer", {
            text: "The mugs cost [[price:mugs]].",
            language: "en",
            evidenceIds: ["e1"],
            productIds: ["mugs"],
            view: "products",
          }),
        ],
        "Tell me about the mugs.",
      );
      const result = await action.result;
      assert.equal(result.status.status, "complete");
      assert.equal(action.mock.count(), 2);
      assert.equal(result.operation.status, "completed");
      assert.equal(result.advice.status, "unavailable");
      assert.match(result.answer, /Ceramic mugs/);
      assert.doesNotMatch(result.answer, /£/);
    });
    await t.test(
      "stored budget can be recalled from preferences evidence without a read",
      async () => {
        const action = run(
          catalog,
          [
            call("presentAnswer", {
              text: "Your budget is 150 EUR.",
              language: "en",
              evidenceIds: ["preferences"],
              productIds: [],
              view: "none",
            }),
          ],
          "What was my budget?",
          { ...initialAgentState(), criteria: { maxPrice: 150 } },
        );
        const result = await action.result;
        assert.equal(result.status.status, "complete");
        assert.equal(action.mock.count(), 1);
        assert.equal(result.answer, "Your budget is 150 EUR.");
        assert.ok(
          result.evidence.some(
            (e) => e.id === "preferences" && e.tool === "userPreferences",
          ),
        );
        assert.match(
          action.mock.requests[0].messages.find((m: any) => m.role === "user")
            .content,
          /"evidenceId":"preferences"/,
        );
      },
    );
    await t.test("Polish explicit comparison overrides a recommendation and preserves the active search", async () => {
      const state = {
        ...initialAgentState(), language: "pl" as const,
        criteria: { productKind: "furniture", useEnvironment: "outdoor" as const, maxPrice: 150 },
        requestedCount: 4, shownIds: ["garden-bench", "folding-garden-chair"],
        resultIds: ["garden-bench", "folding-garden-chair"],
        lastIds: ["garden-bench", "folding-garden-chair"],
      };
      const action = run(catalog, [
        call("searchProducts", { ...nativeTransition("new", { query: "mugs and carafe" }), mode: "recommend", continueWith: "presentAnswer" }),
        (m) => present(m, { text: "Oba produkty mają różne zastosowania.", language: "pl" }),
      ], "Porównaj kubki i karafkę", state);
      const result = await action.result;
      assert.equal(action.mock.count(), 2);
      assert.equal(result.operation.kind, "comparison");
      assert.equal(result.operation.status, "completed");
      assert.deepEqual(result.comparison?.productIds, ["mugs", "carafe"]);
      assert.deepEqual(result.comparison?.cheapestIds, ["carafe"]);
      assert.ok(!result.comparison?.productIds.includes("pour-over-dripper"));
      assert.deepEqual(result.checkpoint.after.criteria, state.criteria);
      assert.deepEqual(result.checkpoint.after.shownIds, state.shownIds);
      assert.equal(result.checkpoint.after.requestedCount, state.requestedCount);
      assert.equal(result.checkpoint.transition, undefined);
      assert.deepEqual(result.checkpoint.after.comparisonIds, ["mugs", "carafe"]);
      assert.deepEqual(result.evidence.filter(e => ["searchProducts", "compareProducts"].includes(e.tool)).map(e => e.tool), ["searchProducts", "compareProducts"]);
      const cart = run(catalog, [], "Dodaj 2 sztuki tańszego do koszyka", result.checkpoint.after);
      const added = await cart.result;
      assert.equal(cart.mock.count(), 0);
      assert.equal(added.operation.status, "awaiting-device");
      assert.deepEqual(added.cart?.items, [{ productId: "carafe", quantity: 2 }]);
    });
    await t.test("translated lookup cannot reuse one noun or an excluded product as comparison consent", async () => {
      for (const [text, query, language] of [
        ["Porównaj kubki i karafkę", "travel-mug and mugs", "pl"],
        ["Compare mugs but not carafe", "mugs and carafe", "en"],
      ] as const) {
        const action = run(catalog, [
          call("searchProducts", { ...nativeTransition("new", { query }, { language }), mode: "recommend", continueWith: "presentAnswer" }),
          call("presentAnswer", { text: language === "pl" ? "Które produkty porównać?" : "Which products should I compare?", language, evidenceIds: [], productIds: [], view: "none" }),
        ], text);
        const result = await action.result;
        assert.equal(result.operation.status, "needs-input");
        assert.equal(result.operation.kind, "comparison");
        assert.equal(result.comparison, undefined);
        assert.ok(!result.evidence.some(e => e.tool === "compareProducts"));
      }
    });
    await t.test("a detail read can complete an explicit canonical comparison", async () => {
      const action = run(catalog, [
        call("getProductDetails", { productId: "mugs" }),
        (m) => present(m, { text: "These products serve different purposes." }),
      ], "Compare mugs and carafe");
      const result = await action.result;
      assert.equal(action.mock.count(), 2);
      assert.equal(result.operation.status, "completed");
      assert.equal(result.operation.kind, "comparison");
      assert.deepEqual(result.comparison?.productIds, ["mugs", "carafe"]);
    });
    await t.test("unresolved comparison asks a question without creating a cart intention", async () => {
      const action = run(catalog, [
        call("searchProducts", { ...nativeTransition("new", { query: "mugs" }), mode: "lookup" }),
        call("presentAnswer", { text: "Which products should I compare?", language: "en", evidenceIds: [], productIds: [], view: "none" }),
      ], "Compare the options");
      const result = await action.result;
      assert.equal(result.operation.kind, "comparison");
      assert.equal(result.operation.status, "needs-input");
      assert.equal(result.checkpoint.after.pendingCartIntent, undefined);
      assert.equal(result.cart, undefined);
      assert.equal(result.comparison, undefined);
    });
    await t.test("synthetic comparison keeps the four-inference ceiling", async () => {
      const action = run(catalog, [
        call("searchProducts", { ...nativeTransition("new", { query: "mugs" }), mode: "lookup" }),
        call("searchProducts", { ...nativeTransition("new", { query: "carafe" }), mode: "lookup" }),
        call("getProductDetails", { productId: "mugs", continueWith: "readMore" }),
        call("searchProducts", { ...nativeTransition("new", { query: "mugs and carafe" }), mode: "recommend", continueWith: "presentAnswer" }),
      ], "Compare mugs and carafe");
      const result = await action.result;
      assert.equal(action.mock.count(), 4);
      assert.equal(result.operation.kind, "comparison");
      assert.equal(result.operation.status, "completed");
      assert.equal(result.advice.status, "unavailable");
      assert.deepEqual(result.comparison?.productIds, ["mugs", "carafe"]);
      assert.equal(result.evidence.filter((entry) => entry.tool === "searchProducts").length, 3);
      assert.equal(result.evidence.filter((entry) => entry.tool === "getProductDetails").length, 1);
    });
    await t.test("unfinished product comparison is reported as failed", async () => {
      const answer = call("presentAnswer", { text: "Here are the results.", language: "en", evidenceIds: [], productIds: [], view: "none" });
      const action = run(catalog, [
        call("searchProducts", { ...nativeTransition("new", { query: "mugs" }), mode: "lookup" }),
        answer,
        answer,
      ], "Compare the options");
      const result = await action.result;
      assert.equal(result.operation.kind, "comparison");
      assert.equal(result.operation.status, "failed");
      assert.equal(result.comparison, undefined);
      assert.equal(result.cart, undefined);
    });
    await t.test("policy comparison does not force a product comparison", async () => {
      const action = run(catalog, [
        call("getPolicy", { topic: "delivery" }),
        call("presentAnswer", { text: "Delivery details are available.", language: "en", evidenceIds: ["e1"], productIds: [], view: "none" }),
      ], "Compare delivery policies");
      const result = await action.result;
      assert.equal(result.comparison, undefined);
      assert.ok(!result.evidence.some(e => e.tool === "compareProducts"));
    });
    await t.test(
      "direct comparison normalizes extra lookup matches and preserves request order",
      async () => {
        for (const [text, expected] of [
          ["Compare mugs and carafe", ["mugs", "carafe"]],
          ["Compare carafe and mugs", ["carafe", "mugs"]],
        ] as const) {
          const action = run(
            catalog,
            [
              call("searchProducts", {
                ...nativeTransition("new", { productTypes: ["mug", "carafe"] }),
                mode: "lookup",
              }),
              call("compareProducts", {
                productIds: ["mugs", "carafe", "travel-mug"],
              }),
              (messages) =>
                present(messages, {
                  view: "comparison",
                  evidenceIds: ["e1", "e2"],
                }),
            ],
            text,
          );
          const result = await action.result;
          assert.equal(result.status.status, "complete");
          assert.equal(action.mock.count(), 3);
          assert.ok(result.evidence[0].productIds.includes("travel-mug"));
          assert.ok(result.evidence[0].productIds.includes("mugs"));
          assert.ok(result.evidence[0].productIds.includes("carafe"));
          assert.deepEqual(result.comparison?.productIds, expected);
          assert.deepEqual(result.presentation.productIds, expected);
          assert.deepEqual(result.checkpoint.after.comparisonIds, expected);
        }
      },
    );
    await t.test(
      "direct canonical comparison resolves missing or substituted model references without another inference",
      async () => {
        for (const productIds of [
          ["mugs", "travel-mug"],
          ["carafe", "travel-mug"],
          ["garden-bench", "patio-sofa"],
          ["unknown-model-reference", "travel-mug"],
          ["carafe", "carafe"],
        ]) {
          const action = run(
            catalog,
            [
              call("searchProducts", {
                ...nativeTransition("new", { productTypes: ["mug", "carafe"] }),
                mode: "lookup",
              }),
              call("compareProducts", { productIds }),
              (messages) =>
                present(messages, {
                  view: "comparison",
                  evidenceIds: ["e1", "e2"],
                }),
            ],
            "Compare mugs and carafe",
          );
          const result = await action.result;
          assert.equal(result.status.status, "complete");
          assert.equal(action.mock.count(), 3);
          assert.ok(
            !result.evidence.some(
              (e) =>
                e.tool === "compareProducts" &&
                typeof (e.output as any)?.error === "string",
            ),
          );
          assert.deepEqual(result.comparison?.productIds, ["mugs", "carafe"]);
        }
      },
    );
    await t.test(
      "an explicit canonical list cannot expand comparison past ten products",
      async () => {
        const action = run(
          catalog,
          [
            call("compareProducts", { productIds: ["mugs", "carafe"] }),
            (messages) =>
              present(messages, {
                text: "Which products would you like to compare?",
                view: "none",
                productIds: [],
              }),
          ],
          `Compare ${products
            .slice(0, 11)
            .map((product) => product.id)
            .join(" and ")}`,
        );
        const result = await action.result;
        assert.equal(result.status.status, "complete");
        assert.equal(result.operation.kind, "comparison");
        assert.equal(result.operation.status, "needs-input");
        assert.equal(result.comparison, undefined);
        assert.equal(result.presentation.view, "none");
      },
    );
    await t.test(
      "non-list mentions do not override an explicit comparison later in the request",
      async () => {
        const result = await run(
          catalog,
          [
            call("compareProducts", {
              productIds: ["garden-bench", "patio-sofa"],
            }),
            (messages) => present(messages, { view: "comparison" }),
          ],
          "I have mugs and carafe at home; compare garden-bench with patio-sofa",
        ).result;
        assert.equal(result.status.status, "complete");
        assert.deepEqual(result.comparison?.productIds, [
          "garden-bench",
          "patio-sofa",
        ]);
      },
    );
    await t.test(
      "independent product lookups compare without replacing the active garden search",
      async () => {
        const state = {
          ...initialAgentState(),
          criteria: {
            productKind: "furniture",
            useEnvironment: "outdoor" as const,
            maxPrice: 150,
          },
          requestedCount: 4,
          shownIds: ["garden-bench", "folding-garden-chair"],
          lastIds: ["garden-bench", "folding-garden-chair"],
        };
        const action = run(
          catalog,
          [
            call("searchProducts", {
              ...nativeTransition("new", { productType: "mug" }),
              mode: "lookup",
            }),
            call("searchProducts", {
              ...nativeTransition("new", { productType: "carafe" }),
              mode: "lookup",
            }),
            call("compareProducts", { productIds: ["mugs", "carafe"] }),
            (m) =>
              present(m, {
                view: "comparison",
                evidenceIds: ["e1", "e2", "e3"],
              }),
          ],
          "Compare the mugs and carafe",
          state,
        );
        const result = await action.result;
        assert.equal(result.status.status, "complete");
        assert.equal(action.mock.count(), 4);
        assert.equal(action.mock.requests[1].tool_choice, "required");
        assert.equal(action.mock.requests[2].tool_choice, "required");
        assert.equal(action.mock.requests[3].tool_choice, undefined);
        assert.ok(!action.mock.requests[3].tools?.length);
        assert.equal(action.mock.requests[3].max_tokens, 384);
        const adviceMessages = action.mock.requests[3].messages;
        assert.ok(adviceMessages.every((message: any) => message.role !== "tool"));
        const context = adviceContext(adviceMessages);
        assert.ok(context);
        assert.deepEqual(Object.keys(context).sort(), ["records", "request"]);
        assert.deepEqual(context.records.map((record: any) => record.name),
          ["mugs", "carafe"].map((id) => products.find((p) => p.id === id)?.name));
        for (const record of context.records) {
          assert.ok(Object.keys(record).every((key) => ["name", "material", "features", "limitations", "decisionReasons"].includes(key)));
          assert.ok(!("id" in record));
          assert.ok(!("priceReference" in record));
          assert.ok(!("dimensionsReference" in record));
          assert.ok(!("differenceReference" in record));
        }
        assert.deepEqual(
          result.evidence
            .filter(
              (e) =>
                e.tool !== "userPreferences" && e.tool !== "currentSelection",
            )
            .map((e) => e.tool),
          ["searchProducts", "searchProducts", "compareProducts"],
        );
        assert.ok(result.evidence[0].productIds.includes("mugs"));
        assert.ok(result.evidence[1].productIds.includes("carafe"));
        assert.deepEqual(result.comparison?.productIds, ["mugs", "carafe"]);
        assert.deepEqual(result.presentation.productIds, ["mugs", "carafe"]);
        assert.deepEqual(result.checkpoint.after.criteria, state.criteria);
        assert.deepEqual(result.checkpoint.after.shownIds, state.shownIds);
        assert.equal(
          result.checkpoint.after.requestedCount,
          state.requestedCount,
        );
        assert.deepEqual(result.checkpoint.after.comparisonIds, [
          "mugs",
          "carafe",
        ]);
        assert.deepEqual(result.checkpoint.after.lastIds, ["mugs", "carafe"]);
        assert.equal(result.checkpoint.transition, undefined);
        for (const contract of [undefined, "shopping-v2"] as const) {
          const events = await collect(
            createNativeAgentStream(
              action.mock.runtime,
              catalog,
              action.turn,
              new AbortController().signal,
              { contract },
            ),
          );
          const outputs = events.filter(
            (event) => event.type === "tool-output-available",
          );
          assert.ok(
            outputs.some(
              (event) =>
                Array.isArray(event.output) &&
                event.output.some(
                  (product: { id: string }) => product.id === "mugs",
                ),
            ),
          );
          assert.ok(
            outputs.some(
              (event) =>
                Array.isArray(event.output) &&
                event.output.some(
                  (product: { id: string }) => product.id === "carafe",
                ),
            ),
          );
        }
      },
    );
    await t.test(
      "generic furniture and seating refinement retain canonical group scope",
      async () => {
        const initial = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition(
                "new",
                {
                  productKind: "furniture",
                  useEnvironment: "outdoor",
                  maxPrice: 150,
                },
                { requestedCount: 10 },
              ),
            ),
            present,
          ],
          "Show outdoor furniture under 150 EUR",
        ).result;
        assert.equal(initial.status.status, "complete");
        assert.equal(initial.search?.totalMatches, 4);
        assert.ok(
          initial.search?.products.some((p) => p.id === "outdoor-bistro-table"),
        );
        const expected = new Set([
          "folding-garden-chair",
          "garden-bench",
          "sun-lounger",
        ]);
        const next = nativeTransition("refine", { functionalGroup: "seating" });
        const seated = await run(
          catalog,
          [call("searchProducts", next), present],
          "I need something to sit on",
          initial.checkpoint.after,
        ).result;
        assert.equal(seated.search?.totalMatches, 3);
        assert.deepEqual(
          new Set(seated.search?.products.map((p) => p.id)),
          expected,
        );
        assert.ok(
          seated.search?.products.every((p) =>
            initial.presentation.productIds.includes(p.id),
          ),
        );
        const narrow = {
          ...next,
          explicitFilters: [
            { facet: "type", value: "sofa" },
            { facet: "type", value: "stool" },
          ],
        };
        const corrected = await run(
          catalog,
          [
            call("searchProducts", narrow),
            call("searchProducts", next),
            present,
          ],
          "I need something to sit on",
          initial.checkpoint.after,
        ).result;
        assert.equal(
          (corrected.evidence[0].output as any).code,
          "UNGROUNDED_FACET",
        );
        assert.equal(corrected.search?.totalMatches, 3);
        assert.deepEqual(
          new Set(corrected.search?.products.map((p) => p.id)),
          expected,
        );
        const sofas = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("refine", { productType: "sofa" }),
            ),
            (m) =>
              present(m, {
                claim: "no-match",
                productIds: [],
                view: "products",
              }),
          ],
          "Only sofas, still under 150",
          initial.checkpoint.after,
        ).result;
        assert.equal(sofas.search?.outcome, "no-match");
        assert.equal(sofas.search?.totalMatches, 0);
        const noBenches = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("refine", { excludeTypes: ["bench"] }),
            ),
            present,
          ],
          "No benches",
          seated.checkpoint.after,
        ).result;
        assert.equal(noBenches.search?.totalMatches, 2);
        assert.ok(
          noBenches.search?.products.every((p) => p.id !== "garden-bench"),
        );
        const ungrounded = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("refine", { excludeTypes: ["bench"] }),
            ),
            call("searchProducts", nativeTransition("refine", {})),
            present,
          ],
          "I like this seating",
          seated.checkpoint.after,
        ).result;
        assert.equal(
          (ungrounded.evidence[0].output as any).code,
          "UNGROUNDED_FACET",
        );
        assert.equal(ungrounded.search?.totalMatches, 3);
      },
    );
    await t.test(
      "cart proposal is not a browser-confirmed addition",
      async () => {
        const attempt = run(
          catalog,
          [
            call("proposeCart", {
              selection: "first",
              items: [{ productId: "mugs", quantity: 1 }],
            }),
            call("presentAnswer", {
              text: "Added to your cart.",
              language: "en",
              evidenceIds: ["e1"],
              productIds: [],
              view: "none",
            }),
            call("presentAnswer", {
              text: "Your device will confirm after saving.",
              language: "en",
              evidenceIds: ["e1"],
              productIds: [],
              view: "none",
            }),
          ],
          "Add the first item to my cart",
          { ...initialAgentState(), lastIds: ["mugs", "carafe"] },
        );
        const result = await attempt.result;
        assert.equal(attempt.mock.count(), 0);
        assert.equal(result.status.status, "complete");
        assert.match(result.answer, /device.*save/i);
        assert.equal(result.operation.status, "awaiting-device");
        assert.equal(result.advice.status, "not-requested");
        assert.equal(result.cart?.productId, "mugs");
      },
    );
    await t.test(
      "canonical search results remain visible alongside optional advice",
      async () => {
        const action = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("refine", { inStockOnly: true }),
            ),
            (m) =>
              present(m, {
                text: "These products are in stock.",
                view: "none",
                productIds: [],
              }),
          ],
          "Check availability",
          {
            ...initialAgentState(),
            criteria: { productKind: "furniture", useEnvironment: "outdoor" },
            lastIds: ["garden-bench"],
          },
        ).result;
        assert.equal(action.status.status, "complete");
        assert.equal(action.operation.status, "completed");
        assert.match(action.answer, /products/);
        assert.equal(action.advice.status, "included");
        if (action.advice.status === "included") assert.equal(action.advice.text, "These products are in stock.");
        assert.equal(action.presentation.view, "products");
        const page = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("new", {}, { requestedCount: 5 }),
            ),
            present,
          ],
          "Show five products",
        ).result;
        assert.equal(page.status.status, "complete");
        assert.equal(page.presentation.productIds.length, 5);
      },
    );
    await t.test(
      "shown IDs require explicit current-user evidence before rejection",
      async () => {
        const state = {
          ...initialAgentState(),
          criteria: {
            productKind: "furniture",
            useEnvironment: "outdoor" as const,
          },
          shownIds: ["garden-bench", "folding-garden-chair"],
          lastIds: ["garden-bench", "folding-garden-chair"],
        };
        const accidental = await run(
          catalog,
          [
            call("searchProducts", {
              ...nativeTransition("refine", {}),
              rejectedIds: state.shownIds,
              rejections: [
                {
                  productId: "garden-bench",
                  userQuote: "I need something to sit on",
                },
              ],
            }),
            present,
          ],
          "I need something to sit on",
          state,
        ).result;
        assert.equal(accidental.status.status, "complete");
        assert.deepEqual(accidental.checkpoint.after.rejectedIds, []);
        const seatTypes = expandFunctionalGroup("seating");
        const outdoorSeats = products.filter(product => product.productKind === "furniture" &&
          ["outdoor", "both"].includes(product.useEnvironment) && seatTypes.includes(product.productType));
        assert.equal(accidental.search?.totalMatches, outdoorSeats.length);
        assert.deepEqual(new Set(accidental.search?.products.map(product => product.id)), new Set(outdoorSeats.map(product => product.id)));
        assert.ok(state.shownIds.every(id => accidental.search?.products.some(product => product.id === id)));
        assert.equal(accidental.search?.products.some(product => product.id === "outdoor-bistro-table"), false);
        const rejected = await run(
          catalog,
          [
            call("searchProducts", {
              ...nativeTransition("refine", {}),
              rejections: [
                { productId: "garden-bench", userQuote: "not the bench" },
                {
                  productId: "folding-garden-chair",
                  userQuote: "not the bench",
                },
              ],
            }),
            present,
          ],
          "Anything but not the bench",
          state,
        ).result;
        assert.deepEqual(rejected.checkpoint.after.rejectedIds, [
          "garden-bench",
        ]);
        assert.ok(
          rejected.search?.products.every((row) => row.id !== "garden-bench"),
        );
      },
    );
    await t.test(
      "unverified discounts and free goods never become catalog advice",
      async () => {
        for (const text of [
          "There is a 4% discount.",
          "These products are free.",
          "Use promo code AURELLE.",
        ]) {
          const action = await run(
            catalog,
            [
              call("getPolicy", { topic: "delivery" }),
              (m) => present(m, { text, view: "none", productIds: [] }),
              (m) =>
                present(m, {
                  text: "Delivery costs EUR 4.",
                  view: "none",
                  productIds: [],
                  evidenceIds: ["e1"],
                }),
            ],
            "Invent a special offer",
          ).result;
          assert.equal(action.status.status, "complete");
          assert.match(action.answer, /delivery costs EUR 4/i);
          assert.equal(action.operation.status, "completed");
          assert.equal(action.advice.status, "unavailable");
        }
      },
    );
    await t.test(
      "new referenced recommendations and comparisons retain canonical presentation",
      async () => {
        const page = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("new", {
                productKind: "gardening",
                useEnvironment: "outdoor",
              }),
            ),
            (m) => present(m, { view: "none" }),
          ],
          "Co macie do ogrodnictwa w ogrodzie?",
        ).result;
        assert.equal(page.presentation.view, "products");
        assert.equal(page.presentation.productIds.length, 5);
        const compared = await run(
          catalog,
          [
            call("compareProducts", { productIds: ["mugs", "carafe"] }),
            (m) => present(m, { view: "none", productIds: [] }),
          ],
          "compare mugs and carafe",
        ).result;
        assert.equal(compared.presentation.view, "comparison");
        assert.deepEqual(compared.presentation.productIds, ["mugs", "carafe"]);
      },
    );
    await t.test(
      "Polish encoder input is corrected before executing a catalog search",
      async () => {
        const result = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition(
                "new",
                {
                  query: "poranna kawa",
                  functionalGroup: "coffee",
                },
                { language: "pl" },
              ),
            ),
            call(
              "searchProducts",
              nativeTransition(
                "new",
                {
                  query: "morning coffee",
                  functionalGroup: "coffee",
                },
                { language: "pl" },
              ),
            ),
            (m) =>
              present(m, {
                language: "pl",
                text: "Oto propozycje do porannej kawy.",
              }),
          ],
          "Szukam czegoś do porannej kawy",
        ).result;
        assert.equal(result.status.status, "complete");
        assert.equal((result.evidence[0].output as any).code, "QUERY_LANGUAGE");
        assert.equal(result.search?.appliedCriteria.query, "morning coffee");
        assert.equal(result.search?.products.length, 5);
        assert.equal(result.search?.appliedCriteria.functionalGroup, "coffee");
        assert.ok(
          result.search?.products.every(
            (p) => !["tea-infuser", "toothbrush-cup"].includes(p.id),
          ),
        );
        const english = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("new", {
                query: "morning coffee",
                functionalGroup: "coffee",
              }),
            ),
            present,
          ],
          "I need something for morning coffee",
        ).result;
        assert.equal(english.status.status, "complete");
        assert.equal(english.search?.appliedCriteria.functionalGroup, "coffee");
        assert.ok(english.search?.products.length);
        assert.ok(
          english.search?.products.every(
            (p) => !["tea-infuser", "toothbrush-cup"].includes(p.id),
          ),
        );
      },
    );
    await t.test(
      "compound search and comparison use consecutive native reads",
      async () => {
        const action = run(
          catalog,
          [
            call("searchProducts", {
              ...nativeTransition(
                "new",
                { productKind: "furniture", useEnvironment: "outdoor" },
                { requestedCount: 4 },
              ),
              continueWith: "compareProducts",
            }),
            (messages) =>
              call("compareProducts", {
                productIds: lastTool(messages).products.map(
                  (p: { id: string }) => p.id,
                ),
              }),
            (messages) =>
              present(messages, {
                view: "comparison",
                evidenceIds: ["e1", "e2"],
              }),
          ],
          "find four outdoor furniture items and compare them",
        );
        const result = await action.result;
        assert.equal(result.status.status, "complete");
        assert.equal(action.mock.count(), 3);
        assert.equal(action.mock.requests[1].tool_choice, "required");
        assert.ok(
          action.mock.requests[1].tools.some(
            (tool: any) => tool.function.name === "compareProducts",
          ),
        );
        assert.deepEqual(
          result.evidence.map((e) => e.tool),
          ["searchProducts", "compareProducts"],
        );
        assert.deepEqual(
          result.comparison?.productIds,
          result.search?.products.map((p) => p.id),
        );
        assert.ok(
          result.comparison?.productIds.every((id) =>
            products.some((p) => p.id === id),
          ),
        );
        assert.equal(result.checkpoint.transition?.operation, "new");
        assert.equal(result.checkpoint.after.criteria.productKind, "furniture");
        assert.equal(
          result.checkpoint.after.criteria.useEnvironment,
          "outdoor",
        );
      },
    );
    await t.test(
      "compound category overview and search use consecutive native reads",
      async () => {
        const action = run(
          catalog,
          [
            call("getCategories", { continueWith: "searchProducts" }),
            call(
              "searchProducts",
              nativeTransition(
                "new",
                { category: "Garden" },
                { requestedCount: 4 },
              ),
            ),
            (messages) => present(messages, { evidenceIds: ["e1", "e2"] }),
          ],
          "what categories are there and show four items in the Garden category",
        );
        const result = await action.result;
        assert.equal(result.status.status, "complete");
        assert.equal(action.mock.count(), 3);
        assert.equal(action.mock.requests[1].tool_choice, "required");
        assert.ok(
          action.mock.requests[1].tools.some(
            (tool: any) => tool.function.name === "searchProducts",
          ),
        );
        assert.deepEqual(
          result.evidence.map((e) => e.tool),
          ["getCategories", "searchProducts"],
        );
        assert.equal(result.categories?.length, 10);
        assert.equal(result.search?.products.length, 4);
        assert.ok(
          result.search?.products.every(
            ({ id }) =>
              products.find((p) => p.id === id)?.category === "Garden",
          ),
        );
        assert.equal(result.checkpoint.transition?.operation, "new");
      },
    );
    await t.test(
      "cart stream contracts preserve legacy manual cards and atomic v3",
      async () => {
        const two = [
          { productId: "mugs", quantity: 1 },
          { productId: "carafe", quantity: 1 },
        ];
        for (const contract of [
          undefined,
          "shopping-v2",
          "shopping-v3",
        ] as const) {
          const mock = scripted([
            call("proposeCart", { selection: "both", items: two }),
            (m) =>
              present(m, {
                view: "none",
                productIds: [],
                text: "Your device will confirm.",
              }),
          ]);
          const events = await collect(
            createNativeAgentStream(
              mock.runtime,
              catalog,
              {
                text: "add both to my cart",
                state: { ...initialAgentState(), lastIds: ["mugs", "carafe"] },
                userMessageId: `cart-contract-${++sequence}`,
                conversationId: `visitor-${sequence}`,
              },
              new AbortController().signal,
              { contract },
            ),
          );
          const actions = events.filter((e) => e.type === "data-cartAction");
          if (contract === "shopping-v3") {
            assert.equal(actions.length, 1);
            const action = actions[0];
            assert.ok(action.type === "data-cartAction");
            assert.deepEqual(action.data.items, two);
          } else {
            assert.equal(actions.length, 0);
            const manual = events.find(
              (e) =>
                e.type === "tool-output-available" &&
                e.toolCallId === "manual-cart",
            );
            assert.ok(
              manual?.type === "tool-output-available" &&
                Array.isArray(manual.output),
            );
            assert.deepEqual(
              new Set(manual.output.map((p: { id: string }) => p.id)),
              new Set(["mugs", "carafe"]),
            );
            assert.ok(
              events.some(
                (e) =>
                  e.type === "text-delta" && e.delta.includes("Add to cart"),
              ),
            );
          }
        }
        const mock = scripted([
          call("proposeCart", {
            selection: "first",
            items: [{ productId: "mugs", quantity: 2 }],
          }),
          (m) =>
            present(m, {
              view: "none",
              productIds: [],
              text: "Your device will confirm.",
            }),
        ]);
        const events = await collect(
          createNativeAgentStream(
            mock.runtime,
            catalog,
            {
              text: "add two units of the first one",
              state: { ...initialAgentState(), lastIds: ["mugs", "carafe"] },
              userMessageId: `single-${++sequence}`,
              conversationId: `visitor-${sequence}`,
            },
            new AbortController().signal,
            { contract: "shopping-v2" },
          ),
        );
        const action = events.find((e) => e.type === "data-cartAction");
        assert.ok(action?.type === "data-cartAction");
        assert.equal(action.data.productId, "mugs");
        assert.equal(action.data.quantity, 2);
      },
    );
    await t.test(
      "provider tool_use_failed during advice preserves completed search without regeneration",
      async () => {
        const bodies: any[] = [];
        const runtime = createGroqRuntime(
          {
            baseURL: "http://127.0.0.1:8787/v1",
            modelId: "test",
            apiKey: "fixture-only",
          },
          async (_input, init) => {
            const body = JSON.parse(String(init?.body));
            bodies.push(body);
            if (bodies.length === 2)
              return Response.json(
                {
                  error: {
                    message: "tool choice is required",
                    code: "tool_use_failed",
                  },
                },
                { status: 400 },
              );
            const action =
              bodies.length === 1
                ? call(
                    "searchProducts",
                    nativeTransition(
                      "new",
                      { category: "Garden" },
                      { requestedCount: 2 },
                    ),
                  )
                : present(body.messages);
            return Response.json({
              id: `recovery-${bodies.length}`,
              model: "test",
              created: 0,
              object: "chat.completion",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: `recovery-call-${bodies.length}`,
                        type: "function",
                        function: {
                          name: action.name,
                          arguments: JSON.stringify(action.input),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage: {
                prompt_tokens: 2,
                completion_tokens: 1,
                total_tokens: 3,
              },
            });
          },
        );
        const turn = {
          text: "show items from the Garden category",
          state: initialAgentState(),
          userMessageId: `provider-recovery-${++sequence}`,
          conversationId: `visitor-${sequence}`,
          history: [
            {
              role: "assistant" as const,
              content: "Prior assistant prose stays data.",
            },
          ],
        };
        const result = await runAgent(
          runtime.model,
          catalog,
          turn,
          new AbortController().signal,
          runtime,
        );
        assert.equal(result.status.status, "complete");
        assert.equal(bodies.length, 2);
        assert.equal(result.operation.status, "completed");
        assert.equal(result.advice.status, "unavailable");
        assert.equal(bodies[1].tool_choice, undefined);
        assert.ok(!bodies[1].tools?.length);
        assert.equal(bodies[1].max_tokens, 384);
        assert.ok(
          bodies[0].messages.some(
            (m: any) => m.role === "assistant" &&
              m.content === "Prior assistant prose stays data.",
          ),
        );
        assert.ok(
          bodies[0].messages.some(
            (m: any) => m.role === "user" && m.content.includes("CURRENT message:"),
          ),
        );
      },
    );
    await t.test("requested counts and smaller assortments", async () => {
      for (const requested of [undefined, 4, 5, 10, 20, 1000]) {
        const result = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition(
                "new",
                { query: "" },
                requested === undefined ? {} : { requestedCount: requested },
              ),
            ),
            present,
          ],
          `count ${requested}`,
        ).result;
        assert.equal(result.status.status, "complete");
        assert.equal(result.search?.requestedCount, requested ?? 5);
        assert.equal(
          result.search?.products.length,
          Math.min(requested ?? 5, 10),
        );
        assert.equal(
          result.presentation.productIds.length,
          Math.min(requested ?? 5, 10),
        );
      }
      const result = await run(
        catalog,
        [
          call(
            "searchProducts",
            nativeTransition(
              "new",
              { productKind: "furniture", useEnvironment: "outdoor" },
              { requestedCount: 10 },
            ),
          ),
          present,
        ],
        "ten garden furniture",
      ).result;
      assert.equal(result.search?.products.length, 6);
      assert.equal(result.search?.totalMatches, 6);
      const exhausted = await run(
        catalog,
        [
          call("searchProducts", nativeTransition("more")),
          (m) =>
            present(m, {
              view: "products",
              productIds: [],
              claim: "exhausted",
            }),
        ],
        "more",
        result.checkpoint.after,
      ).result;
      assert.equal(exhausted.search?.outcome, "exhausted");
      assert.equal(exhausted.search?.products.length, 0);
      assert.equal(exhausted.status.usage?.calls, 1);
      assert.equal(exhausted.advice.status, "not-requested");
      assert.match(exhausted.answer, /seen all the matching products/);
      const overview = await run(
        catalog,
        [
          call("getCatalogOverview", { criteria: {}, useActive: true }),
          (m) =>
            present(m, {
              view: "none",
              productIds: [],
              text: "There are [[count:e1:total]] products.",
            }),
        ],
        "how many",
        exhausted.checkpoint.after,
      ).result;
      assert.match(overview.answer, /\b6 products\b/);
      assert.equal(overview.operation.status, "completed");
    });
    await t.test(
      "hard and approximate budgets, negation and soft preferences",
      async () => {
        const base = {
          productKind: "furniture",
          useEnvironment: "outdoor" as const,
        };
        const hard = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition(
                "new",
                { ...base, maxPrice: 80 },
                { requestedCount: 10, preferences: ["decorative"] },
              ),
            ),
            present,
          ],
          "garden furniture at most 80",
        ).result;
        assert.equal(hard.search?.totalMatches, 2);
        assert.ok(
          hard.search!.products.every(
            ({ id }) => products.find((p) => p.id === id)!.price <= 80,
          ),
        );
        assert.deepEqual(hard.checkpoint.after.preferences, ["decorative"]);
        assert.equal(hard.checkpoint.after.criteria.productKind, "furniture");
        const approximate = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("refine", { targetPrice: 100 }),
            ),
            present,
          ],
          "around 100",
          hard.checkpoint.after,
        ).result;
        assert.equal(approximate.checkpoint.after.criteria.maxPrice, undefined);
        assert.ok(
          approximate.search!.products.some(
            ({ id }) => products.find((p) => p.id === id)!.price > 100,
          ),
        );
        const excluded = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition(
                "change",
                { excludeTypes: ["bench"] },
                { remove: ["targetPrice"] },
              ),
            ),
            present,
          ],
          "no benches or price limit",
          approximate.checkpoint.after,
        ).result;
        assert.equal(excluded.search?.totalMatches, 4);
        assert.ok(
          excluded.search!.products.every(
            ({ id }) =>
              products.find((p) => p.id === id)!.productType !== "bench",
          ),
        );
        assert.equal(excluded.checkpoint.after.criteria.targetPrice, undefined);
      },
    );
    await t.test(
      "new scope, refinement, removal, more and overview",
      async () => {
        const garden = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("new", { category: "Garden", maxPrice: 50 }),
            ),
            present,
          ],
          "show the Garden category under 50",
        ).result;
        const furniture = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition(
                "new",
                { productKind: "furniture", useEnvironment: "outdoor" },
                { requestedCount: 2 },
              ),
            ),
            present,
          ],
          "garden furniture",
          garden.checkpoint.after,
        ).result;
        assert.equal(furniture.search?.totalMatches, 6);
        assert.equal(furniture.checkpoint.after.criteria.category, undefined);
        assert.equal(furniture.checkpoint.after.criteria.maxPrice, undefined);
        const page2 = await run(
          catalog,
          [call("searchProducts", nativeTransition("more")), present],
          "more",
          furniture.checkpoint.after,
        ).result;
        assert.equal(page2.search?.products.length, 2);
        assert.ok(
          page2.search!.products.every(
            (p) => !furniture.presentation.productIds.includes(p.id),
          ),
        );
        const overview = await run(
          catalog,
          [
            call("getCatalogOverview", { criteria: {}, useActive: true }),
            (m) =>
              present(m, {
                view: "none",
                productIds: [],
                text: "There are [[count:e1:total]] products.",
              }),
          ],
          "how many",
          page2.checkpoint.after,
        ).result;
        assert.equal(overview.status.status, "complete");
        assert.match(overview.answer, /6/);
        const refined = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("refine", { maxPrice: 80 }),
            ),
            present,
          ],
          "under 80",
          page2.checkpoint.after,
        ).result;
        assert.equal(refined.checkpoint.after.criteria.maxPrice, 80);
        const removed = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("change", {}, { remove: ["maxPrice"] }),
            ),
            present,
          ],
          "remove limit",
          refined.checkpoint.after,
        ).result;
        assert.equal(removed.checkpoint.after.criteria.maxPrice, undefined);
        assert.equal(removed.search?.totalMatches, 6);
      },
    );
    await t.test(
      "unconfirmed feature, invalid filter correction and real semantic retrieval",
      async () => {
        const unsupported = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("new", {
                productKind: "furniture",
                useEnvironment: "outdoor",
                requiredFeatures: ["waterproof"],
              }),
            ),
            (m) =>
              present(m, {
                productIds: [],
                view: "products",
                claim: "unconfirmed-feature",
              }),
          ],
          "waterproof garden furniture",
        ).result;
        assert.equal(unsupported.search?.outcome, "unconfirmed-feature");
        assert.equal(unsupported.search?.products.length, 0);
        const certified = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("new", {
                productKind: "furniture",
                useEnvironment: "outdoor",
                requiredFeatures: ["certified"],
              }),
            ),
            (m) =>
              present(m, {
                productIds: [],
                view: "products",
                claim: "unconfirmed-feature",
              }),
          ],
          "certified garden furniture",
        ).result;
        assert.equal(certified.search?.outcome, "unconfirmed-feature");
        const wood = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition(
                "new",
                {
                  productKind: "furniture",
                  useEnvironment: "outdoor",
                  requiredFeatures: ["wood"],
                },
                { requestedCount: 10 },
              ),
            ),
            present,
          ],
          "wooden outdoor furniture",
        ).result;
        assert.ok(wood.search!.products.length > 0);
        assert.ok(
          wood.search!.products.every(({ id }) =>
            /wood/.test(products.find((p) => p.id === id)!.material),
          ),
        );
        const fixed = await run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("new", { category: "Not a category" }),
            ),
            call(
              "searchProducts",
              nativeTransition(
                "new",
                { query: "a ceramic cone for brewing pour-over coffee" },
                { requestedCount: 2 },
              ),
            ),
            present,
          ],
          "coffee",
        ).result;
        assert.equal(fixed.status.status, "complete");
        assert.ok((fixed.evidence[0].output as any).error);
        assert.ok(
          fixed.search?.products.some((p) => p.id === "pour-over-dripper"),
        );
      },
    );
    await t.test(
      "policy numbers are verified before presenting advice",
      async () => {
        const result = await run(
          catalog,
          [
            call("getPolicy", { topic: "returns" }),
            (m) =>
              present(m, {
                text: "Returns are accepted within 30 days.",
                view: "none",
                productIds: [],
              }),
            (m) =>
              present(m, {
                text: "Returns are accepted within 14 days.",
                view: "none",
                productIds: [],
                evidenceIds: ["e1"],
              }),
          ],
          "What is your returns policy?",
        ).result;
        assert.equal(result.status.status, "complete");
        assert.match(result.answer, /14 days/);
        assert.doesNotMatch(result.answer, /30 days/);
      },
    );
    await t.test(
      "categories and comparison include all products and ties",
      async () => {
        const categories = await run(
          catalog,
          [
            call("getCategories", {}),
            (m) => present(m, { view: "categories", productIds: [] }),
          ],
          "categories",
        ).result;
        assert.equal(categories.categories?.length, 10);
        assert.equal(
          categories.categories?.reduce((n, c) => n + c.count, 0),
          products.length,
        );
        const ids = ["mugs", "wine-glasses", "carafe", "cutlery"];
        const compared = await run(
          catalog,
          [
            call("compareProducts", { productIds: ids }),
            (m) => present(m, { view: "comparison" }),
          ],
          "compare",
        ).result;
        assert.deepEqual(compared.comparison?.productIds, ids);
        assert.deepEqual(compared.comparison?.cheapestIds, ["cutlery"]);
        const ties = await run(
          catalog,
          [
            call("compareProducts", { productIds: ["mugs", "wine-glasses"] }),
            (m) => present(m, { view: "comparison" }),
          ],
          "compare ties",
        ).result;
        assert.deepEqual(
          new Set(ties.comparison?.cheapestIds),
          new Set(["mugs", "wine-glasses"]),
        );
      },
    );
    await t.test(
      "cart requires explicit selection and keeps both items atomic",
      async () => {
        const state = { ...initialAgentState(), lastIds: ["mugs", "carafe"] };
        const proposal = {
          selection: "both",
          items: [
            { productId: "mugs", quantity: 1 },
            { productId: "carafe", quantity: 1 },
          ],
        };
        const action = run(
          catalog,
          [
            call("proposeCart", proposal),
            (m) =>
              present(m, {
                view: "none",
                productIds: [],
                text: "Your device will confirm.",
              }),
          ],
          "add both to my cart",
          state,
        );
        const added = await action.result;
        assert.deepEqual(added.cart?.items, proposal.items);
        assert.equal(added.cart?.productId, "mugs");
        const retry = await runAgent(
          action.mock.runtime.model,
          catalog,
          action.turn,
          new AbortController().signal,
          action.mock.runtime,
        );
        assert.equal(retry.cart?.operationId, added.cart?.operationId);
        assert.equal(action.mock.count(), 0);
        assert.equal(added.operation.status, "awaiting-device");
        assert.equal(added.advice.status, "not-requested");
        assert.equal(retry.operation.id, added.operation.id);
        const rejected = await run(
          catalog,
          [
            call("proposeCart", proposal),
            (m) =>
              present(m, {
                view: "none",
                productIds: [],
                text: "Which would you like?",
              }),
          ],
          "compare both",
          state,
        ).result;
        assert.equal(rejected.cart, undefined);
        assert.ok((rejected.evidence[0].output as any).error);
        const named = await run(
          catalog,
          [
            call("proposeCart", {
              selection: "named",
              items: [{ productId: "mugs", quantity: 2 }],
            }),
            (m) =>
              present(m, {
                view: "none",
                productIds: [],
                text: "Your device will confirm.",
              }),
          ],
          "add two Ceramic mugs",
          state,
        ).result;
        assert.deepEqual(named.cart?.items, [
          { productId: "mugs", quantity: 2 },
        ]);
      },
    );
    await t.test(
      "fake advice references are rejected and malformed initial calls are corrected",
      async () => {
        const result = await run(
          catalog,
          [
            call("getProductDetails", { productId: "mugs" }),
            call("presentAnswer", {
              text: "[[price:fake]]",
              language: "en",
              evidenceIds: ["e1"],
              productIds: ["mugs"],
              view: "products",
            }),
            call("presentAnswer", {
              text: "[[name:mugs]] costs [[price:mugs]].",
              language: "en",
              evidenceIds: ["e1"],
              productIds: ["mugs"],
              view: "products",
            }),
          ],
          "Tell me more about Ceramic mugs.",
        ).result;
        assert.equal(result.status.status, "complete");
        assert.match(result.answer, /Ceramic mugs/);
        assert.equal(result.operation.status, "completed");
        assert.equal(result.advice.status, "unavailable");
        assert.doesNotMatch(result.answer, /\[\[/);
        const invalidAttempt = run(
          catalog,
          [
            call("searchProducts", {
              operation: "not-an-operation",
              language: "en",
              criteria: {},
              continueWith: "presentAnswer",
            }),
            call("presentAnswer", {
              text: "Please clarify.",
              language: "en",
              evidenceIds: [],
              productIds: [],
              view: "none",
            }),
          ],
          "invalid",
        );
        const invalid = await invalidAttempt.result;
        assert.equal(invalidAttempt.mock.count(), 2);
        assert.equal(invalid.status.status, "complete");
        assert.equal(invalid.search, undefined);
      },
    );
    await t.test(
      "invented products, counts, absence and unknown tools are not emitted",
      async (inner) => {
        const good = call("presentAnswer", {
          text: "I can help you check.",
          language: "en",
          evidenceIds: [],
          productIds: [],
          view: "none",
        });
        const badAnswers = [
          call("presentAnswer", {
            text: "There are [[count:e1:madeUp]] products.",
            language: "en",
            evidenceIds: ["e1"],
            productIds: [],
            view: "none",
          }),
          call("presentAnswer", {
            text: "There are 999 products.",
            language: "en",
            evidenceIds: ["e1"],
            productIds: [],
            view: "none",
          }),
          call("presentAnswer", {
            text: "There is no assortment.",
            language: "en",
            evidenceIds: ["e1"],
            productIds: [],
            view: "none",
            claim: "no-assortment",
          }),
        ];
        for (const bad of badAnswers) {
          await inner.test(`reject ${JSON.stringify(bad.input)}`, async () => {
            const attempt = run(
              catalog,
              [call("searchProducts", nativeTransition("new", {}, { requestedCount: 2 })), bad, good],
              `adversarial ${JSON.stringify(bad)}`,
            );
            const result = await attempt.result;
            assert.equal(result.operation.status, "completed");
            assert.equal(result.advice.status, "unavailable");
            assert.equal(attempt.mock.count(), 2);
            assert.doesNotMatch(result.answer, /invented-product|999|no assortment|\[\[/i);
          });
        }
        await inner.test("fixture metadata is not sent as model advice", async () => {
          const action = run(catalog, [
            call("searchProducts", nativeTransition("new", {}, { requestedCount: 2 })),
            call("presentAnswer", {
              text: "I can help you check.", language: "en",
              evidenceIds: ["invented-evidence"], productIds: ["invented-product"], view: "products",
            }),
          ], "Help me choose.");
          const result = await action.result;
          assert.equal(action.mock.count(), 2);
          assert.equal(result.operation.status, "completed");
          assert.equal(result.advice.status, "included");
          if (result.advice.status === "included")
            assert.equal(result.advice.text, "I can help you check.");
        });
        await inner.test("reject unknown tool", async () => {
          const unknown = await run(
            catalog,
            [call("inventProduct", {}), good],
            "invent tool",
          ).result;
          assert.equal(unknown.answer, "I can help you check.");
          assert.equal(unknown.evidence.length, 0);
        });
        await inner.test("reject invented product in initial tool metadata", async () => {
          const action = run(catalog, [
            call("presentAnswer", {
              text: "A product.", language: "en", evidenceIds: [],
              productIds: ["invented-product"], view: "products",
            }),
            good,
          ], "Help me choose.");
          const result = await action.result;
          assert.equal(action.mock.count(), 2);
          assert.equal(result.status.status, "complete");
          assert.equal(result.answer, "I can help you check.");
          assert.ok(!result.presentation.productIds.includes("invented-product"));
        });
      },
    );
    await t.test(
      "advice failure preserves the resolved page and stable operation on retry",
      async () => {
        const state = {
          ...initialAgentState(),
          criteria: {
            productKind: "furniture",
            useEnvironment: "outdoor" as const,
          },
          requestedCount: 2,
          shownIds: ["outdoor-bistro-table"],
        };
        const turn = {
          text: "more",
          state,
          userMessageId: `partial-${++sequence}`,
          conversationId: `visitor-${sequence}`,
        };
        let firstPage: string[] = [];
        let n = 0;
        const failed = createGroqRuntime(
          {
            baseURL: "http://127.0.0.1:8787/v1",
            modelId: "test",
            apiKey: "fixture-only",
          },
          async (_input, init) => {
            const body = JSON.parse(String(init?.body));
            if (++n === 2) {
              const context = adviceContext(body.messages);
              assert.ok(context);
              firstPage = context.records.map((p: { name: string }) => p.name);
              throw new Error("simulated interruption after search");
            }
            return Response.json({
              id: "first",
              model: "test",
              created: 0,
              object: "chat.completion",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "first-call",
                        type: "function",
                        function: {
                          name: "searchProducts",
                          arguments: JSON.stringify(
                            call("searchProducts", nativeTransition("more"))
                              .input,
                          ),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage: {
                prompt_tokens: 2,
                completion_tokens: 1,
                total_tokens: 3,
              },
            });
          },
        );
        const interrupted = await runAgent(
          failed.model,
          catalog,
          turn,
          new AbortController().signal,
          failed,
        );
        assert.equal(firstPage.length, 2);
        assert.equal(interrupted.status.status, "complete");
        assert.equal(interrupted.operation.status, "completed");
        assert.equal(interrupted.advice.status, "unavailable");
        assert.deepEqual(interrupted.search?.products.map((p) => products.find((item) => item.id === p.id)?.name), firstPage);
        const retry = scripted([
          call("searchProducts", nativeTransition("more")),
          present,
        ]);
        const result = await runAgent(
          retry.runtime.model,
          catalog,
          turn,
          new AbortController().signal,
          retry.runtime,
        );
        assert.deepEqual(
          result.search?.products.map((p) => products.find((item) => item.id === p.id)?.name),
          firstPage,
        );
        assert.ok(!result.search?.products.some((p) => p.id === "outdoor-bistro-table"));
        const partialTurn = {
          ...turn,
          userMessageId: `partial-response-${++sequence}`,
        };
        const badAnswer = call("presentAnswer", {
          text: "[[price:invented]]",
          language: "en",
          evidenceIds: ["e1"],
          productIds: [],
          view: "none",
        });
        const partialModel = scripted([
          call("searchProducts", nativeTransition("more")),
          badAnswer,
          badAnswer,
        ]);
        const partial = await runAgent(
          partialModel.runtime.model,
          catalog,
          partialTurn,
          new AbortController().signal,
          partialModel.runtime,
        );
        assert.equal(partial.status.status, "complete");
        assert.equal(partial.operation.status, "completed");
        assert.equal(partial.advice.status, "unavailable");
        assert.equal(partialModel.count(), 2);
        const correctedModel = scripted([
          call("searchProducts", nativeTransition("more")),
          present,
        ]);
        const corrected = await runAgent(
          correctedModel.runtime.model,
          catalog,
          partialTurn,
          new AbortController().signal,
          correctedModel.runtime,
        );
        assert.equal(corrected.status.status, "complete");
        assert.equal(corrected.operation.id, partial.operation.id);
        assert.deepEqual(corrected.search?.products, partial.search?.products);
      },
    );
    await t.test(
      "same message retry is stable and independent visitors do not share state",
      async () => {
        const action = run(
          catalog,
          [call("searchProducts", nativeTransition("more")), present],
          "more",
          { ...initialAgentState(), shownIds: ["mugs"] },
        );
        const first = await action.result;
        const second = await runAgent(
          action.mock.runtime.model,
          catalog,
          action.turn,
          new AbortController().signal,
          action.mock.runtime,
        );
        assert.deepEqual(second, first);
        assert.equal(action.mock.count(), 2);
        const a = run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("new", { category: "Kitchen" }),
            ),
            present,
          ],
          "show the Kitchen category",
        );
        const b = run(
          catalog,
          [
            call(
              "searchProducts",
              nativeTransition("new", { category: "Garden" }),
            ),
            present,
          ],
          "show the Garden category",
        );
        const [left, right] = await Promise.all([a.result, b.result]);
        assert.equal(left.search?.appliedCriteria.category, "Kitchen");
        assert.equal(right.search?.appliedCriteria.category, "Garden");
      },
    );
    await t.test(
      "cancellation and provider errors produce bounded stream outcomes",
      async () => {
        const aborted = new AbortController();
        aborted.abort();
        const mock = scripted([]);
        await assert.rejects(
          runAgent(
            mock.runtime.model,
            catalog,
            {
              text: "hello",
              state: initialAgentState(),
              userMessageId: `abort-${++sequence}`,
            },
            aborted.signal,
          ),
        );
        assert.equal(mock.count(), 0);
        const limited = createGroqRuntime(
          {
            baseURL: "http://127.0.0.1:8787/v1",
            modelId: "test",
            apiKey: "fixture-only",
          },
          async () =>
            new Response("rate limited", {
              status: 429,
              headers: { "retry-after": "7" },
            }),
        );
        const stream = createNativeAgentStream(
          limited,
          catalog,
          {
            text: "hello",
            state: initialAgentState(),
            userMessageId: `limit-${++sequence}`,
          },
          new AbortController().signal,
          { contract: "shopping-v3" },
        );
        const events = await collect(stream);
        assert.ok(
          events.some(
            (event) =>
              event.type === "data-turnStatus" &&
              event.data.status === "provider-limit" &&
              event.data.retryAfter === 7,
          ),
        );
        assert.ok(!events.some((event) => event.type === "data-cartAction"));
        const timedOut = createGroqRuntime(
          {
            baseURL: "http://127.0.0.1:8787/v1",
            modelId: "test",
            apiKey: "fixture-only",
          },
          async () => {
            throw new Error("simulated timeout");
          },
        );
        const timeoutStream = createNativeAgentStream(
          timedOut,
          catalog,
          {
            text: "hello",
            state: initialAgentState(),
            userMessageId: `timeout-${++sequence}`,
          },
          new AbortController().signal,
          { contract: "shopping-v3" },
        );
        const timeoutEvents = await collect(timeoutStream);
        assert.ok(
          timeoutEvents.some(
            (event) =>
              event.type === "data-turnStatus" &&
              event.data.status === "connection-error",
          ),
        );
        assert.ok(
          !timeoutEvents.some((event) => event.type === "data-cartAction"),
        );
        const controller = new AbortController();
        let started!: () => void;
        const startedPromise = new Promise<void>((resolve) => {
          started = resolve;
        });
        let settled = 0;
        const hanging = createGroqRuntime(
          {
            baseURL: "http://127.0.0.1:8787/v1",
            modelId: "test",
            apiKey: "fixture-only",
          },
          async (_input, init) => {
            started();
            return new Promise<Response>((_resolve, reject) => {
              const signal = init?.signal;
              if (signal?.aborted) reject(signal.reason);
              else
                signal?.addEventListener("abort", () => reject(signal.reason), {
                  once: true,
                });
            });
          },
        );
        const cancelled = createNativeAgentStream(
          hanging,
          catalog,
          {
            text: "hello",
            state: initialAgentState(),
            userMessageId: `cancel-${++sequence}`,
          },
          controller.signal,
          {
            contract: "shopping-v3",
            onSettled: () => {
              settled++;
            },
          },
        );
        const collecting = collect(cancelled);
        await startedPromise;
        controller.abort();
        const cancelledEvents = await collecting;
        assert.equal(settled, 1);
        assert.ok(
          !cancelledEvents.some(
            (event) =>
              event.type === "data-cartAction" || event.type === "text-delta",
          ),
        );
      },
    );
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test("state helpers preserve persistent preferences and remove stale filters", () => {
  const initial = {
    ...initialAgentState(),
    persistentPreferences: ["natural materials"],
    criteria: { category: "Garden", maxPrice: 50 },
  };
  const fresh = transitionState(
    initial,
    transition("new", { productKind: "furniture", useEnvironment: "outdoor" }),
  );
  assert.deepEqual(fresh.persistentPreferences, ["natural materials"]);
  assert.equal(fresh.criteria.category, undefined);
  assert.equal(fresh.criteria.maxPrice, undefined);
});
