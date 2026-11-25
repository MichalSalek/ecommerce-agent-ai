import { test } from "node:test";
import assert from "node:assert/strict";
import { products, catalogById } from "../src/data/products";
import { comparisonFactOptions, groundedComparisonAdvice, groundedComparisonLead } from "../src/application/chat/comparison-advice";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import { runAgent } from "../src/infrastructure/chat/native-agent";
import { initialAgentState } from "../src/application/chat/shopping-v3";
import type { CatalogService } from "../src/application/catalog/catalog-service";

const mugs = catalogById.get("mugs")!;
const carafe = catalogById.get("carafe")!;
const chair = catalogById.get("folding-garden-chair")!;
const bench = catalogById.get("garden-bench")!;
const pair = [mugs.id, carafe.id];

test("options name products and translate individual canonical features", () => {
  assert.deepEqual(comparisonFactOptions(mugs, "pl")[0], {
    statement: "Ceramic mugs mają uchwyty do gorących napojów.",
    recommendation: "Polecam Ceramic mugs, bo mają uchwyty do gorących napojów.",
  });
  assert.deepEqual(comparisonFactOptions(carafe, "pl")[0], {
    statement: "Glass carafe służy do podawania kawy parzonej na zimno.",
    recommendation: "Polecam Glass carafe, bo służy do podawania kawy parzonej na zimno.",
  });
  assert.equal(comparisonFactOptions(chair, "pl")[0].statement, "Folding garden chair ma składaną ramę.");
  assert.equal(comparisonFactOptions(bench, "pl")[0].statement, "Garden bench ma miejsce dla dwóch osób.");
  assert.equal(comparisonFactOptions(mugs, "en")[0].statement, "Ceramic mugs have handles for hot drinks.");
  assert.equal(comparisonFactOptions(carafe, "en")[0].statement, "Glass carafe serves cold brew.");
});

test("complete grounded statements and one initial recommendation work in either order", () => {
  for (const language of ["pl", "en"] as const) {
    const first = comparisonFactOptions(mugs, language)[0];
    const second = comparisonFactOptions(carafe, language)[0];
    for (const value of [first.statement, `${first.statement} ${second.statement}`, `${second.statement} ${first.statement}`, `${first.recommendation} ${second.statement}`]) {
      assert.equal(groundedComparisonAdvice(value, pair, language), true, value);
      assert.equal(groundedComparisonAdvice(value, pair), true, value);
    }
    assert.equal(groundedComparisonAdvice(`${first.statement} ${second.recommendation}`, pair, language), false);
    assert.equal(groundedComparisonAdvice(`${first.recommendation} ${second.recommendation}`, pair, language), false);
  }
});

test("all canonical products offer both languages and every option remains attributable", () => {
  for (const product of products) {
    const other = product.id === "mugs" ? carafe.id : mugs.id;
    for (const language of ["pl", "en"] as const) {
      const options = comparisonFactOptions(product, language);
      assert.ok(options.length, `${product.name} ${language}`);
      for (const option of options) {
        for (const value of [option.statement, option.recommendation]) {
          assert.match(value, /\.$/);
          assert.ok(value.includes(product.name));
          assert.doesNotMatch(value, /\{\w+\}/);
          assert.equal(groundedComparisonAdvice(value, [product.id, other], language), true, value);
        }
      }
    }
  }
});

test("each current catalog feature has its own localized fact", () => {
  for (const product of products) {
    for (const feature of product.features) {
      const isolated = { ...product, features: [feature], limitations: [], material: "" };
      for (const language of ["pl", "en"] as const) {
        const options = comparisonFactOptions(isolated, language);
        assert.equal(options.length, 1, `${product.name}: ${feature} (${language})`);
        assert.ok(options[0].statement.includes(product.name));
      }
    }
  }
});

test("unknown feature and material use the literal catalog material without invention", () => {
  const custom = { ...mugs, name: "Example item", features: ["unknown feature"], limitations: [], material: "carbon fibre composite" };
  assert.deepEqual(comparisonFactOptions(custom, "pl"), [{
    statement: "Katalog podaje, że materiał produktu Example item to carbon fibre composite.",
    recommendation: "Polecam Example item ze względu na materiał określony w katalogu jako carbon fibre composite.",
  }]);
});

