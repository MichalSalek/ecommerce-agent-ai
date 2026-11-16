import { test } from "node:test";
import assert from "node:assert/strict";
import { products } from "../src/data/products";
import { initialAgentState } from "../src/application/chat/shopping-v3";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import {
  runAgent,
  createNativeAgentStream,
  stateFromMessages,
} from "../src/infrastructure/chat/native-agent";
import type { CatalogService } from "../src/application/catalog/catalog-service";
import {
  assistantTextError,
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
  const runtime = createGroqRuntime(
    {
      baseURL: "http://fixture/v1",
      modelId: "fixture",
      balancer: true,
      windowsTransport: false,
    },
    async () => {
      const response = responses[calls++];
      if (!response) return new Response("unavailable", { status: 503 });
      return Response.json(response);
    },
  );
  return { runtime, calls: () => calls };
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
    AbortSignal.timeout(80),
    { contract: "shopping-v3" },
  );
  const reader = stream.getReader(),
    events: any[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    events.push(next.value);
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
test("stable local advice schema cannot execute a second catalog operation", async () => {
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
    { ...mock.runtime, stableAdviceTools: true },
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
