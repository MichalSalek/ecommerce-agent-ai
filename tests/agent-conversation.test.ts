import { test } from "node:test";
import assert from "node:assert/strict";
import { products } from "../src/data/products";
import { groundedDetailAnswer } from "../src/application/chat/detail-response";
import { conversationContext } from "../src/application/chat/conversation-context";
import { initialAgentState } from "../src/application/chat/shopping-v3";
import type { CatalogService } from "../src/application/catalog/catalog-service";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import { createNativeAgentStream, runAgent } from "../src/infrastructure/chat/native-agent";

type Step = { name: string; input: unknown };
function scripted(steps: Step[]) {
  const requests: any[] = [];
  const runtime = createGroqRuntime({ baseURL: "http://127.0.0.1:8787/v1", modelId: "test", apiKey: "fixture-only" }, async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const step = steps[requests.length - 1];
    assert.ok(step, "unexpected provider call");
    return Response.json({ id: `completion-${requests.length}`, model: "test", created: 0, object: "chat.completion", choices: [{ index: 0, message: !body.tools?.length ? { role: "assistant", content: (step.input as { text: string }).text } : { role: "assistant", content: null, tool_calls: [{ id: `call-${requests.length}`, type: "function", function: { name: step.name, arguments: JSON.stringify(step.input) } }] }, finish_reason: !body.tools?.length ? "stop" : "tool_calls" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
  });
  return { runtime, requests };
}
const unusedCatalog = {} as CatalogService;
const answer = (text: string, language: "pl" | "en") => ({ name: "presentAnswer", input: { text, language, evidenceIds: ["e1"], productIds: [], view: "none" } });

test("typed capabilities call the provider, use the capabilities tool and emit no product cards", async () => {
  for (const [request, reply, language] of [
    ["W czym możesz mi pomóc?", "Mogę Ci pomóc znaleźć i porównać produkty oraz sprawdzić zasady dostawy.", "pl"],
    ["What can you help me with?", "I can help you find and compare products and check delivery policies.", "en"],
  ] as const) {
    const mock = scripted([{ name: "getShoppingCapabilities", input: {} }, answer(reply, language)]);
    const result = await runAgent(mock.runtime.model, unusedCatalog, { text: request, userMessageId: `capability-${language}`, state: initialAgentState() }, new AbortController().signal, mock.runtime);
    assert.equal(mock.requests.length, 2);
    assert.equal(result.answer, reply);
    assert.equal(result.status.status, "complete");
    assert.equal(result.presentation.view, "none");
    assert.deepEqual(result.presentation.productIds, []);
    assert.equal(result.evidence[0].tool, "getShoppingCapabilities");
    assert.ok(mock.requests[1].messages.some((m: any) => m.role === "tool" && String(m.content).includes("delivery")));
  }
});

test("reversed Polish perspective is rejected and corrected through the provider", async () => {
  const mock = scripted([{ name: "getShoppingCapabilities", input: {} }, answer("Możesz mi pomóc wybrać produkty.", "pl"), answer("Mogę Ci pomóc wybrać produkty.", "pl")]);
  const result = await runAgent(mock.runtime.model, unusedCatalog, { text: "W czym możesz mi pomóc?", userMessageId: "perspective", state: initialAgentState() }, new AbortController().signal, mock.runtime);
  assert.equal(mock.requests.length, 3);
  assert.equal(result.answer, "Mogę Ci pomóc wybrać produkty.");
});

test("a fresh conversation answers a recalled budget in one provider call without inventing an amount", async () => {
  for (const [request, reply] of [
    ["Czy pamiętasz mój wcześniejszy budżet?", "W tej rozmowie nie mam jeszcze Twojego budżetu. Do jakiej kwoty szukamy?"],
    ["Do you remember my previous budget?", "You haven’t told me your budget in this conversation. How much would you like to spend?"],
  ]) {
    const mock = scripted([{ name: "getShoppingCapabilities", input: { answer: reply } }]);
    const result = await runAgent(mock.runtime.model, unusedCatalog, { text: request, userMessageId: "recall-new-budget", state: initialAgentState() }, new AbortController().signal, mock.runtime);
    assert.equal(result.answer, reply);
    const [upstream] = mock.requests;
    assert.equal(upstream.tool_choice.function.name, "getShoppingCapabilities");
    assert.deepEqual(upstream.messages.map((m: { role: string }) => m.role), ["system", "user"]);
    assert.match(upstream.messages[0].content, /fresh conversation contains no earlier budget/);
  }
});

test("budget recall in an active conversation uses its supplied preference", async () => {
  const reply = "Twój budżet wynosi 43 EUR.";
  const mock = scripted([{ name: "presentAnswer", input: { text: reply, language: "pl", evidenceIds: ["preferences"], productIds: [], view: "none" } }]);
  const state = { ...initialAgentState(), criteria: { maxPrice: 43 } };
  const result = await runAgent(mock.runtime.model, unusedCatalog, { text: "Czy pamiętasz mój wcześniejszy budżet?", userMessageId: "recall-active-budget", state, history: [{ role: "user", content: "Szukam kubka do 43 EUR." }] }, new AbortController().signal, mock.runtime);
  assert.equal(result.answer, reply);
  assert.equal(mock.requests[0].tool_choice, "required");
  assert.doesNotMatch(mock.requests[0].messages[0].content, /fresh conversation contains no earlier budget/);
});

test("history retains roles, bounds and canonical prior groups", () => {
  const known = products[0];
  const context = conversationContext(Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: `turn-${i}` })), [{ userText: "Earlier choice", productIds: [known.id, "unknown", known.id] }]);
  assert.equal(context.messages.length, 12);
  assert.equal(context.messages[0].content, "turn-8");
  assert.equal(context.messages[1].role, "assistant");
  assert.deepEqual(context.priorGroups[0].products.map((p) => p.id), [known.id]);
});