test("mixed, invented, negated, reassigned and truncated clauses are rejected", () => {
  const wrong = [
    "Ceramic mugs mają uchwyty do zimnych napojów.",
    "Ceramic mugs mają uchwyty do gorących napojów i są szczelne.",
    "Ceramic mugs nie mają uchwytów do gorących napojów.",
    "Glass carafe ma uchwyty do gorących napojów.",
    "Garden bench ma miejsce dla trzech osób.",
    "Ceramic mugs mają uchwyty do gorących napojów. Glass carafe ma pokrywkę.",
    "Ceramic mugs mają uchwyty do gorących napojów. Nie przemakają.",
    "Ceramic mugs mają uchwyty do gorących napojów. Glass carafe służy do podawania kawy parzonej na zimno. Są trwałe.",
    "Ceramic mugs mają uchwyty do gorących napojów. Glass carafe",
  ];
  for (const value of wrong) assert.equal(groundedComparisonAdvice(value, [mugs.id, carafe.id, bench.id], "pl"), false, value);
  assert.equal(groundedComparisonAdvice("Ceramic mugs mają uchwyty do gorących napojów.", [mugs.id, mugs.id], "pl"), false);
  assert.equal(groundedComparisonAdvice("Ceramic mugs mają uchwyty do gorących napojów.", [mugs.id, "unknown"], "pl"), false);
});

async function compare(answer: string, language: "pl" | "en") {
  let calls = 0;
  const runtime = createGroqRuntime({ baseURL: "http://127.0.0.1:8787/v1", modelId: "fixture", apiKey: "fixture-only" }, async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    calls++;
    const message = body.tools?.length ? { role: "assistant", content: null, tool_calls: [{ id: "comparison", type: "function", function: { name: "compareProducts", arguments: JSON.stringify({ productIds: pair }) } }] } : { role: "assistant", content: answer };
    return Response.json({ id: `fixture-${calls}`, object: "chat.completion", created: 0, model: "fixture", choices: [{ index: 0, message, finish_reason: body.tools?.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  return runAgent(runtime.model, {} as CatalogService, { text: language === "pl" ? "Porównaj kubki i karafkę." : "Compare mugs and carafe.", userMessageId: `option-${language}`, conversationId: `option-${language}`, state: initialAgentState() }, new AbortController().signal, runtime);
}

test("actual model advice is preserved verbatim when composed from supported options", async () => {
  for (const language of ["pl", "en"] as const) {
    const first = comparisonFactOptions(mugs, language)[0];
    const second = comparisonFactOptions(carafe, language)[0];
    const expected = `${first.recommendation} ${second.statement}`;
    const result = await compare(expected, language);
    assert.equal(result.operation.status, "completed");
    assert.equal(result.advice.status, "included");
    if (result.advice.status === "included") assert.equal(result.advice.text, expected);
  }
});

test("lead recovery keeps only a complete grounded first recommendation from a complete rejected reply", () => {
  const lead = "Polecam Ceramic mugs, bo mają uchwyty do gorących napojów.";
  const observed = `${lead} Warto pamiętać, że produkt Ceramic mugs nie jest przeznaczony do użytku na zewnątrz.`;
  assert.equal(groundedComparisonAdvice(observed, pair, "pl"), false);
  assert.equal(groundedComparisonLead(observed, pair, "pl"), lead);
  assert.equal(groundedComparisonLead(`${lead} Glass carafe służy do podawania kawy parzonej na zimno.`, pair, "pl"), undefined);
  const invalid = [
    "Polecam Ceramic mugs, bo mają szczelne pokrywki. Glass carafe służy do podawania kawy parzonej na zimno.",
    "Polecam Glass carafe, bo ma uchwyty do gorących napojów. Ceramic mugs mają uchwyty do gorących napojów.",
    "Polecam Ceramic mugs, bo mają uchwyty do gorących napojów; są też szczelne. Glass carafe służy do podawania kawy parzonej na zimno.",
    `${lead} To jest`,
    `${lead} Nie znam`,
    lead,
    "Warto pamiętać, że produkt Ceramic mugs nie jest przeznaczony do użytku na zewnątrz. Są trwałe.",
  ];
  for (const value of invalid) assert.equal(groundedComparisonLead(value, pair, "pl"), undefined, value);
  const enLead = "I recommend Ceramic mugs because they have handles for hot drinks.";
  assert.equal(groundedComparisonLead(`${enLead} They are unbreakable.`, pair, "en"), enLead);
  assert.equal(groundedComparisonLead(`${enLead} They are unbreakable.`, [mugs.id, "unknown"], "en"), undefined);
});

test("two selected option sentences must refer to different products", () => {
  const options = comparisonFactOptions(mugs, "pl");
  assert.equal(groundedComparisonAdvice(`${options[0].statement} ${options[1].statement}`, pair, "pl"), false);
  assert.equal(groundedComparisonAdvice(`${options[0].recommendation} ${options[1].statement}`, pair, "pl"), false);
});
