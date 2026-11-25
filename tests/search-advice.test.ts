import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogById, products } from "../src/data/products";
import { catalogAdviceContext } from "../src/application/chat/conversation-context";
import { comparisonFactOptions } from "../src/application/chat/comparison-facts";
import { groundedSearchAdvice } from "../src/application/chat/search-advice";

const chair = catalogById.get("folding-garden-chair")!;
const lounger = catalogById.get("sun-lounger")!;
const bench = catalogById.get("garden-bench")!;
const ids = [chair.id, lounger.id, bench.id];

test("search advice context supplies authoritative prices, stock and bounded named reasons", () => {
  const selected = [chair, lounger, bench, ...products.filter((product) => !ids.includes(product.id)).slice(0, 4)];
  const context = catalogAdviceContext("Szukam czegoś do siedzenia.", selected.map((product) => product.id), "pl", "search", [
    { role: "assistant", content: "An invented past assertion." },
  ]);
  assert.equal(context.records.length, 7);
  for (const [index, record] of context.records.entries()) {
    const product = selected[index];
    assert.equal(record.name, product.name);
    assert.equal(record.priceEUR, product.price);
    assert.equal(record.inStock, product.inStock);
    assert.deepEqual(record.features, product.features);
    assert.deepEqual(record.limitations, product.limitations);
    if (index < 5) {
      assert.deepEqual(record.shoppingReasons, comparisonFactOptions(product, "pl").slice(0, 2).map((option) => option.statement));
      assert.ok(record.shoppingReasons!.every((value) => value.includes(product.name) && !value.startsWith("Polecam")));
    } else assert.equal(record.shoppingReasons, undefined);
  }
  assert.doesNotMatch(JSON.stringify(context), /invented past assertion/);
  assert.equal(context.records[0].shoppingReasons?.[0], "Folding garden chair ma składaną ramę.");
  const unchanged = catalogAdviceContext("x", [chair.id], "pl", "advice", []);
  assert.equal("priceEUR" in unchanged.records[0], false);
  assert.equal("shoppingReasons" in unchanged.records[0], false);
});

test("one or two complete and attributable statements are returned verbatim", () => {
  for (const language of ["pl", "en"] as const) {
    const first = comparisonFactOptions(chair, language)[0].statement;
    const second = comparisonFactOptions(lounger, language)[0].statement;
    for (const text of [first, `${first} ${second}`, `${second} ${first}`]) {
      assert.equal(groundedSearchAdvice(text, ids, language), text);
    }
    assert.equal(groundedSearchAdvice(first, [chair.id], language), first);
  }
});

test("safe generic assistance stays untouched without opening arbitrary factual claims", () => {
  for (const [text, language] of [
    ["I can help you check.", "en"], ["I can help you choose from these options.", "en"],
    ["Mogę pomóc Ci wybrać spośród tych propozycji.", "pl"], ["Czy chcesz poznać więcej szczegółów?", "pl"],
  ] as const) assert.equal(groundedSearchAdvice(text, ids, language), text);
});

test("unsupported product claims, free numbers and mixed qualifiers fall back to a real fact", () => {
  const fallback = comparisonFactOptions(chair, "pl")[0].statement;
  const wrong = [
    "Folding garden chair ma lekką ramę i siatkowe siedzisko.",
    "Folding garden chair ma składaną ramę i jest lekki.",
    "W katalogu nie ma podanych cen, więc nie mogę potwierdzić budżetu 150 EUR.",
    "Folding garden chair ma składaną ramę. Sun lounger jest wykonany z żelaza.",
    "Folding garden chair ma składaną ramę. Folding garden chair ma siedzisko i oparcie z listew.",
    "Glass carafe służy do podawania kawy parzonej na zimno.",
    "Folding garden chair kosztuje 49 EUR.",
    "Folding garden chair nie ma składanej ramy.",
  ];
  for (const text of wrong) assert.equal(groundedSearchAdvice(text, ids, "pl"), fallback, text);
});

test("incomplete or unidentifiable results are never repaired or replaced", () => {
  assert.equal(groundedSearchAdvice("Folding garden chair ma składaną", ids, "pl"), undefined);
  assert.equal(groundedSearchAdvice("Folding garden chair ma składaną ramę.", ids, "pl", "length"), undefined);
  assert.equal(groundedSearchAdvice("Folding garden chair ma składaną ramę.", [], "pl"), undefined);
  assert.equal(groundedSearchAdvice("Folding garden chair ma składaną ramę.", [chair.id, chair.id], "pl"), undefined);
  assert.equal(groundedSearchAdvice("Folding garden chair ma składaną ramę.", [chair.id, "unknown"], "pl"), undefined);
});

test("telling a shopper more about one product cannot invent benefits from its construction", () => {
  const context = catalogAdviceContext("Tell me more about Folding garden chair.", [chair.id], "pl", "productOverview", [
    { role: "user", content: "I need a chair for a balcony." },
    { role: "assistant", content: "This chair is indestructible." },
  ]);
  assert.deepEqual(context.previousShopperRequests, ["I need a chair for a balcony."]);
  assert.doesNotMatch(JSON.stringify(context), /indestructible/);
  const reasons = context.records[0].shoppingReasons!;
  const valid = reasons.slice(0, 2).join(" ");
  const accept = (value: string) => groundedSearchAdvice(value, [chair.id], "pl", undefined, "productOverview");
  assert.equal(accept(valid), valid);
  assert.equal(accept(reasons.at(-1)!), reasons.at(-1));
  for (const value of [
    "Folding garden chair ma siedzisko i oparcie z listew, co zapewnia trwałość i dobrą wentylację.",
    "Folding garden chair ma składaną ramę. Jest wygodny i odporny na działanie wody.",
    "Mogę pomóc Ci wybrać.",
  ]) assert.equal(accept(value), valid);
});