test("provider receives separate prior roles and canonical older product records", async () => {
  const known = products[0];
  const mock = scripted([{ name: "getShoppingCapabilities", input: {} }, answer("I can help you find products.", "en")]);
  await runAgent(mock.runtime.model, unusedCatalog, { text: "What can you help with?", userMessageId: "context", state: initialAgentState(), history: [{ role: "user", content: "Earlier search" }, { role: "assistant", content: "Earlier answer" }], priorProductGroups: [{ userText: "Earlier search", productIds: [known.id, "unknown"] }] }, new AbortController().signal, mock.runtime);
  const messages = mock.requests[0].messages;
  assert.ok(messages.some((m: any) => m.role === "assistant" && m.content === "Earlier answer"));
  const current = messages.findLast((m: any) => m.role === "user").content;
  assert.ok(current.includes(known.name));
  assert.ok(!current.includes('"unknown"'));
});

test("cancelled stream emits one terminal log without customer text or raw IDs", async () => {
  const controller = new AbortController();
  controller.abort();
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const mock = scripted([]);
    const stream = createNativeAgentStream(mock.runtime, unusedCatalog, { text: "private customer text", userMessageId: "private-message-id", conversationId: "private-conversation-id", state: initialAgentState() }, controller.signal, { contract: "shopping-v3" });
    const reader = stream.getReader();
    while (!(await reader.read()).done) { /* drain */ }
    const terminal = logs.filter((line) => line.startsWith("[AGENT] terminal"));
    assert.equal(terminal.length, 1);
    assert.match(terminal[0], /"status":"cancelled"/);
    assert.doesNotMatch(terminal[0], /private/);
  } finally { console.log = original; }
});

test("specific help choosing a mug follows shopping search and budget", async () => {
  const mug = products.find((p) => p.id === "mugs")!;
  const seen: any[] = [];
  const catalog = {
    overview: async () => ({ total: 1 }),
    searchResult: async (criteria: unknown) => {
      seen.push(criteria);
      return { products: [mug], totalMatches: 1, unseenMatches: 1, matchedIds: [mug.id] };
    },
  } as unknown as CatalogService;
  const mock = scripted([{ name: "searchProducts", input: { mode: "recommend", operation: "new", language: "pl", criteria: { query: "mug", maxPrice: 25 }, continueWith: "presentAnswer" } }, answer("To jedna z dostępnych opcji.", "pl")]);
  const result = await runAgent(mock.runtime.model, catalog, { text: "Pomóż mi wybrać kubek do 25 euro", userMessageId: "specific-help-mug", state: initialAgentState() }, new AbortController().signal, mock.runtime);
  assert.equal(mock.requests.length, 2);
  assert.equal(seen[0].maxPrice, 25);
  assert.equal(result.operation.kind, "search");
  assert.equal(result.presentation.view, "products");
  assert.deepEqual(result.presentation.productIds, [mug.id]);
});

