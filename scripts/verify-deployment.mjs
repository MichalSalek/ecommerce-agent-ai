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
assert.equal(health.preparedIndex?.productCount, health.productCount);
assert.equal(health.preparedIndex?.fingerprint, health.indexFingerprint);
if (expected) assert.equal(health.revision, expected);
console.log("[VERIFY] health", JSON.stringify(health));
for (const path of [
  "/",
  "/chat",
  "/products/mugs",
  "/products/outdoor-bistro-table",
  "/cart",
  "/images/products/folding-garden-chair.webp",
])
  assert.equal(
    (await fetch(base + path, { signal: AbortSignal.timeout(30000) })).status,
    200,
    `Route ${path}`,
  );
async function chat(text) {
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text }],
        },
      ],
    }),
    signal: AbortSignal.timeout(100000),
  });
  assert.equal(response.status, 200);
  const raw = await response.text();
  const events = raw
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
  assert.ok(
    !events.some((event) => event.type === "error"),
    "Chat stream reported an error",
  );
  return events;
}
const coffee = await chat("I need something for my morning coffee");
assert.ok(
  coffee.some(
    (event) =>
      event.type === "tool-output-available" &&
      Array.isArray(event.output) &&
      event.output.length === 2,
  ),
);
console.log("[VERIFY] real retrieval returned two coffee recommendations");
// Delivery is a deterministic policy lookup. The shopping acceptance script also exercises real model planning.
const policy = await chat("How much is delivery?");
assert.ok(
  policy.some(
    (event) =>
      event.type === "tool-input-available" && event.toolName === "getPolicy",
  ),
  "The delivery policy tool did not run",
);
assert.ok(
  policy.some(
    (event) =>
      event.type === "tool-output-available" &&
      typeof event.output === "string" &&
      event.output.includes("EUR 4"),
  ),
);
console.log("[VERIFY] delivery-policy lookup returned canonical policy");
const categories = await chat(
  "jakie kategorie produktów macie dostępne na sklepie?",
);
assert.ok(
  categories.some(
    (event) =>
      event.type === "tool-output-available" &&
      Array.isArray(event.output) &&
      event.output.length >= 10,
  ),
);
console.log("[VERIFY] actual category discovery passed");
console.log(
  "[VERIFY] Deployment checks passed: revision, prepared index, 86-product catalog, routes/photos, legacy search, policy and categories. Browser shopping-v2/cart and live model planning have separate acceptance checks.",
);
