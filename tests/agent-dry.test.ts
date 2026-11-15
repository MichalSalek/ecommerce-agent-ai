import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "@huggingface/transformers";
import { products } from "../src/data/products";
import { CatalogService } from "../src/application/catalog/catalog-service";
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
const call = (name: string, input: unknown): Call => ({ name, input });
const lastTool = (messages: any[]) => {
  const message = [...messages].reverse().find((m) => m.role === "tool");
  return JSON.parse(message.content);
};
const present = (
  messages: any[],
  overrides: Record<string, unknown> = {},
): Call => {
  const evidence = lastTool(messages);
  const productIds = (evidence.products ?? []).map((p: { id: string }) => p.id);
  return call("presentAnswer", {
    text: "Here are the verified results.",
    language: "en",
    evidenceIds: [evidence.evidenceId],
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
      balancer: true,
      windowsTransport: false,
    },
    async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      const next = steps[calls++];
      assert.ok(next, `unexpected model request ${calls}`);
      const action = typeof next === "function" ? next(body.messages) : next;
      return Response.json({
        id: `completion-${calls}`,
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
                  id: `call-${calls}`,
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
    await t.test("requested counts and smaller assortments", async () => {
      for (const requested of [undefined, 4, 5, 10, 20, 1000]) {
        const result = await run(
          catalog,
          [
            call(
              "searchProducts",
              transition(
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
            transition(
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
          call("searchProducts", transition("more")),
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
      assert.equal(overview.answer, "There are 6 products.");
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
              transition(
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
            call("searchProducts", transition("refine", { targetPrice: 100 })),
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
              transition(
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
              transition("new", { category: "Garden", maxPrice: 50 }),
            ),
            present,
          ],
          "garden",
        ).result;
        const furniture = await run(
          catalog,
          [
            call(
              "searchProducts",
              transition(
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
          [call("searchProducts", transition("more")), present],
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
            call("searchProducts", transition("refine", { maxPrice: 80 })),
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
              transition("change", {}, { remove: ["maxPrice"] }),
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
              transition("new", {
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
              transition("new", {
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
              transition(
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
              transition("new", { category: "Not a category" }),
            ),
            call(
              "searchProducts",
              transition(
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
        assert.equal(action.mock.count(), 2);
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
      "fake references and malformed inputs are corrected, not emitted",
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
          "mug price",
        ).result;
        assert.equal(result.status.status, "complete");
        assert.match(result.answer, /22\.00 EUR/);
        assert.doesNotMatch(result.answer, /\[\[/);
        const invalid = await run(
          catalog,
          [
            call("searchProducts", {
              operation: "not-an-operation",
              language: "en",
              criteria: {},
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
        ).result;
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
            text: "A product.",
            language: "en",
            evidenceIds: ["e1"],
            productIds: ["invented-product"],
            view: "products",
          }),
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
            const result = await run(
              catalog,
              [call("getCatalogOverview", { criteria: {} }), bad, good],
              `adversarial ${JSON.stringify(bad)}`,
            ).result;
            assert.equal(result.answer, "I can help you check.");
          });
        }
        await inner.test("reject unknown tool", async () => {
          const unknown = await run(
            catalog,
            [call("inventProduct", {}), good],
            "invent tool",
          ).result;
          assert.equal(unknown.answer, "I can help you check.");
          assert.equal(unknown.evidence.length, 0);
        });
      },
    );
    await t.test(
      "retry after transport failure reuses the resolved page",
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
            balancer: true,
            windowsTransport: false,
          },
          async (_input, init) => {
            const body = JSON.parse(String(init?.body));
            if (++n === 2) {
              firstPage = lastTool(body.messages).products.map(
                (p: { id: string }) => p.id,
              );
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
                          arguments: JSON.stringify(transition("more")),
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
        await assert.rejects(
          runAgent(
            failed.model,
            catalog,
            turn,
            new AbortController().signal,
            failed,
          ),
        );
        assert.equal(firstPage.length, 2);
        const retry = scripted([
          call("searchProducts", transition("more")),
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
          result.search?.products.map((p) => p.id),
          firstPage,
        );
        assert.ok(!firstPage.includes("outdoor-bistro-table"));
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
          call("searchProducts", transition("more")),
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
        assert.equal(partial.status.status, "partial");
        const correctedModel = scripted([
          call("searchProducts", transition("more")),
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
        assert.deepEqual(corrected.search?.products, partial.search?.products);
      },
    );
    await t.test(
      "same message retry is stable and independent visitors do not share state",
      async () => {
        const action = run(
          catalog,
          [call("searchProducts", transition("more")), present],
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
            call("searchProducts", transition("new", { category: "Kitchen" })),
            present,
          ],
          "kitchen",
        );
        const b = run(
          catalog,
          [
            call("searchProducts", transition("new", { category: "Garden" })),
            present,
          ],
          "garden",
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
            balancer: true,
            windowsTransport: false,
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
            balancer: true,
            windowsTransport: false,
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
            balancer: true,
            windowsTransport: false,
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