test("return to an earlier group resolves a canonical detail, not the latest group", async () => {
  const old = products.find((p) => p.id === "mugs")!;
  const current = products.find((p) => p.id === "carafe")!;
  const details: string[] = [];
  const catalog = { details: async (id: string) => { details.push(id); return products.find((p) => p.id === id); } } as unknown as CatalogService;
  const state = initialAgentState();
  state.lastIds = [current.id];
  state.resultIds = [current.id];
  const mock = scripted([{ name: "getProductDetails", input: { productId: old.id } }, answer("Here are the verified details.", "en")]);
  const result = await runAgent(mock.runtime.model, catalog, { text: "Go back to the earlier mugs", userMessageId: "return-older-choice", state, priorProductGroups: [{ userText: "Find mugs", productIds: [old.id] }, { userText: "Show carafe", productIds: [current.id] }] }, new AbortController().signal, mock.runtime);
  assert.deepEqual(details, [old.id]);
  assert.equal(result.operation.kind, "details");
  assert.deepEqual(result.presentation.productIds, [old.id]);
});

test("incomplete provider result emits a partial terminal record", async () => {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const invalid = answer("An incomplete sentence", "en");
    const mock = scripted([invalid, invalid]);
    const stream = createNativeAgentStream(mock.runtime, unusedCatalog, { text: "private test request", userMessageId: "private-test-id", state: initialAgentState() }, new AbortController().signal, { contract: "shopping-v3" });
    const reader = stream.getReader();
    while (!(await reader.read()).done) { /* drain */ }
    const terminal = logs.filter((line) => line.startsWith("[AGENT] terminal"));
    assert.equal(terminal.length, 1);
    assert.match(terminal[0], /"status":"partial"/);
    assert.match(terminal[0], /"code":"MODEL_RESPONSE_INCOMPLETE"/);
    assert.doesNotMatch(terminal[0], /private/);
  } finally { console.log = original; }
});

test("capability correction rejects reversed English while truthful limits remain allowed", async () => {
  const mock = scripted([
    { name: "getShoppingCapabilities", input: {} },
    answer("You can help me choose products.", "en"),
    answer("I can help you choose products, but I cannot place an order.", "en"),
  ]);
  const result = await runAgent(mock.runtime.model, unusedCatalog, { text: "What can you do?", userMessageId: "english-perspective", state: initialAgentState() }, new AbortController().signal, mock.runtime);
  assert.equal(mock.requests.length, 3);
  assert.equal(result.status.status, "complete");
  assert.match(result.answer, /I can help you/);
  assert.match(result.answer, /cannot place an order/);
});

test("attempt IDs correlate inference, usage and terminal events across a cached retry", async () => {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const mock = scripted([{ name: "getShoppingCapabilities", input: {} }, answer("I can help you find products.", "en")]);
    const turn = { text: "What can you help with?", userMessageId: "attempt-correlation", conversationId: "attempt-correlation", state: initialAgentState() };
    for (const attemptId of ["first-attempt", "retry-attempt"]) {
      const stream = createNativeAgentStream(mock.runtime, unusedCatalog, turn, new AbortController().signal, { contract: "shopping-v3", attemptId });
      const reader = stream.getReader();
      while (!(await reader.read()).done) { /* drain */ }
    }
    const parse = (prefix: string) => logs.filter((line) => line.startsWith(prefix)).map((line) => JSON.parse(line.slice(prefix.length).trim()));
    const terminal = parse("[AGENT] terminal");
    const inference = parse("[AGENT] inference");
    const usage = parse("[AGENT] usage");
    assert.deepEqual(terminal.map((record) => record.attemptId), ["first-attempt", "retry-attempt"]);
    assert.equal(terminal[0].operationId, terminal[1].operationId);
    assert.equal(inference.length, 2);
    assert.ok(inference.every((record) => record.attemptId === "first-attempt" && record.reportedModelId === "test" && record.operationId === terminal[0].operationId));
    assert.equal(usage[0].attemptId, "first-attempt");
    assert.equal(usage[0].operationId, terminal[0].operationId);
    assert.equal(mock.requests.length, 2);
  } finally { console.log = original; }
});

test("general capabilities complete with one provider-generated tool call in PL and EN", async () => {
  for (const [request, reply, language] of [
    ["W czym możesz mi pomóc?", "Mogę pomóc znaleźć produkt, porównać propozycje i sprawdzić zasady dostawy.", "pl"],
    ["What can you do for me?", "I can help you find and compare products and explain the delivery policy.", "en"],
  ] as const) {
    const mock = scripted([{ name: "getShoppingCapabilities", input: { answer: reply } }]);
    const result = await runAgent(mock.runtime.model, unusedCatalog, { text: request, userMessageId: `one-call-capabilities-${language}`, state: initialAgentState() }, new AbortController().signal, mock.runtime);
    assert.equal(mock.requests.length, 1);
    assert.equal(result.answer, reply);
    assert.equal(result.status.status, "complete");
    assert.equal(result.operation.kind, "conversation");
    assert.equal(result.presentation.view, "none");
    assert.deepEqual(result.presentation.productIds, []);
    assert.deepEqual(result.evidence.map((item) => item.tool), ["getShoppingCapabilities"]);
    const tool = mock.requests[0].tools.find((item: any) => item.function.name === "getShoppingCapabilities");
    assert.match(tool.function.description, /role, data access/);
    const profile = mock.requests[0].messages.find((message: any) => message.role === "system").content;
    assert.match(profile, /Find and refine Aurelle products/);
    assert.match(profile, /no external store or web search.*checkout/);
  }
});

