import { test } from "node:test";
import assert from "node:assert/strict";
import { products } from "../src/data/products";
import { initialAgentState } from "../src/application/chat/shopping-v3";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import {
  runAgent,
  createNativeAgentStream,
  stateFromMessages,
  adviceResultFromMessages,
} from "../src/infrastructure/chat/native-agent";
import type { CatalogService } from "../src/application/catalog/catalog-service";
import {
  assistantTextError,
  catalogFactAbsenceError,
  resolveLanguage,
} from "../src/application/chat/assistant-text";
import {
  rememberCartIntent,
  pendingCartIntent,
  forgetCartIntent,
} from "../src/application/chat/cart-intent";
import {
  operationSchema,
  operationTurnStatus,
} from "../src/application/chat/shopping-v3";

let sequence = 0;
const catalog = {
  details: async (id: string) => products.find((p) => p.id === id),
} as CatalogService;
function model(responses: unknown[] = []) {
  let calls = 0;
  const requests: any[] = [];
  const runtime = createGroqRuntime(
    {
      baseURL: "http://fixture/v1",
      modelId: "fixture",
      balancer: true,
      windowsTransport: false,
    },
    async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      let response: any = responses[calls++];
      if (
        !requests.at(-1).tools?.length &&
        response?.choices?.[0]?.message?.tool_calls?.[0]?.function?.name ===
          "presentAnswer"
      ) {
        response = structuredClone(response);
        const choice = response.choices[0];
        choice.message.content = JSON.parse(
          choice.message.tool_calls[0].function.arguments,
        ).text;
        delete choice.message.tool_calls;
        if (choice.finish_reason === "tool_calls")
          choice.finish_reason = "stop";
      }
      if (!response) return new Response("unavailable", { status: 503 });
      return Response.json(response);
    },
  );
  return { runtime, calls: () => calls, requests };
}
const response = (
  name: string,
  input: unknown,
  finish_reason = "tool_calls",
) => ({
  id: "fixture",
  model: "fixture",
  created: 1,
  choices: [
    {
      index: 0,
      finish_reason,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call",
            type: "function",
            function: { name, arguments: JSON.stringify(input) },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
});
async function run(text: string, mock = model(), extra = {}) {
  return runAgent(
    mock.runtime.model,
    catalog,
    {
      text,
      userMessageId: `outcome-${++sequence}`,
      conversationId: `outcome-c-${sequence}`,
      state: initialAgentState(),
      ...extra,
    },
    new AbortController().signal,
    mock.runtime,
  );
}

test("comparison button completes without a model and preserves its group", async () => {
  const mock = model();
  const result = await run("Compare these products", mock, {
    action: { type: "compare", productIds: ["mugs", "carafe"] },
  });
  assert.equal(result.status.status, "complete");
  assert.equal(mock.calls(), 0);
  assert.match(result.answer, /2 products/);
  assert.match(result.answer, /EUR|€/);
  assert.deepEqual(result.checkpoint.after.resultIds, ["mugs", "carafe"]);
});

test("advice cannot deny known prices beneath a completed comparison", async () => {
  for (const [language, text] of [["pl", "W podanych materiałach brakuje informacji o cenach, aby wskazać tańszy produkt."], ["en", "There is no pricing information in the supplied records."]] as const) {
    const mock = model([
      response("compareProducts", { productIds: ["mugs", "carafe"] }),
      response("presentAnswer", { text, language, evidenceIds: ["e1"], productIds: ["mugs", "carafe"], view: "comparison" }),
    ]);
    const result = await run(language === "pl" ? "Porównaj kubki i karafkę" : "Compare mugs and carafe", mock);
    assert.equal(result.operation.status, "completed");
    assert.equal(result.advice.status, "unavailable");
    assert.deepEqual(result.comparison?.cheapestIds, ["carafe"]);
    assert.equal(mock.calls(), 2);
  }
});

test("known-field absence checks preserve missing performance data and unknown fields", () => {
  assert.equal(catalogFactAbsenceError("The catalog has no durability information, but the price is recorded.", { price: true, dimensions: true }), undefined);
  assert.equal(catalogFactAbsenceError("There is no pricing information.", { price: false, dimensions: false }), undefined);
  assert.equal(catalogFactAbsenceError("Brakuje informacji o wymiarach.", { price: true, dimensions: true }), "FALSE_MISSING_MEASUREMENT");
  assert.equal(catalogFactAbsenceError("Prices are not listed.", { price: true, dimensions: true }), "FALSE_MISSING_PRICE");
});

test("a price reference owns its currency suffix", async () => {
  const mock = model([response("presentAnswer", { text: "W koszyku masz [[count:cart:totalUnits]] sztuki [[name:carafe]] po [[price:carafe]] EUR za sztukę.", language: "pl", evidenceIds: ["cart"], productIds: ["carafe"], view: "none" })]);
  const result = await run("Jaką ilość wybrałem wcześniej?", mock, { cart: [{ productId: "carafe", quantity: 2 }] });
  assert.equal(result.operation.status, "completed");
  assert.match(result.answer, /19\.00 EUR za sztukę/);
  assert.doesNotMatch(result.answer, /EUR EUR/);
});

test("the demo policy answers the store-status question in both languages", async () => {
  for (const language of ["pl", "en"] as const) {
    const mock = model([
      response("getPolicy", { topic: "demonstracyjny sklep" }),
      response("presentAnswer", { text: language === "pl" ? "Informacje dotyczą sklepu demonstracyjnego." : "This concerns the demonstration store.", language, evidenceIds: ["e1"], productIds: [], view: "none" }),
    ]);
    const result = await run(language === "pl" ? "Czy to sklep demonstracyjny?" : "Is this a demonstration store?", mock, { state: { ...initialAgentState(), language } });
    assert.equal(result.operation.status, "completed");
    assert.match(result.answer, language === "pl" ? /sklep demonstracyjny.*nie przyjmuje płatności/ : /demonstration store.*does not accept payments/);
  }
});

test("a comparison recovers from an overview carrying the previous topic's filters", async () => {
  const mock = model([
    response("getCatalogOverview", {
      criteria: { query: "garden furniture", functionalGroup: "seating", maxPrice: 150, useEnvironment: "outdoor", inStockOnly: true },
      explicitFilters: [{ facet: "category", value: "kitchen", userQuote: "kubki i karafkę" }],
    }),
    response("searchProducts", {
      operation: "browse", language: "pl", mode: "lookup", continueWith: "compareProducts",
      criteria: { query: "cups and carafe", functionalGroup: "coffee", maxPrice: 150, useEnvironment: "outdoor", requiredFeatures: [], inStockOnly: true },
      explicitFilters: [{ facet: "category", value: "kitchen", userQuote: "kubki i karafkę" }],
    }),
    response("compareProducts", { productIds: ["mugs", "carafe"] }),
    response("presentAnswer", {
      text: "Kubki mają uchwyty, a karafka wąską szyjkę.", language: "pl", evidenceIds: ["e3"], productIds: ["mugs", "carafe"], view: "comparison",
    }),
  ]);
  const searches: any[] = [];
  const service = {
    ...catalog,
    searchResult: async (criteria: any) => { searches.push(criteria); return { products: products.filter(p => ["mugs", "carafe"].includes(p.id)), totalMatches: 2 }; },
  } as CatalogService;
  const state = { ...initialAgentState(), language: "pl" as const, languageChosen: true, criteria: { query: "garden furniture", functionalGroup: "seating" as const, maxPrice: 150, useEnvironment: "outdoor" as const, inStockOnly: true }, resultIds: ["folding-garden-chair", "garden-bench", "sun-lounger"], lastIds: ["folding-garden-chair", "garden-bench", "sun-lounger"] };
  const result = await runAgent(mock.runtime.model, service, { text: "Porównaj kubki i karafkę.", userMessageId: "comparison-overview", conversationId: "comparison-overview", state }, new AbortController().signal, mock.runtime);
  assert.equal(result.operation.status, "completed");
  assert.equal(result.operation.kind, "comparison");
  assert.deepEqual(result.comparison?.productIds, ["mugs", "carafe"]);
  assert.equal(searches.length, 1);
  assert.equal(searches[0].maxPrice, undefined);
  assert.equal(searches[0].functionalGroup, undefined);
  assert.equal(searches[0].useEnvironment, undefined);
  assert.equal(searches[0].inStockOnly, undefined);
  assert.equal(searches[0].category, undefined);
  assert.equal(searches[0].query, "cups and carafe");
  assert.deepEqual(mock.requests[1].tools.map((tool: any) => tool.function.name), ["searchProducts"]);
  assert.equal(result.cart, undefined);
  assert.equal(mock.calls(), 4);
});

test("category overview comparisons keep their ordinary read path", async () => {
  for (const text of ["Compare Kitchen and Home category counts", 'Compare "mugs and carafe" as a quoted example', "Compare delivery policies, not mugs or carafe"]) {
    const mock = model([
      response("getCatalogOverview", { criteria: {} }),
      response("presentAnswer", { text: "There are [[count:e1:total]] products.", language: "en", evidenceIds: ["e1"], productIds: [], view: "none" }),
    ]);
    const service = { ...catalog, overview: async () => ({ total: 86 }) } as CatalogService;
    const result = await runAgent(mock.runtime.model, service, { text, userMessageId: `category-overview-${text}`, state: initialAgentState() }, new AbortController().signal, mock.runtime);
    assert.equal(result.operation.status, "completed");
    assert.equal(result.comparison, undefined);
    assert.ok(mock.requests[1].tools.some((tool: any) => tool.function.name === "getCatalogOverview"));
  }
});
test("a complete comparison survives truncated optional advice without an automatic correction", async () => {
  const mock = model([
    response("compareProducts", { productIds: ["mugs", "carafe"] }),
    response("presentAnswer", {
      text: "The cheaper option is",
      language: "en",
      evidenceIds: ["e1"],
      productIds: ["mugs", "carafe"],
      view: "comparison",
    }),
  ]);
  const result = await run(
    "Compare mugs and carafe and explain the differences",
    mock,
  );
  assert.equal(result.status.status, "complete");
  assert.equal(mock.calls(), 2);
  assert.doesNotMatch(result.answer, /option is$/);
  assert.deepEqual(result.comparison?.productIds, ["mugs", "carafe"]);
});
test("a Polish add request with harmless commentary uses the inspected product without a model", async () => {
  const mock = model();
  const result = await run("Dodaj do koszyka ten produkt, fajny jest", mock, {
    state: {
      ...initialAgentState(),
      language: "en",
      languageChosen: true,
      lastIds: ["mugs"],
      selectedIds: ["mugs"],
      resultIds: ["mugs", "carafe"],
    },
  });
  assert.equal(mock.calls(), 0);
  assert.equal(result.cart?.productId, "mugs");
  assert.equal(result.cart?.quantity, 1);
  assert.equal(result.checkpoint.after.language, "pl");
  assert.deepEqual(result.checkpoint.after.resultIds, ["mugs", "carafe"]);
});
test("operation variants cannot combine completed data with an operation error", () => {
  assert.equal(
    operationSchema.safeParse({
      id: "a",
      kind: "comparison",
      status: "completed",
      error: { status: "partial" },
    }).success,
    false,
  );
  assert.equal(
    operationTurnStatus({
      id: "a",
      kind: "cart",
      status: "awaiting-device",
      cartOperationId: "c",
    }).status,
    "complete",
  );
});
test("buffered advice rejects truncated text and provider finishes, including valid native call finishes", () => {
  for (const text of [
    "This option is",
    "The lowest price is at €",
    "This option is.",
    "The price is at €.",
    "This is an unfinished [[price:mugs]",
    "A good choice (for indoors.",
    'A good choice "for indoors.',
  ])
    assert.ok(assistantTextError(text, "tool-calls"), text);
  for (const finish of ["length", "content-filter", "error"])
    assert.ok(assistantTextError("This option suits your needs.", finish));
  assert.equal(assistantTextError("Your budget is 150 EUR."), undefined);
  assert.equal(
    assistantTextError(
      "Compare [[name:mugs]] with [[name:carafe]].",
      "tool-calls",
      "en",
    ),
    undefined,
  );
  assert.equal(
    assistantTextError("To dobry wybór do kawy.", "stop", "en"),
    "WRONG_LANGUAGE",
  );
});
test("language follows the current natural message, explicit instructions and pending confirmations", () => {
  assert.equal(
    resolveLanguage("Dodaj do koszyka ten produkt, fajny jest", "en"),
    "pl",
  );
  assert.equal(resolveLanguage("Please explain these differences", "pl"), "en");
  assert.equal(resolveLanguage("Compare these products", "pl", true), "pl");
  assert.equal(resolveLanguage("Glass carafe", "pl"), "pl");
  assert.equal(resolveLanguage("Tak", "en", false, "pl"), "pl");
  assert.equal(resolveLanguage("Please answer in English", "pl"), "en");
});
test("only a live server confirmation permits yes; selection questions and expired nonces do not", async () => {
  const conversationId = `pending-${++sequence}`;
  const pending = rememberCartIntent({
    conversationId,
    sourceMessageId: "source-add",
    sourceText: "Add mugs",
    kind: "confirm",
    productIds: ["mugs"],
    quantity: 2,
    language: "pl",
  });
  const mock = model();
  const state = {
    ...initialAgentState(),
    pendingCartIntent: pending.nonce,
    lastIds: ["mugs"],
  };
  const yes = await run("Tak", mock, { conversationId, state });
  assert.equal(yes.operation.status, "awaiting-device");
  assert.equal(yes.cart?.quantity, 2);
  assert.equal(yes.checkpoint.after.language, "pl");
  assert.equal(pendingCartIntent(conversationId, pending.nonce), undefined);
  const repeated = await run("Tak", mock, { conversationId, state });
  assert.equal(repeated.cart, undefined);
  assert.equal(repeated.operation.status, "needs-input");
  const choice = rememberCartIntent({
    conversationId,
    sourceMessageId: "choice",
    sourceText: "Add one of them",
    kind: "selection",
    productIds: ["mugs", "carafe"],
    quantity: 1,
    language: "pl",
  });
  assert.equal(
    (
      await run("Tak", mock, {
        conversationId,
        state: { ...state, pendingCartIntent: choice.nonce },
      })
    ).cart,
    undefined,
  );
  const expired = rememberCartIntent(
    {
      conversationId,
      sourceMessageId: "old",
      sourceText: "Add mugs",
      kind: "confirm",
      productIds: ["mugs"],
      quantity: 1,
      language: "pl",
    },
    Date.now() - 600_001,
  );
  assert.equal(
    (
      await run("Tak", mock, {
        conversationId,
        state: { ...state, pendingCartIntent: expired.nonce },
      })
    ).cart,
    undefined,
  );
  assert.equal(mock.calls(), 0);
  forgetCartIntent(conversationId);
});
test("ambiguous cart selection preserves quantity and rejects invalid quantities and unavailable products", async () => {
  const conversationId = `choose-${++sequence}`;
  const state = { ...initialAgentState(), lastIds: ["mugs", "carafe"] };
  const question = await run("Add two of this product to my cart", model(), {
    conversationId,
    state,
  });
  assert.equal(question.operation.status, "needs-input");
  const added = await run("Add Glass carafe to my cart", model(), {
    conversationId,
    state: question.checkpoint.after,
    action: {
      type: "cart",
      productId: "carafe",
      selection: "selected",
      quantity: 1,
    },
  });
  assert.equal(added.cart?.quantity, 2);
  for (const quantity of ["0", "1,5", "100"]) {
    const value = await run(
      `Dodaj ${quantity} sztuk tego produktu do koszyka`,
      model(),
      { state: { ...initialAgentState(), lastIds: ["mugs"] } },
    );
    assert.equal(value.cart, undefined, quantity);
  }
  const unavailable = products.find((p) => !p.inStock)!;
  assert.equal(
    (await run(`Add ${unavailable.name} to my cart`)).cart,
    undefined,
  );
});
test("advice retry targets the committed snapshot and never replays cart or catalog reads", async () => {
  const original = await run("Compare", model(), {
    action: { type: "compare", productIds: ["mugs", "carafe"] },
  });
  const mock = model([
    response("presentAnswer", {
      text: "The carafe is useful for serving drinks.",
      language: "en",
      evidenceIds: ["e1"],
      productIds: ["mugs", "carafe"],
      view: "comparison",
    }),
  ]);
  const retry = await run("Explain differences", mock, {
    state: original.checkpoint.after,
    action: { type: "advice", operationId: original.operation.id },
  });
  assert.equal(retry.operation.id, original.operation.id);
  assert.deepEqual(retry.checkpoint.after, original.checkpoint.after);
  assert.equal(retry.advice.status, "included");
  assert.equal(retry.cart, undefined);
  assert.equal(mock.calls(), 1);
});
test("an advice deadline preserves the already committed operation in the UI stream", async () => {
  let calls = 0;
  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const runtime = createGroqRuntime(
    {
      baseURL: "http://timeout/v1",
      modelId: "fixture",
      balancer: true,
      windowsTransport: false,
    },
    async (_url, init) => {
      if (++calls === 1)
        return Response.json(
          response("compareProducts", { productIds: ["mugs", "carafe"] }),
        );
      timer = setTimeout(
        () => deadline.abort(new DOMException("Test deadline", "TimeoutError")),
        20,
      );
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(init.signal.reason);
        else
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
      });
    },
  );
  const stream = createNativeAgentStream(
    runtime,
    catalog,
    {
      text: "Compare mugs and carafe",
      userMessageId: `deadline-${++sequence}`,
      state: initialAgentState(),
    },
    deadline.signal,
    { contract: "shopping-v3" },
  );
  const reader = stream.getReader(),
    events: any[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      events.push(next.value);
    }
  } finally {
    clearTimeout(timer);
  }
  assert.equal(
    events.find((e) => e.type === "data-operation")?.data.status,
    "completed",
  );
  assert.equal(
    events.find((e) => e.type === "data-turnStatus")?.data.status,
    "complete",
  );
  assert.equal(
    events.find((e) => e.type === "data-advice")?.data.status,
    "unavailable",
  );
  assert.ok(
    events.some((e) => e.type === "text-delta" && /comparison/.test(e.delta)),
  );
  assert.equal(calls, 2);
});
test("expired cart choices require quantity again and a requested confirmation is single-use", async () => {
  const state = {
    ...initialAgentState(),
    lastIds: ["mugs"],
    selectedIds: ["mugs"],
    pendingCartIntent: "missing-after-restart",
  };
  const expired = await run("Add Ceramic mugs", model(), {
    state,
    action: {
      type: "cart",
      productId: "mugs",
      selection: "selected",
      quantity: 1,
    },
  });
  assert.equal(expired.cart, undefined);
  assert.equal(expired.operation.status, "needs-input");
  if (expired.operation.status === "needs-input")
    assert.equal(expired.operation.input, "quantity");
  const conversationId = `confirm-${++sequence}`;
  const requested = await run(
    "Add two Ceramic mugs to my cart, ask me to confirm first",
    model(),
    { conversationId, state: { ...initialAgentState(), lastIds: ["mugs"] } },
  );
  assert.equal(requested.cart, undefined);
  assert.equal(requested.operation.status, "needs-input");
  const confirmed = await run("Yes", model(), {
    conversationId,
    state: requested.checkpoint.after,
  });
  assert.equal(confirmed.cart?.quantity, 2);
  const refused = await run("No", model(), {
    conversationId,
    state: requested.checkpoint.after,
  });
  assert.equal(refused.cart, undefined);
});
test("plain advice cannot execute a second catalog operation", async () => {
  const original = await run("Compare", model(), {
    action: { type: "compare", productIds: ["mugs", "carafe"] },
  });
  const mock = model([
    response("getProductDetails", { productId: "travel-mug" }),
  ]);
  const result = await runAgent(
    mock.runtime.model,
    catalog,
    {
      text: "Explain differences",
      userMessageId: `stable-${++sequence}`,
      state: original.checkpoint.after,
      action: { type: "advice", operationId: original.operation.id },
    },
    new AbortController().signal,
    mock.runtime,
  );
  assert.deepEqual(result.checkpoint.after, original.checkpoint.after);
  assert.deepEqual(result.comparison, original.comparison);
  assert.equal(result.advice.status, "unavailable");
  assert.equal(
    result.evidence.some((e) => e.tool === "getProductDetails"),
    false,
  );
});
test("a failed Polish question still establishes language for the next English UI action", () => {
  const state = stateFromMessages(
    [
      {
        id: "pl-user",
        role: "user",
        parts: [{ type: "text", text: "Pisz po polsku. Szukam kawy." }],
      },
      {
        id: "failed",
        role: "assistant",
        parts: [
          {
            type: "data-turnStatus",
            data: { status: "connection-error", code: "NETWORK_ERROR" },
          },
        ],
      },
      {
        id: "current",
        role: "user",
        parts: [{ type: "text", text: "Compare mugs and carafe" }],
        metadata: {
          shoppingAction: { type: "compare", productIds: ["mugs", "carafe"] },
        },
      },
    ],
    "current",
  );
  assert.equal(state.language, "pl");
});
test("yes to a product-choice question preserves its quantity, expiry and source request", async () => {
  const conversationId = `ambiguous-yes-${++sequence}`;
  const first = await run(
    "Dodaj dwie sztuki tego produktu do koszyka",
    model(),
    {
      conversationId,
      state: { ...initialAgentState(), lastIds: ["mugs", "carafe"] },
    },
  );
  const original = pendingCartIntent(
    conversationId,
    first.checkpoint.after.pendingCartIntent,
  )!;
  const repeated = await run("Tak", model(), {
    conversationId,
    state: first.checkpoint.after,
  });
  assert.equal(repeated.cart, undefined);
  assert.deepEqual(
    pendingCartIntent(
      conversationId,
      repeated.checkpoint.after.pendingCartIntent,
    ),
    original,
  );
  const chosen = await run("Add Glass carafe", model(), {
    conversationId,
    state: repeated.checkpoint.after,
    action: {
      type: "cart",
      selection: "selected",
      productId: "carafe",
      quantity: 1,
    },
  });
  assert.equal(chosen.cart?.quantity, 2);
});
test("plain advice receives only qualitative facts without raw prices or measurements", async () => {
  const original = await run("Compare", model(), {
    action: { type: "compare", productIds: ["mugs", "carafe"] },
  });
  const mock = model([
    response("presentAnswer", {
      text: "The mugs suit hot drinks, while the carafe serves cold brew.",
      language: "en",
      view: "comparison",
      evidenceIds: ["e1"],
      productIds: ["mugs", "carafe"],
    }),
  ]);
  const advised = await run("Explain differences", mock, {
    state: original.checkpoint.after,
    action: { type: "advice", operationId: original.operation.id },
  });
  assert.equal(advised.advice.status, "included");
  const context = mock.requests[0].messages.find(
    (m: any) => m.role === "user",
  ).content;
  assert.match(context, /handles for hot drinks/);
  assert.match(context, /Glass can break if dropped/);
  assert.doesNotMatch(context, /priceReference|dimensionsReference/);
  assert.equal(mock.requests[0].tools, undefined);
  assert.doesNotMatch(
    context,
    /priceEUR|25 cm high|9 cm high|differencesCents/,
  );
  assert.equal(mock.requests[0].max_tokens, 192);
});
test("policy advice restores its completed read after process-cache loss without another catalog call", async () => {
  const policy = await run("Delivery", model(), {
    action: { type: "policy", topic: "delivery" },
  });
  assert.deepEqual(policy.checkpoint.readResult, {
    kind: "policy",
    topic: "delivery",
  });
  const restored = adviceResultFromMessages(
    [
      {
        id: "stored-policy",
        role: "assistant",
        parts: [
          { type: "text", text: policy.answer },
          {
            type: "data-operation",
            data: { ...policy.operation, id: "restored-policy-operation" },
          },
          { type: "data-shoppingState", data: policy.checkpoint },
        ],
      },
    ],
    "restored-policy-operation",
  );
  assert.ok(restored);
  assert.equal(restored.presentation.view, "none");
  const mock = model([
    response("presentAnswer", {
      text: "The delivery policy applies to this demo collection.",
      language: "en",
      view: "none",
      evidenceIds: ["restored"],
      productIds: [],
    }),
  ]);
  const result = await run("Explain the policy", mock, {
    adviceFor: restored,
    action: { type: "advice", operationId: restored.operation.id },
    state: policy.checkpoint.after,
  });
  assert.equal(result.advice.status, "included");
  assert.equal(result.operation.id, "restored-policy-operation");
  assert.equal(mock.calls(), 1);
});
test("canonical measurement references do not establish an unmeasured size comparison", async () => {
  const source = await run("Compare", model(), {
    action: { type: "compare", productIds: ["mugs", "carafe"] },
  });
  const mock = model([
    response("presentAnswer", {
      text: "The carafe occupies less space [[dimensions:carafe]] than the larger mugs [[dimensions:mugs]].",
      language: "en",
      view: "comparison",
      evidenceIds: ["e1"],
      productIds: ["mugs", "carafe"],
    }),
  ]);
  const result = await run("Explain differences", mock, {
    state: source.checkpoint.after,
    action: { type: "advice", operationId: source.operation.id },
  });
  assert.equal(result.operation.status, "completed");
  assert.equal(result.advice.status, "unavailable");
  assert.equal(mock.calls(), 1);
});
test("a completed policy read survives a provider failure during adaptive continuation", async () => {
  const mock = model([response("getPolicy", { topic: "delivery" })]);
  const result = await run("How much is delivery?", mock);
  assert.equal(result.operation.status, "completed");
  assert.equal(result.operation.kind, "policy");
  assert.equal(result.advice.status, "unavailable");
  assert.match(result.answer, /delivery costs EUR 4/);
  assert.equal(mock.calls(), 2);
});
test("cheapest cart selection still uses its retained group after inspecting one item", async () => {
  const result = await run(
    "Add two of the cheaper option to my cart",
    model(),
    {
      state: {
        ...initialAgentState(),
        lastIds: ["mugs"],
        selectedIds: ["mugs"],
        resultIds: ["mugs", "carafe"],
        comparisonIds: ["mugs", "carafe"],
      },
    },
  );
  assert.equal(result.cart?.productId, "carafe");
  assert.equal(result.cart?.quantity, 2);
});
test("an unknown operand with invalid units creates a selection question, not a quantity authorization", async () => {
  const conversationId = `unknown-units-${++sequence}`;
  const first = await run("Add 0 unicorns to my cart", model(), {
    conversationId,
    state: { ...initialAgentState(), lastIds: ["mugs"], selectedIds: ["mugs"] },
  });
  assert.equal(first.cart, undefined);
  assert.equal(
    pendingCartIntent(conversationId, first.checkpoint.after.pendingCartIntent)
      ?.kind,
    "selection",
  );
});
test("a new untrusted confirmation clears the prior server question", async () => {
  const conversationId = `missing-ref-${++sequence}`;
  const old = rememberCartIntent({
    conversationId,
    sourceMessageId: "old-request",
    sourceText: "Add mugs",
    kind: "confirm",
    productIds: ["mugs"],
    quantity: 2,
    language: "en",
  });
  const result = await run("Yes", model(), {
    conversationId,
    state: initialAgentState(),
  });
  assert.equal(result.cart, undefined);
  assert.equal(pendingCartIntent(conversationId, old.nonce), undefined);
});
test("an unavailable cart item offers available choices from the retained group",async()=>{
  const unavailable=products.find((p)=>!p.inStock)!;
  const result=await run("Add this product to my cart",model(),{state:{...initialAgentState(),lastIds:[unavailable.id],selectedIds:[unavailable.id],resultIds:[unavailable.id,"mugs","carafe"]}});
  assert.equal(result.cart,undefined);
  assert.equal(result.operation.status,"needs-input");
  if(result.operation.status==="needs-input")assert.deepEqual(result.operation.choices,["mugs","carafe"]);
});
