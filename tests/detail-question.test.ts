import assert from "node:assert/strict";
import { test } from "node:test";
import { detailQuestionResponse } from "../src/application/chat/detail-response";
import { catalogById } from "../src/data/products";

const mugs = catalogById.get("mugs")!;

test("a requested price or availability is answered without requiring a question mark", () => {
  for (const prompt of [
    "Podaj cenę pierwszego produktu z tego porównania.",
    "Powiedz mi więcej o cenie tych kubków.",
  ]) {
    assert.deepEqual(detailQuestionResponse(mugs, prompt, "pl"), { text: "Cena produktu Ceramic mugs to 22.00 EUR.", needsModel: false });
  }
  assert.deepEqual(detailQuestionResponse(mugs, "Show the price of the first product.", "en"), { text: "The price of Ceramic mugs is EUR 22.00.", needsModel: false });
  assert.deepEqual(detailQuestionResponse(mugs, "Sprawdź dostępność pierwszego produktu.", "pl"), { text: "Produkt jest dostępny.", needsModel: false });
  assert.equal(detailQuestionResponse(mugs, "Tell me more about Ceramic mugs.", "en"), undefined);
});

test("combined price and stock use both fields and a color-specific request needs its own evidence", () => {
  const both = detailQuestionResponse(mugs, "Podaj cenę i dostępność.", "pl");
  assert.equal(both?.needsModel, false);
  assert.match(both!.text, /22\.00 EUR.*Produkt jest dostępny/);
  assert.equal(detailQuestionResponse(mugs, "Is it available in purple?", "en")?.needsModel, true);
  assert.equal(detailQuestionResponse(mugs, "Czy jest dostępny w kolorze fioletowym?", "pl")?.needsModel, true);
});