test("invalid generated capabilities produce a truthful fallback after one call", async () => {
  for (const [language, input] of [
    ["pl", "Możesz mi pomóc wybrać produkty."],
    ["en", "You can help me choose products."],
    ["en", "I can place an order and track an order."],
    ["pl", "Mogę składać zamówienia i śledzić twoje zamówienia."],
    ["en", "I can help you get a discount for free."],
    ["en", "I can help you choose products"],
    ["en", ""],
  ] as const) {
    const mock = scripted([{ name: "getShoppingCapabilities", input: { answer: input } }]);
    const request = language === "pl" ? "W czym możesz mi pomóc?" : "What can you do?";
    const result = await runAgent(mock.runtime.model, unusedCatalog, { text: request, userMessageId: `one-call-invalid-${language}-${input}`, state: initialAgentState() }, new AbortController().signal, mock.runtime);
    assert.equal(mock.requests.length, 1);
    assert.equal(result.status.status, "complete");
    assert.equal(result.presentation.view, "none");
    assert.deepEqual(result.presentation.productIds, []);
    assert.equal(result.answer, language === "pl" ? "Mogę pomóc znaleźć i porównać produkty oraz sprawdzić zasady dostawy i zwrotów." : "I can help you find and compare products and check delivery and returns policies.");
  }
});

test("one-call capabilities retain truthful limitations and work across stream contracts", async () => {
  for (const contract of ["shopping-v2", "shopping-v3"] as const) {
    const reply = "I can help you find products, but I cannot place an order.";
    const mock = scripted([{ name: "getShoppingCapabilities", input: { answer: reply } }]);
    const stream = createNativeAgentStream(mock.runtime, unusedCatalog, { text: "What can you do?", userMessageId: `capability-contract-${contract}`, state: initialAgentState() }, new AbortController().signal, { contract });
    const reader = stream.getReader();
    const events: any[] = [];
    for (;;) { const part = await reader.read(); if (part.done) break; events.push(part.value); }
    assert.equal(mock.requests.length, 1);
    assert.equal(events.find((event) => event.type === "text-delta")?.delta, reply);
    assert.ok(!events.some((event) => event.type === "data-products" || event.toolName === "searchProducts"));
  }
});

test("detail questions answer recorded fields and honestly handle unknown attributes", async () => {
  const catalog = { details: async (id: string) => products.find((p) => p.id === id) } as unknown as CatalogService;
  const cases: { id: string; question: string; expected: RegExp; semantic?: boolean }[] = [
    { id: "carafe", question: "A teraz wróć do Glass carafe. Jaka jest maksymalna temperatura, którą wytrzymuje karafka?", semantic: true, expected: /nie potrafię potwierdzić, jaką temperaturę wytrzymuje/i },
    { id: "carafe", question: "Jakie wymiary ma Glass carafe?", expected: /25 cm wysokości/ },
    { id: "carafe", question: "Z czego zrobiona jest Glass carafe?", expected: /Materiał podany w katalogu: szkło/ },
    { id: "travel-mug", question: "Jaka jest pojemność Travel mug?", expected: /350 ml/ },
    { id: "carafe", question: "Jaka jest pojemność Glass carafe?", semantic: true, expected: /nie potrafię potwierdzić/i },
    { id: "carafe", question: "Ile kosztuje Glass carafe?", expected: /19\.00 EUR/ },
    { id: "carafe", question: "How much is the Glass carafe?", expected: /EUR 19\.00/ },
    { id: "carafe", question: "Jaka jest cena i czy karafka jest żaroodporna?", expected: /Nie potrafię potwierdzić pozostałych/ },
    { id: "carafe", question: "What is the maximum temperature of the Glass carafe?", semantic: true, expected: /I cannot confirm the temperature/ },
    { id: "carafe", question: "How much does the Glass carafe weigh?", semantic: true, expected: /I cannot confirm the answer/ },
  ];
  const outdoor = products.find((p) => p.productKind === "furniture" && p.useEnvironment === "outdoor")!;
  assert.ok(outdoor);
  cases.push({ id: outdoor.id, question: `Jaki jest udźwig produktu ${outdoor.name}?`, semantic: true, expected: /maksymalnego obciążenia/i });
  for (const [index, item] of cases.entries()) {
    const semantic = item.semantic ?? false;
    const mock = scripted([
      { name: "getProductDetails", input: { productId: item.id, requestedFact: "temperature verified" } },
      ...(semantic ? [{ name: "answerProductQuestion", input: { status: "missing", answer: "" } }] : []),
    ]);
    const result = await runAgent(mock.runtime.model, catalog, { text: item.question, userMessageId: `detail-factual-${index}`, state: initialAgentState() }, new AbortController().signal, mock.runtime);
    assert.equal(mock.requests.length, semantic ? 2 : 1, item.question);
    assert.equal(result.status.status, "complete", item.question);
    assert.equal(result.operation.kind, "details");
    assert.equal(result.presentation.view, "products");
    assert.deepEqual(result.presentation.productIds, [item.id]);
    assert.match(result.answer, item.expected, item.question);
    assert.equal(result.advice.status, "not-requested");
  }
});

