import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCartInstruction, hasExternalCartDependency, prepareCartProposal } from "../src/application/chat/cart-authorization";
import { rememberCartIntent, pendingCartIntent, forgetCartIntent } from "../src/application/chat/cart-intent";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import { runAgent } from "../src/infrastructure/chat/native-agent";
import type { CatalogService } from "../src/application/catalog/catalog-service";
import { resolveCartOperand } from "../src/application/chat/cart-intent";
import { initialAgentState } from "../src/application/chat/shopping-v3";
import { needsModel } from "../src/infrastructure/chat/native-agent";

const state = { ...initialAgentState(), lastIds: ["mugs"], selectedIds: ["mugs"] };
const proposal = { selection: "named" as const, items: [{ productId: "mugs", quantity: 1 }] };

test("external seller fetch-and-add requests cannot authorize a local cart effect", () => {
  const requests = [
    "W innym sklepie znalazłem kubek Comet Brew 700. Czy możesz go tam sprawdzić i dodać do mojego koszyka tutaj?",
    "W innym sklepie znalazłem Ceramic mugs. Czy możesz je stamtąd dodać do mojego koszyka?",
    "Znalazłem Ceramic mugs u innego sprzedawcy, dodaj je do koszyka.",
    "Sprawdź produkt na zewnętrznej stronie i dodaj go tutaj.",
    "Znalazłem produkt w sklepie konkurencji. Dodaj go do koszyka.",
    "I found Ceramic mugs in another shop. Can you check it there and add it to my cart?",
    "Find an item from a different online retailer and add it to my basket.",
    "Buy Ceramic mugs from another seller.",
    "Check https://example.invalid/products/mugs and add Ceramic mugs to my cart.",
    'Dodaj do koszyka Ceramic mugs z "https://example.invalid/products/mugs".',
    'Add Ceramic mugs from "example.invalid/products/mugs" to my cart.',
    "Add Ceramic mugs from example.invalid to my cart.",
  ];
  for (const request of requests) {
    assert.equal(hasExternalCartDependency(request), true, request);
    assert.equal(hasCartInstruction(request), false, request);
    assert.equal(needsModel({ text: request }), true, request);
    assert.equal(resolveCartOperand(request, state), undefined, request);
    assert.ok("error" in prepareCartProposal(request, state, proposal), request);
  }
});

test("a separately named local command after an external mention remains usable", () => {
  const requests = [
    "W innym sklepie widziałem inny produkt. Dodaj Ceramic mugs do koszyka.",
    "W innym sklepie widziałem inny produkt, ale dodaj Ceramic mugs do koszyka.",
    "In another shop I saw an unrelated product. Add Ceramic mugs to my cart.",
    "I saw Ceramic mugs at another store. Add Ceramic mugs from your store to my cart.",
    "W innym sklepie widziałem Ceramic mugs. Dodaj Ceramic mugs z waszego sklepu do koszyka.",
    'I saw Ceramic mugs at another store. Add "Ceramic mugs" from your store to my cart.',
    'W innym sklepie widziałem coś innego. Dodaj „Ceramic mugs” do koszyka.',
  ];
  for (const request of requests) {
    assert.equal(hasExternalCartDependency(request), false, request);
    assert.equal(hasCartInstruction(request), true, request);
    const operand = resolveCartOperand(request, state);
    assert.ok(operand && "proposal" in operand, request);
    if (operand && "proposal" in operand) assert.deepEqual(operand.proposal.items, proposal.items);
  }
});

test("a foreign reference, later product mention or same foreign name without local provenance is not independent", () => {
  const requests = [
    "W innym sklepie znalazłem Ceramic mugs. Dodaj Ceramic mugs do koszyka.",
    "In another shop I saw something. Add it. Ceramic mugs look nice.",
    "W innym sklepie znalazłem kubki. Dodaj je. Ceramic mugs wyglądają ładnie.",
    "I saw an item in another store. Add this Ceramic mugs to my cart.",
  ];
  for (const request of requests) {
    assert.equal(hasExternalCartDependency(request), true, request);
    assert.equal(hasCartInstruction(request), false, request);
    assert.equal(resolveCartOperand(request, state), undefined, request);
  }
});

test("ordinary local additions, quoted examples and negative instructions retain their boundaries", () => {
  assert.equal(hasCartInstruction("Dodaj Ceramic mugs do koszyka."), true);
  assert.equal(hasCartInstruction("Add Ceramic mugs to my cart."), true);
  assert.equal(hasCartInstruction('The example is "add Ceramic mugs from another store".'), false);
  assert.equal(hasCartInstruction("Nie dodawaj Ceramic mugs do koszyka."), false);
  assert.equal(hasCartInstruction("Never add Ceramic mugs to my cart."), false);
});


test("quoted local product names do not accidentally select a different item", () => {
  const otherSelected = { ...initialAgentState(), selectedIds: ["carafe"], lastIds: ["carafe"] };
  for (const request of ['Add "Ceramic mugs" to my cart.', 'Dodaj „Ceramic mugs” do koszyka.']) {
    const operand = resolveCartOperand(request, otherSelected);
    assert.ok(operand && "proposal" in operand, request);
    if (operand && "proposal" in operand) assert.deepEqual(operand.proposal.items, [{ productId: "mugs", quantity: 1 }]);
  }
  assert.equal(hasCartInstruction('The example is "add Ceramic mugs to my cart".'), false);
});

test("an external mention clears an old pending selection and invokes the model without cart effects", async () => {
  const conversationId = "external-pending-selection-fixture";
  const intent = rememberCartIntent({ conversationId, sourceMessageId: "earlier-local-question", sourceText: "Add one item", kind: "selection", productIds: ["mugs", "carafe"], quantity: 1, language: "pl" });
  let calls = 0;
  const runtime = createGroqRuntime({ baseURL: "http://127.0.0.1:8787/v1", modelId: "test", apiKey: "fixture-only" }, async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.tools.map((tool: any) => tool.function.name), ["getShoppingCapabilities"]);
    assert.equal(body.tool_choice.function.name, "getShoppingCapabilities");
    return Response.json({ id: "external-pending", model: "test", created: 0, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "external-answer", type: "function", function: { name: "getShoppingCapabilities", arguments: JSON.stringify({ answer: "Nie mam dostępu do produktów z innych sklepów." }) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
  });
  try {
    const result = await runAgent(runtime.model, {} as CatalogService, { text: "W innym sklepie widziałem Ceramic mugs. Czy dodasz je do koszyka?", userMessageId: "foreign-after-pending", conversationId, state: { ...initialAgentState(), pendingCartIntent: intent.nonce, lastIds: ["mugs", "carafe"] } }, new AbortController().signal, runtime);
    assert.equal(calls, 1);
    assert.equal(result.cart, undefined);
    assert.notEqual(result.operation.kind, "cart");
    assert.equal(result.checkpoint.after.pendingCartIntent, undefined);
    assert.equal(pendingCartIntent(conversationId, intent.nonce), undefined);
  } finally { forgetCartIntent(conversationId); }
});
