import assert from "node:assert/strict";
import { test } from "node:test";
import { exactNamedChoice } from "../src/application/chat/product-references";

test("choosing for a stated use reads exactly both named options", () => {
  assert.deepEqual(exactNamedChoice("Chcę rano pić gorącą kawę. Zastanawiam się nad Ceramic mugs i Glass carafe. Który produkt będzie do tego lepszy i dlaczego?"), ["mugs", "carafe"]);
  assert.deepEqual(exactNamedChoice("Glass carafe or Ceramic mugs for cold brew – which would you recommend?"), ["carafe", "mugs"]);
  assert.deepEqual(exactNamedChoice("Do not consider Glass carafe. Which Ceramic mugs should I choose?"), []);
  assert.deepEqual(exactNamedChoice("I saw Glass carafe and Ceramic mugs. How much is the carafe?"), []);
});

test("a change of use can compare the same pair; an unrelated question does not inherit it", () => {
  const prior = ["mugs", "carafe"];
  assert.deepEqual(exactNamedChoice("Zmieniłem zdanie. Który z tych dwóch produktów polecisz do zimnej kawy?", prior), prior);
  assert.deepEqual(exactNamedChoice("Which of those two would you recommend for cold brew?", prior), prior);
  assert.deepEqual(exactNamedChoice("Which desk lamp would you recommend?", prior), []);
  assert.deepEqual(exactNamedChoice("Which of those two would you pick?", ["mugs", "mugs"]), []);
});

test("comparison advice receives the actual earlier need when Explain is clicked", async () => {
  const { catalogAdviceContext } = await import("../src/application/chat/conversation-context");
  const data = catalogAdviceContext("Explain differences", ["mugs", "carafe"], "pl", "comparison", [
    { role: "user", content: "Wolę kawę parzoną na zimno." },
    { role: "assistant", content: "An earlier assistant claimed an unverified feature." },
    { role: "user", content: "Porównaj te produkty." },
  ], "Porównaj te produkty.");
  assert.deepEqual(data.previousShopperRequests, ["Wolę kawę parzoną na zimno.", "Porównaj te produkty."]);
  assert.ok(data.records.find((record) => record.name === "Glass carafe")?.decisionReasons?.some((option) => option.statement.includes("na zimno")));
  assert.doesNotMatch(JSON.stringify(data), /unverified feature/);
});

test("boiling water asks for an unknown temperature rating, not a guess from the carafe's material", async () => {
  const { detailQuestionResponse } = await import("../src/application/chat/detail-response");
  const { catalogById } = await import("../src/data/products");
  const carafe = catalogById.get("carafe")!;
  for (const [request, lang] of [["Czy w tej karafce mogę bezpiecznie podawać wrzątek?", "pl"], ["Is it safe to fill this with boiling water?", "en"]] as const) {
    const result = detailQuestionResponse(carafe, request, lang);
    assert.equal(result?.needsModel, true);
    assert.match(result!.text, /temperatur/i);
    assert.match(result!.text, /Glass carafe/);
  }
});

test("a complete Polish catalog label has the canonical English search meaning", async () => {
  const { canonicalSemanticQuery } = await import("../src/application/chat/query-language");
  assert.equal(canonicalSemanticQuery("kubek"), "mug");
  assert.equal(canonicalSemanticQuery("kubka"), "mug");
  assert.equal(canonicalSemanticQuery("kubek łazienkowy"), "cup");
  assert.equal(canonicalSemanticQuery("kubek do granatowego termosu"), "kubek do granatowego termosu");
  assert.equal(canonicalSemanticQuery("travel mug"), "travel mug");
});