test("Polish general detail summary uses Polish explanatory prose", async () => {
  const catalog = { details: async (id: string) => products.find((p) => p.id === id) } as unknown as CatalogService;
  const mock = scripted([{ name: "getProductDetails", input: { productId: "carafe" } }, answer("Możesz sprawdzić szczegóły na karcie produktu.", "pl")]);
  const result = await runAgent(mock.runtime.model, catalog, { text: "Pokaż szczegóły Glass carafe", userMessageId: "detail-polish-summary", state: initialAgentState() }, new AbortController().signal, mock.runtime);
  assert.equal(result.answer, "Szczegóły produktu Glass carafe znajdziesz na karcie poniżej.");
  assert.doesNotMatch(result.answer, /Brew|narrow neck|Glass can break/);
});


test("free-text detail answers cite an exact canonical feature or limitation", async () => {
  const catalog = { details: async (id: string) => products.find((p) => p.id === id) } as unknown as CatalogService;
  const cases = [
    { question: "Czy składane krzesło da się złożyć do transportu?", answer: "Tak, krzesło ma składaną ramę.", source: "features", quote: "folding frame" },
    { question: "Czy to krzesło jest sprzedawane osobno?", answer: "Tak, krzesło jest sprzedawane pojedynczo.", source: "limitations", quote: "Sold individually" },
  ];
  for (const [index, item] of cases.entries()) {
    const mock = scripted([{ name: "getProductDetails", input: { productId: "folding-garden-chair" } }, { name: "answerProductQuestion", input: { status: "supported", answer: item.answer, source: item.source, quote: item.quote } }]);
    const result = await runAgent(mock.runtime.model, catalog, { text: item.question, userMessageId: `grounded-detail-${index}`, state: initialAgentState() }, new AbortController().signal, mock.runtime);
    assert.equal(mock.requests.length, 2);
    assert.equal(result.answer, item.answer);
    assert.equal(result.operation.status, "completed");
    assert.deepEqual(result.presentation.productIds, ["folding-garden-chair"]);
    const context = JSON.parse(mock.requests[1].messages.find((m: any) => m.role === "user").content);
    assert.ok(context.records[0].description);
    assert.ok(context.records[0].dimensions);
    assert.ok(context.records[0].features.includes("folding frame"));
  }
});

test("fabricated excerpts and uncited numeric claims retain a safe detail result", async () => {
  const catalog = { details: async (id: string) => products.find((p) => p.id === id) } as unknown as CatalogService;
  const proposals = [
    { status: "supported", answer: "Krzesło wytrzymuje 150 kg.", source: "features", quote: "150 kg load capacity" },
    { status: "supported", answer: "Krzesło wytrzymuje 150 kg.", source: "features", quote: "folding frame" },
    { status: "supported", answer: "Krzesło ma składaną ramę.", source: "limitations", quote: "folding frame" },
  ];
  for (const [index, proposal] of proposals.entries()) {
    const mock = scripted([{ name: "getProductDetails", input: { productId: "folding-garden-chair" } }, { name: "answerProductQuestion", input: proposal }]);
    const result = await runAgent(mock.runtime.model, catalog, { text: "Jaki udźwig ma krzesło?", userMessageId: `invalid-grounded-detail-${index}`, state: initialAgentState() }, new AbortController().signal, mock.runtime);
    assert.equal(result.operation.status, "completed");
    assert.equal(result.advice.status, "unavailable");
    assert.match(result.answer, /nie potrafię potwierdzić/i);
    assert.doesNotMatch(result.answer, /150/);
    assert.deepEqual(result.presentation.productIds, ["folding-garden-chair"]);
  }
});

