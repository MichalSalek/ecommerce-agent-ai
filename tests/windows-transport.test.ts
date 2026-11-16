import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWindowsCurlResponse } from "../src/infrastructure/chat/windows-fetch";
test("Windows curl preserves actual provider cooldown and rate headers", async () => {
  const response = parseWindowsCurlResponse(
    '{"error":"limited"}\nAURELLE_STATUS:429\nAURELLE_HEADERS:{"content-type":["application/json"],"retry-after":["7"],"x-ratelimit-remaining-tokens":["0"],"set-cookie":["ignored"]}',
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "7");
  assert.equal(response.headers.get("x-ratelimit-remaining-tokens"), "0");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(await response.text(), '{"error":"limited"}');
});
test("malformed status or header payload is not accepted as a provider response", () => {
  assert.throws(() =>
    parseWindowsCurlResponse("{}\nAURELLE_STATUS:0\nAURELLE_HEADERS:{}"),
  );
  assert.throws(() =>
    parseWindowsCurlResponse("{}\nAURELLE_STATUS:200\nAURELLE_HEADERS:broken"),
  );
});
