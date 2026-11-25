import { test } from "node:test";
import assert from "node:assert/strict";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import { runAgent } from "../src/infrastructure/chat/native-agent";
import { initialAgentState } from "../src/application/chat/shopping-v3";
import { groundedComparisonAdvice, comparisonAdviceFallback } from "../src/application/chat/comparison-advice";
import type { CatalogService } from "../src/application/catalog/catalog-service";

const pair = ["mugs", "carafe"];
const actual = "The ceramic mugs are glazed ceramic with handles, sold as a set of two and meant for hot drinks, while the glass carafe is made of glass, has a narrow neck for serving cold brew, and is a single piece without handles.";
const polish = "Ceramic mugs są z ceramiki szkliwionej, mają uchwyty i są zestawem dwóch sztuk, natomiast Glass carafe jest szklana, ma wąską szyjkę i jest pojedynczą sztuką bez uchwytu.";

function scripted(advice: string) {
  let calls = 0;
  const runtime = createGroqRuntime({ baseURL: "http://127.0.0.1:8787/v1", modelId: "test", apiKey: "fixture-only" }, async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    const message = body.tools?.length
      ? { role: "assistant", content: null, tool_calls: [{ id: "comparison", type: "function", function: { name: "compareProducts", arguments: JSON.stringify({ productIds: pair }) } }] }
      : { role: "assistant", content: advice };
    return Response.json({ id: `result-${calls}`, model: "test", created: 0, object: "chat.completion", choices: [{ index: 0, message, finish_reason: body.tools?.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
  });
  return { runtime, calls: () => calls };
}
async function compare(text: string, language: "pl" | "en", key: string) {
  const mock = scripted(text);
  const result = await runAgent(mock.runtime.model, {} as CatalogService, { text: language === "pl" ? "Porównaj kubki i karafkę." : "Compare mugs and carafe.", userMessageId: key, state: initialAgentState() }, new AbortController().signal, mock.runtime);
  return { result, calls: mock.calls() };
}

test("real EN and PL ungrounded cross-product claims are replaced by useful canonical materials", async () => {
  for (const [language, text] of [["en", actual], ["pl", polish]] as const) {
    const { result, calls } = await compare(text, language, `comparison-real-${language}`);
    assert.equal(calls, 2);
    assert.equal(result.operation.status, "completed");
    assert.deepEqual(result.comparison?.productIds, pair);
    assert.deepEqual(result.comparison?.cheapestIds, ["carafe"]);
    assert.equal(result.advice.status, "included");
    if (result.advice.status !== "included") throw new Error("expected grounded advice");
    assert.equal(result.advice.text, comparisonAdviceFallback(pair, language));
    assert.match(result.advice.text, /Ceramic mugs/);
    assert.match(result.advice.text, /Glass carafe/);
    assert.match(result.advice.text, language === "pl" ? /ceramika szkliwiona.*szkło/ : /glazed ceramic.*glass/);
    assert.doesNotMatch(result.advice.text, /without handles|single piece|bez uchwytu|pojedyncz/i);
    assert.match(result.advice.text, language === "pl" ? /cechy i ograniczenia/i : /features and limitations/i);
  }
});

test("complete product-attributed supported features and materials are preserved", async () => {
  const values = [
    ["en", "Ceramic mugs have handles; Glass carafe has a narrow neck."],
    ["en", "Glass carafe has a narrow neck; Ceramic mugs have handles."],
    ["en", "Ceramic mugs are made of glazed ceramic; Glass carafe is glass."],
    ["pl", "Ceramic mugs: ceramika szkliwiona; Glass carafe: szkło."],
  ] as const;
  for (const [index, [language, text]] of values.entries()) {
    assert.equal(groundedComparisonAdvice(text, pair), true, text);
    const { result } = await compare(text, language, `comparison-supported-${index}`);
    assert.equal(result.advice.status, "included");
    if (result.advice.status === "included") assert.equal(result.advice.text, text);
  }
});

test("complete recorded limitations and set quantities remain grounded", () => {
  assert.equal(groundedComparisonAdvice("Felt laptop sleeve: Not waterproof; Glass carafe has a narrow neck.", ["laptop-sleeve", "carafe"]), true);
  assert.equal(groundedComparisonAdvice("Ceramic mugs have a set of two; Glass carafe has a narrow neck.", pair), true);
});

test("group size and product pack size use separate evidence", () => {
  assert.equal(groundedComparisonAdvice("This comparison covers two products.", pair), true);
  assert.equal(groundedComparisonAdvice("This comparison covers three products.", pair), false);
  assert.equal(groundedComparisonAdvice("Porównanie obejmuje dwa produkty.", pair), true);
  assert.equal(groundedComparisonAdvice("Both are a set of two.", pair), false);
  assert.equal(groundedComparisonAdvice("Both are a set of two.", ["mugs", "dinner-plates"]), true);
  assert.equal(groundedComparisonAdvice("Oba produkty są zestawami po dwie sztuki.", ["mugs", "dinner-plates"]), true);
});

test("provider pack-size confusion is replaced while the result count remains valid", async () => {
  const mixed = await compare("Both are a set of two.", "en", "comparison-false-pack");
  assert.equal(mixed.result.advice.status, "included");
  if (mixed.result.advice.status === "included") {
    assert.equal(mixed.result.advice.text, comparisonAdviceFallback(pair, "en"));
    assert.doesNotMatch(mixed.result.advice.text, /set of two/);
  }
  const count = await compare("This comparison covers two products.", "en", "comparison-correct-count");
  assert.equal(count.result.advice.status, "included");
  if (count.result.advice.status === "included") assert.equal(count.result.advice.text, "This comparison covers two products.");
});

test("numbers, negatives and facts cannot move between product records", () => {
  const wrong = [
    "Ceramic mugs have handles; Glass carafe has handles.",
    "Ceramic mugs have handles; Glass carafe has no handles.",
    "Ceramic mugs have handles; Glass carafe is a set of two.",
    "Ceramic mugs have a narrow neck; Glass carafe has handles.",
    "Ceramic mugs are made of handles; Glass carafe is glass.",
    "Ceramic mugs have handles; Glass carafe has 12 handles.",
  ];
  for (const text of wrong) assert.equal(groundedComparisonAdvice(text, pair), false, text);
});

test("truncated model text remains unavailable instead of being repaired", async () => {
  const { result } = await compare("Ceramic mugs have handles; Glass carafe has a", "en", "comparison-incomplete");
  assert.equal(result.operation.status, "completed");
  assert.equal(result.advice.status, "unavailable");
});
