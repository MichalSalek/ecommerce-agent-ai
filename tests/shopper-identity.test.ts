import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { shopperIdentityReply } from "../src/application/chat/shopper-identity";
import { capabilityTopic } from "../src/application/chat/shop-capabilities";
import { initialAgentState } from "../src/application/chat/shopping-v3";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import { runAgent } from "../src/infrastructure/chat/native-agent";
import type { CatalogService } from "../src/application/catalog/catalog-service";

const role = "Jestem rekruterką techniczną";
const question = "A jaki jest mój zawód, pamiętasz?";
const work = (occupationQuote: string | null) => ({ nameQuote: null, occupationQuote });

test("a profession question receives a real inference request containing only current shopper statements", async () => {
  const requests: { messages: ModelMessage[]; tools?: unknown; tool_choice?: unknown; response_format: { type: string } }[] = [];
  const runtime = createGroqRuntime({ baseURL: "http://fixture/v1", modelId: "fixture", apiKey: "fixture-only" }, async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({
      id: "fixture", model: "fixture", created: 1,
      choices: [{ index: 0, finish_reason: "stop", message: {
        role: "assistant", content: JSON.stringify(work(role)),
      } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    });
  });
  const history: ModelMessage[] = [
    { role: "user", content: role + ". Kim jesteś?" },
    { role: "assistant", content: "Twoim zawodem jest pilot." },
    { role: "user", content: "Skąd znasz cenę?" },
  ];
  const result = await runAgent(runtime.model, {} as CatalogService, {
    text: question, history, state: initialAgentState(), userMessageId: "identity-source", conversationId: "identity-thread",
  }, new AbortController().signal, runtime);
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.response_format.type, "json_object");
  assert.equal(request.tools, undefined);
  assert.equal(request.tool_choice, undefined);
  assert.deepEqual(request.messages.map(message => message.role), ["system", "user", "user", "user"]);
  assert.doesNotMatch(JSON.stringify(request.messages), /pilot|Device cart evidence/);
  assert.match(result.answer, /rekruterką techniczną/);
  assert.doesNotMatch(result.answer, /pilot/);
  assert.equal(result.status.status, "complete");
});

test("personal recall recognizes paraphrases and asks only about the requested detail", () => {
  for (const text of [question, "Czym się zajmuję?", "Jak mam na imię?", "What do you know about me?", "What do I do for a living?", "What is my occupation?"]) {
    assert.equal(capabilityTopic(text), "identity", text);
  }
  assert.notEqual(capabilityTopic("My name is Ada. Show me a candle."), "identity");
  assert.notEqual(capabilityTopic("Mam na imię Ada. Ile kosztuje dostawa?"), "identity");
  const messages = ["Mam na imię Ada.", "Pracuję jako bibliotekarka."];
  const e = { nameQuote: messages[0], occupationQuote: messages[1] };
  assert.match(shopperIdentityReply(e, messages, "Jak mam na imię?", "pl"), /Ada/);
  assert.doesNotMatch(shopperIdentityReply(e, messages, "Jak mam na imię?", "pl"), /bibliotekarka/);
  assert.match(shopperIdentityReply(e, messages, question, "pl"), /bibliotekarka/);
  assert.doesNotMatch(shopperIdentityReply(e, messages, question, "pl"), /Ada/);
  assert.match(shopperIdentityReply({ ...e, occupationQuote: null }, messages.slice(0, 1), "Znasz moje imię i mój zawód?", "pl"), /Ada.*Nie znam jeszcze Twojego zawodu/);
  assert.equal(shopperIdentityReply(work(null), [], question, "pl"), "Nie znam jeszcze Twojego zawodu.");
  assert.equal(shopperIdentityReply(work("Mam na imię Ada"), messages, question, "pl"), "Nie znam jeszcze Twojego zawodu.");
  assert.equal(shopperIdentityReply({ nameQuote: "I work as a librarian", occupationQuote: null }, ["I work as a librarian."], "What is my name?", "en"), "I don’t know your name yet.");
});

test("the quote must be a supported first-person declaration by this shopper", () => {
  for (const [quote, message] of [
    [role, "Koleżanka powiedziała: „Jestem rekruterką techniczną”."],
    ["Jestem rekruterką", role + "."],
    ["I am a teacher", "My colleague wrote, “I am a teacher.”"],
    ["I am a teacher", "What if I am a teacher?"],
    ["I am a teacher", "I work as a librarian."],
  ]) {
    assert.equal(shopperIdentityReply(work(quote), [message], "What is my occupation?", "en"), "I don’t know your occupation yet.", message);
  }
  assert.match(shopperIdentityReply(work("I work as a librarian"), ["I am a teacher.", "I work as a librarian."], "What is my job?", "en"), /librarian/);
});
