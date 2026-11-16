import { test } from "node:test";
import assert from "node:assert/strict";
import { queryLanguageError } from "../src/application/chat/query-language";
import { productKinds, productTypes } from "../src/domain/catalog/taxonomy";

test("canonical English taxonomy labels are valid encoder queries", () => {
  for (const term of [
    "garden furniture",
    "outdoor furniture",
    ...Object.values({ ...productKinds, ...productTypes }).map((x) => x.en),
  ])
    assert.equal(queryLanguageError(term), undefined, term);
});
test("Polish queries still require translation and accepted coffee queries keep their result", () => {
  for (const text of ["meble ogrodowe", "krzesło do ogrodu", "kubki do kawy"])
    assert.equal(queryLanguageError(text)?.code, "QUERY_LANGUAGE", text);
  for (const text of ["morning coffee", "coffee", ""])
    assert.equal(queryLanguageError(text), undefined, text);
});
