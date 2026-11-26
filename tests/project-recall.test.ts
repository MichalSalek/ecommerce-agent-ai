import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { initialAgentState } from "../src/application/chat/shopping-v3";
import { capabilityTopic, projectNameEvidence } from "../src/application/chat/shop-capabilities";
import type { CatalogService } from "../src/application/catalog/catalog-service";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import { runAgent } from "../src/infrastructure/chat/native-agent";

const question = "Czy znasz nazwę mojego projektu?";
const project = "Bursztynowy List";
const branch = "Zmiana planów. Szukam czegoś do kawy do 25 euro na spotkanie projektu Bursztynowy List.";
const user = (content: string): ModelMessage => ({ role: "user", content });

interface WireRequest {
  messages: { role: string; content: string }[];
  tools: { function: { name: string; parameters: { properties: Record<string, unknown> } } }[];
  tool_choice: { function: { name: string } };
}

let sequence = 0;
async function runFixture(
  text: string,
  response: () => Response,
  history: ModelMessage[] = [],
  priorProductGroups: { userText: string; productIds: string[] }[] = [],
) {
  const requests: WireRequest[] = [];
  const runtime = createGroqRuntime({
    baseURL: "http://fixture/v1", modelId: "fixture", apiKey: "fixture-only",
  }, async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return response();
  });
  const id = ++sequence;
  const turn = {
    text, history, priorProductGroups, state: initialAgentState(),
    userMessageId: `project-question-${id}`, conversationId: `project-thread-${id}`,
  };
  const result = runAgent(runtime.model, {} as CatalogService, turn, new AbortController().signal, runtime);
  return { requests, result };
}

async function recall(text: string, history: ModelMessage[] = [], name: string | null = null, sourceQuote: string | null = null) {
  const response = () => Response.json({
    id: "fixture", model: "fixture", created: 1,
    choices: [{ index: 0, finish_reason: "tool_calls", message: {
      role: "assistant", content: null,
      tool_calls: [{ id: "call", type: "function", function: {
        name: "getShoppingCapabilities", arguments: JSON.stringify({ name, sourceQuote }),
      } }],
    } }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
  const { requests, result } = await runFixture(text, response, history, [
    { userText: "PRODUCT_GROUP_MARKER", productIds: ["mugs"] },
  ]);
  const outcome = await result;
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.tool_choice.function.name, "getShoppingCapabilities");
  assert.deepEqual(request.tools.map(tool => tool.function.name), ["getShoppingCapabilities"]);
  assert.deepEqual(Object.keys(request.tools[0].function.parameters.properties).sort(), ["name", "sourceQuote"]);
  assert.equal(outcome.operation.kind, "conversation");
  assert.equal(outcome.presentation.productIds.length, 0);
  return { answer: outcome.answer, messages: request.messages };
}

test("project recall uses only the shopper's statements from this conversation", async () => {
  const history: ModelMessage[] = [user(branch), { role: "assistant", content: "Nazywa się Sekretny Marker." }];
  const known = await recall(question, history, project, "projektu Bursztynowy List");
  assert.match(known.answer, /Bursztynowy List/);
  assert.doesNotMatch(known.answer, /25|kawy/);
  assert.deepEqual(known.messages.map(m => m.role), ["system", "user", "user"]);
  assert.equal(known.messages[1].content, branch);
  assert.doesNotMatch(JSON.stringify(known.messages), /Sekretny Marker|PRODUCT_GROUP_MARKER/);
  const fresh = await recall(question);
  assert.match(fresh.answer, /Nie znam/);
  assert.deepEqual(fresh.messages.map(m => m.role), ["system", "user"]);
  assert.equal(fresh.messages[1].content, question);
  assert.doesNotMatch(JSON.stringify(fresh.messages), /Bursztynowy List|Sekretny Marker|PRODUCT_GROUP_MARKER/);
});

test("a declaration in the question and Polish inflection preserve the exact project name", async () => {
  const declared = await recall("Nazwa mojego projektu to Amber. Czy znasz nazwę mojego projektu?", [], "Amber", "projektu to Amber");
  assert.match(declared.answer, /Amber/);
  const inflected = await recall(question, [user(branch)], project, "projekt Bursztynowy List");
  assert.match(inflected.answer, /Bursztynowy List/);
  const english = await recall("What did I call my project?", [user("My project is called Silver Moon.")], "Silver Moon", "project is called Silver Moon");
  assert.match(english.answer, /Silver Moon/);
});

test("the shopper must have supplied a definite name for their own project", async () => {
  const fabricated = await recall(question, [], "Wymyślona Nazwa", "Wymyślona Nazwa");
  assert.match(fabricated.answer, /Nie znam/);
  assert.doesNotMatch(fabricated.answer, /Wymyślona Nazwa/);
  assert.equal(projectNameEvidence(project, branch, [branch]), project);
  for (const [name, source] of [
    ["25", branch], ["List", branch], ["Reed diffuser", "Szukam Reed diffuser do mojego projektu."],
    ["Amber", "Czy mój projekt nazywa się Amber."], ["Amber", "Może mój projekt nazwę Amber."],
    ["Amber", "My project might be called Amber."], ["Amber", "Projekt mojego kolegi to Amber."],
    ["Amber", "Mój kolega nazwał swój projekt Amber."], ["Amber", "My friend's project is called Amber."],
    ["Amber", "Mój projekt to Amber lub Blue."], ["Amber", "Mój projekt to nie Amber."],
    ["Amber", "My project is not Amber."],
  ]) assert.equal(projectNameEvidence(name, name, [source]), undefined, source);
});

test("provider failure is retryable and does not invent a memory answer", async () => {
  const { requests, result } = await runFixture(question, () => Response.json({
    error: { message: "Tool choice is required, but model did not call a tool", code: "tool_use_failed" },
  }, { status: 400 }), [user(branch)]);
  await assert.rejects(result);
  assert.equal(requests.length, 1);
});

test("shopping and product-name requests keep their shopping tools", async () => {
  for (const text of ["Find mugs for my project Moon", "Find mugs for my project called Moon", "What is the product name for my project?", "Jak nazywa się Twój projekt?", "Jaka jest nazwa produktu?"]) {
    assert.notEqual(capabilityTopic(text), "projectName", text);
  }
  const { requests, result } = await runFixture("Find mugs for my project Moon", () => new Response("unavailable", { status: 503 }));
  await assert.rejects(result);
  assert.ok(requests[0].tools.some(tool => tool.function.name === "searchProducts"));
});