test("a Polish general detail request continues to optional advice", async () => {
  const catalog = { details: async (id: string) => products.find((p) => p.id === id) } as unknown as CatalogService;
  const mock = scripted([{ name: "getProductDetails", input: { productId: "carafe" } }, answer("Karafka ma wąską szyjkę.", "pl")]);
  const result = await runAgent(mock.runtime.model, catalog, { text: "Powiedz mi więcej o Glass carafe.", userMessageId: "polish-general-details", state: initialAgentState() }, new AbortController().signal, mock.runtime);
  assert.equal(mock.requests.length, 2);
  assert.equal(result.advice.status, "included");
  assert.match(result.answer, /Szczegóły produktu Glass carafe/);
});


test("quota failure during semantic detail keeps the product and localized uncertainty", async () => {
  const catalog = { details: async (id: string) => products.find((p) => p.id === id) } as unknown as CatalogService;
  let calls = 0;
  const runtime = createGroqRuntime({ baseURL: "http://127.0.0.1:8787/v1", modelId: "test", apiKey: "fixture-only" }, async () => {
    calls++;
    if (calls > 1) return Response.json({ error: { message: "quota" } }, { status: 429, headers: { "retry-after": "60" } });
    return Response.json({ id: "detail-first", model: "test", created: 0, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "detail-first-call", type: "function", function: { name: "getProductDetails", arguments: JSON.stringify({ productId: "folding-garden-chair" }) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
  });
  const result = await runAgent(runtime.model, catalog, { text: "Jaki udźwig ma krzesło?", userMessageId: "grounded-detail-quota", state: initialAgentState() }, new AbortController().signal, runtime);
  assert.equal(calls, 2);
  assert.equal(result.operation.status, "completed");
  assert.equal(result.status.status, "complete");
  assert.equal(result.advice.status, "unavailable");
  assert.match(result.answer, /nie potrafię potwierdzić/i);
  assert.deepEqual(result.presentation.productIds, ["folding-garden-chair"]);
});


test("a matching numeral does not authorize a different measurement unit", () => {
  const product = products.find((p) => p.id === "carafe")!;
  assert.equal(groundedDetailAnswer(product, { status: "supported", answer: "It weighs 25 kg.", source: "dimensions", quote: "25 cm high" }), undefined);
  assert.equal(groundedDetailAnswer(product, { status: "supported", answer: "It is 25 cm high.", source: "dimensions", quote: "25 cm high" }), "It is 25 cm high.");
});


test("detail evidence keeps the entire limitation and description sentence with their polarity", () => {
  const sleeve = products.find((product) => product.id === "laptop-sleeve")!;
  const carafe = products.find((product) => product.id === "carafe")!;
  assert.equal(groundedDetailAnswer(sleeve, { status: "supported", answer: "Pokrowiec jest wodoodporny.", source: "limitations", quote: "waterproof" }), undefined);
  assert.equal(groundedDetailAnswer(sleeve, { status: "supported", answer: "Pokrowiec jest wodoodporny.", source: "limitations", quote: "Not waterproof" }), undefined);
  assert.equal(groundedDetailAnswer(sleeve, { status: "supported", answer: "Pokrowiec nie jest wodoodporny.", source: "limitations", quote: "Not waterproof" }), "Pokrowiec nie jest wodoodporny.");
  assert.equal(groundedDetailAnswer(carafe, { status: "supported", answer: "Karafka nadaje się do gorących napojów.", source: "description", quote: "Brew and serve cold brew coffee in this glass carafe." }), undefined);
  assert.equal(groundedDetailAnswer(carafe, { status: "supported", answer: "Karafka nadaje się do gorących napojów.", source: "description", quote: "cold brew" }), undefined);
  assert.equal(groundedDetailAnswer(carafe, { status: "supported", answer: "Karafka służy do podawania kawy parzonej na zimno.", source: "description", quote: "Brew and serve cold brew coffee in this glass carafe." }), "Karafka służy do podawania kawy parzonej na zimno.");
  assert.equal(groundedDetailAnswer(carafe, { status: "supported", answer: "Karafka utrzyma duże obciążenie.", source: "description", quote: "Brew and serve cold brew coffee in this glass carafe." }), undefined);
});

test("semantic detail questions can cite canonical product type and environment", async () => {
  const product = products.find((p) => p.id === "folding-garden-chair")!;
  assert.equal(product.useEnvironment, "outdoor");
  const catalog = { details: async (id: string) => products.find((p) => p.id === id) } as unknown as CatalogService;
  const mock = scripted([{ name: "getProductDetails", input: { productId: product.id } }, { name: "answerProductQuestion", input: { status: "supported", answer: "Tak, krzesło nadaje się na zewnątrz.", source: "useEnvironment", quote: "outdoor" } }]);
  const result = await runAgent(mock.runtime.model, catalog, { text: "Czy to krzesło nadaje się na zewnątrz?", userMessageId: "canonical-environment", state: initialAgentState() }, new AbortController().signal, mock.runtime);
  assert.equal(result.answer, "Tak, krzesło nadaje się na zewnątrz.");
  const context = JSON.parse(mock.requests[1].messages.find((m: any) => m.role === "user").content);
  assert.equal(context.records[0].useEnvironment, "outdoor");
  assert.equal(context.records[0].productType, product.productType);
});

test("mixed factual requests retain a known dimension while admitting an unknown rating", async () => {
  const catalog = { details: async (id: string) => products.find((p) => p.id === id) } as unknown as CatalogService;
  const mock = scripted([{ name: "getProductDetails", input: { productId: "carafe" } }]);
  const result = await runAgent(mock.runtime.model, catalog, { text: "Jakie wymiary ma karafka i jaką temperaturę wytrzymuje?", userMessageId: "mixed-known-unknown", state: initialAgentState() }, new AbortController().signal, mock.runtime);
  assert.equal(mock.requests.length, 1);
  assert.match(result.answer, /25 cm wysokości/);
  assert.match(result.answer, /Nie potrafię potwierdzić pozostałych informacji/);
});

test("a single named lookup honors its promised detail read without another interpretation", async () => {
  const carafe = products.find((p) => p.id === "carafe")!;
  const searches: any[] = [];
  const details: string[] = [];
  const catalog = {
    searchResult: async (criteria: unknown) => { searches.push(criteria); return { products: [carafe], totalMatches: 1 }; },
    details: async (id: string) => { details.push(id); return products.find((p) => p.id === id); },
  } as unknown as CatalogService;
  const mock = scripted([
    { name: "searchProducts", input: { operation: "new", mode: "lookup", language: "pl", criteria: { query: "glass carafe", maxPrice: 1000 }, continueWith: "getProductDetails" } },
    { name: "answerProductQuestion", input: { status: "missing", answer: "" } },
  ]);
  const result = await runAgent(mock.runtime.model, catalog, { text: "Czy sklep podaje maksymalną temperaturę dla Glass carafe?", userMessageId: "named-lookup-detail", state: initialAgentState() }, new AbortController().signal, mock.runtime);
  assert.equal(mock.requests.length, 2);
  assert.equal(searches[0].maxPrice, undefined);
  assert.deepEqual(details, ["carafe"]);
  assert.equal(result.operation.kind, "details");
  assert.deepEqual(result.presentation.productIds, ["carafe"]);
  assert.match(result.answer, /nie potrafię potwierdzić/i);
  const records = JSON.parse(mock.requests[1].messages.find((message: any) => message.role === "user").content).records;
  assert.equal(records[0].description, carafe.description);
  assert.equal(records[0].dimensions, carafe.dimensions);
});

test("single named lookup retains an explicitly stated budget", async () => {
  const carafe = products.find((p) => p.id === "carafe")!;
  const searches: any[] = [];
  const catalog = { searchResult: async (criteria: unknown) => { searches.push(criteria); return { products: [carafe], totalMatches: 1 }; }, details: async () => carafe } as unknown as CatalogService;
  const mock = scripted([{ name: "searchProducts", input: { operation: "new", mode: "lookup", language: "pl", criteria: { query: "glass carafe", maxPrice: 25 }, continueWith: "getProductDetails" } }]);
  const result = await runAgent(mock.runtime.model, catalog, { text: "Jakie wymiary ma Glass carafe do 25€?", userMessageId: "named-detail-budget", state: initialAgentState() }, new AbortController().signal, mock.runtime);
  assert.equal(searches[0].maxPrice, 25);
  assert.equal(result.operation.kind, "details");
  assert.match(result.answer, /25 cm/);
});

test("ambiguous or mismatched lookup results never force a product detail", async () => {
  const carafe = products.find((p) => p.id === "carafe")!;
  const mugs = products.find((p) => p.id === "mugs")!;
  for (const [index, found] of [{ products: [carafe, mugs], totalMatches: 2 }, { products: [mugs], totalMatches: 1 }, { products: [carafe], totalMatches: 2 }].entries()) {
    const details: string[] = [];
    const catalog = { searchResult: async () => found, details: async (id: string) => { details.push(id); return carafe; } } as unknown as CatalogService;
    const mock = scripted([
      { name: "searchProducts", input: { operation: "new", mode: "lookup", language: "en", criteria: { query: "glass carafe" }, continueWith: "getProductDetails" } },
      { name: "presentAnswer", input: { text: "Which product do you mean?", language: "en", evidenceIds: [], productIds: [], view: "none" } },
    ]);
    await runAgent(mock.runtime.model, catalog, { text: "Tell me about Glass carafe", userMessageId: `ambiguous-named-lookup-${index}`, state: initialAgentState() }, new AbortController().signal, mock.runtime);
    assert.deepEqual(details, []);
    assert.equal(mock.requests.length, 2);
  }
});

test("full canonical names and explicit PL/EN comparison resolve the requested pair after provider interpretation", async () => {
  const cases = [
    ["Zestaw proszę Ceramic mugs z Glass carafe. Co kosztuje mniej?", "pl"],
    ["Porównanie Ceramic mugs i Glass carafe.", "pl"],
    ["Compare Ceramic mugs versus Glass carafe. Which is cheaper?", "en"],
    ["Ceramic mugs versus Glass carafe.", "en"],
  ] as const;
  for (const [index, [question, language]] of cases.entries()) {
    const calls: string[] = [];
    const catalog = { searchResult: async () => { calls.push("search"); throw new Error("unexpected search"); } } as unknown as CatalogService;
    const mock = scripted([
      { name: "searchProducts", input: { operation: "new", mode: "recommend", language, criteria: { query: "mug" }, continueWith: "presentAnswer" } },
      answer(language === "pl" ? "Glass carafe jest tańsza." : "Glass carafe is the cheaper option.", language),
    ]);
    const result = await runAgent(mock.runtime.model, catalog, { text: question, userMessageId: `named-comparison-${index}`, state: initialAgentState() }, new AbortController().signal, mock.runtime);
    assert.equal(mock.requests.length, 2, question);
    assert.deepEqual(calls, []);
    assert.equal(result.operation.kind, "comparison", question);
    assert.deepEqual(result.comparison?.productIds, ["mugs", "carafe"]);
    assert.deepEqual(result.comparison?.cheapestIds, ["carafe"]);
  }
});

test("shopping for a set or an unnamed extra subject does not force a comparison", async () => {
  const mugs = products.find((p) => p.id === "mugs")!;
  const cases = ["Szukam zestawu Ceramic mugs i nieznanego produktu.", "Zestaw Ceramic mugs z Glass carafe i Mystery item."];
  for (const [index, question] of cases.entries()) {
    const calls: string[] = [];
    const catalog = { overview: async () => ({ total: 1 }), searchResult: async () => { calls.push("search"); return { products: [mugs], totalMatches: 1, unseenMatches: 1, matchedIds: [mugs.id] }; } } as unknown as CatalogService;
    const mock = scripted([
      { name: "searchProducts", input: { operation: "new", mode: "recommend", language: "pl", criteria: { query: "mug" }, continueWith: "presentAnswer" } },
      answer("Oto dostępna propozycja.", "pl"),
    ]);
    const result = await runAgent(mock.runtime.model, catalog, { text: question, userMessageId: `not-named-comparison-${index}`, state: initialAgentState() }, new AbortController().signal, mock.runtime);
    assert.deepEqual(calls, ["search"]);
    assert.equal(result.operation.kind, "search");
    assert.equal(result.comparison, undefined);
  }
});

test("a return to a named earlier product reads its ID even if the model sends its name as a product type", async () => {
  const details: string[] = [];
  const catalog = { details: async (id: string) => { details.push(id); return products.find((p) => p.id === id); } } as unknown as CatalogService;
  const mock = scripted([
    { name: "searchProducts", input: { mode: "lookup", operation: "new", language: "pl", criteria: {}, explicitFilters: [{ facet: "type", value: "Ceramic mugs", userQuote: "Ceramic mugs" }], continueWith: "getProductDetails" } },
    { name: "answerProductQuestion", input: { status: "supported", answer: "Tak, Ceramic mugs mają uchwyty.", source: "features", quote: "handles for hot drinks" } },
  ]);
  const result = await runAgent(mock.runtime.model, catalog, { text: "Wróć do pierwszych kubków. Czy Ceramic mugs mają uchwyty?", userMessageId: "previous-mugs-id", state: { ...initialAgentState(), lastIds: ["carafe"], resultIds: ["mugs", "carafe"] } }, new AbortController().signal, mock.runtime);
  assert.deepEqual(details, ["mugs"]);
  assert.equal(result.operation.kind, "details");
  assert.equal(result.answer, "Tak, Ceramic mugs mają uchwyty.");
});
