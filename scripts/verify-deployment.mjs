import assert from "node:assert/strict";
const target = process.argv[2];
if (!target)
  throw new Error(
    "Usage: npm run verify:deployment -- https://your-service.onrender.com [expected-commit]",
  );
const base = new URL(target).href.replace(/\/$/, "");
const expected = process.argv[3];
const healthResponse = await fetch(`${base}/api/health`, {
  signal: AbortSignal.timeout(90000),
  headers: { "Cache-Control": "no-cache" },
});
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.status, "ok");
assert.equal(health.service, "aurelle");
assert.equal(health.embeddingProfile, "minilm");
assert.equal(health.productCount, 86);
assert.equal(health.preparedIndex?.productCount, 86);
assert.ok(health.indexFingerprint);
assert.equal(health.preparedIndex?.fingerprint, health.indexFingerprint);
assert.ok(health.revision, "Missing deployed revision");
if (expected) assert.equal(health.revision, expected);
console.log("[VERIFY] health", JSON.stringify(health));
for (const path of [
  "/",
  "/chat",
  "/products/mugs",
  "/products/outdoor-bistro-table",
  "/cart",
  "/images/products/folding-garden-chair.webp",
]) {
  const response = await fetch(base + path, {
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, `Route ${path}`);
  if (path.endsWith(".webp"))
    assert.ok(response.headers.get("content-type")?.startsWith("image/"));
}
const response = await fetch(`${base}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    contract: "shopping-v3",
    conversationId: crypto.randomUUID(),
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        metadata: { shoppingAction: { type: "search", preset: "budget", requestedCount: 10 } },
        parts: [
          { type: "text", text: "Show me ten products from the collection" },
        ],
      },
    ],
  }),
  signal: AbortSignal.timeout(120000),
});
if (!response.ok)
  throw new Error(
    `Chat API HTTP ${response.status}; Retry-After ${response.headers.get("retry-after") ?? "not reported"}; ${await response.text()}`,
  );
const raw = await response.text();
const events = raw
  .split(/\r?\n/)
  .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
  .map((line) => JSON.parse(line.slice(6)));
const status = events.find((event) => event.type === "data-turnStatus")?.data;
if (
  status?.status !== "complete" ||
  events.some((event) => event.type === "error")
)
  throw new Error(
    `Chat did not complete: ${status?.status ?? "stream error"}, Retry-After ${status?.retryAfter ?? "not reported"} seconds; window not reported`,
  );
const evidence = events.find((event) => event.type === "data-products")?.data;
assert.equal(evidence?.products.length, 10, "Expected ten displayed products");
assert.ok(
  evidence.totalMatches >= 10 && evidence.scopeTotal >= evidence.totalMatches,
);
assert.equal(
  evidence.unseenMatches - evidence.products.length,
  evidence.remainingMatches,
);
assert.ok(
  events.some((event) => event.type === "data-shoppingState"),
  "Missing conversation checkpoint",
);
assert.ok(
  events.some((event) => event.type === "text-delta" && event.delta.trim()),
  "Missing assistant response",
);
assert.ok(
  !events.some((event) => event.type.startsWith("tool-")),
  "Internal tool output was exposed",
);
console.log(
  "[VERIFY] shopping-v3 smoke: ten cards, checkpoint, counts and completed status",
  JSON.stringify(status.usage ?? {}),
);
console.log(
  "[VERIFY] Deployment checks passed: revision, prepared index, catalog, routes, photos and one shopping-v3 turn. Verify real provider and full conversational acceptance separately.",
);
