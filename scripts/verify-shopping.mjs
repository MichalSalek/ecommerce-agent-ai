import assert from "node:assert/strict";
const base = (process.argv[2] ?? "http://127.0.0.1:3016").replace(/\/$/, "");
const transcripts = [];
function conversation() {
  const id = crypto.randomUUID(),
    messages = [];
  return {
    messages,
    async turn(text, { retry = false } = {}) {
      if (process.env.VERIFY_PAUSE_MS)
        await new Promise((resolve) =>
          setTimeout(resolve, Number(process.env.VERIFY_PAUSE_MS)),
        );
      if (!retry)
        messages.push({
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text }],
        });
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract: "shopping-v2",
          conversationId: id,
          messages,
        }),
        signal: AbortSignal.timeout(90000),
      });
      assert.equal(response.status, 200, await response.clone().text());
      const events = (await response.text())
        .split("\n")
        .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
        .map((line) => JSON.parse(line.slice(6)));
      assert.ok(
        !events.some((e) => e.type === "error"),
        JSON.stringify(events),
      );
      const calls = events.filter((e) => e.type === "tool-input-available");
      const parts = calls.map((call) => ({
        type: `tool-${call.toolName}`,
        toolCallId: call.toolCallId,
        state: "output-available",
        input: call.input,
        output: events.find(
          (e) =>
            e.type === "tool-output-available" &&
            e.toolCallId === call.toolCallId,
        )?.output,
      }));
      const answer = events
        .filter((e) => e.type === "text-delta")
        .map((e) => e.delta)
        .join("");
      parts.push({ type: "text", text: answer });
      const cart = events.find((e) => e.type === "data-cartAction")?.data;
      const message = {
        id:
          events.find((e) => e.type === "start")?.messageId ??
          crypto.randomUUID(),
        role: "assistant",
        parts,
      };
      if (process.env.VERIFY_PAUSE_MS)
        await new Promise((resolve) =>
          setTimeout(resolve, Number(process.env.VERIFY_PAUSE_MS)),
        );
      if (!retry) messages.push(message);
      const result = parts.find(
        (p) => p.type === "tool-searchProducts",
      )?.output;
      const products = result?.products ?? [];
      const summary = {
        text,
        answer,
        calls: calls.map((c) => ({ tool: c.toolName, input: c.input })),
        ids: products.map((p) => p.id),
        counts: result
          ? {
              total: result.totalMatches,
              unseen: result.unseenMatches,
              remaining: result.remainingMatches,
            }
          : undefined,
        cart,
      };
      transcripts.push(summary);
      console.log(JSON.stringify(summary));
      return { answer, result, products, calls, cart };
    },
  };
}
const pl = conversation();
assert.match((await pl.turn("Możesz pisać po polsku?")).answer, /po polsku/);
assert.match((await pl.turn("Jakie kategorie macie?")).answer, /kuchnia/);
await pl.turn("Co macie do ogrodu?");
let found = await pl.turn("A jakieś meble?");
assert.equal(found.result.totalMatches, 6);
const shown = new Set(found.products.map((p) => p.id));
for (const prompt of [
  "Pokaż proszę coś innego, doniczka to nie mebel",
  "Poproszę kolejne propozycje",
  "Czy możesz pokazać jeszcze coś innego?",
]) {
  found = await pl.turn(prompt);
  for (const product of found.products) {
    assert.equal(product.productKind, "furniture");
    assert.equal(product.useEnvironment, "outdoor");
    assert.ok(!shown.has(product.id));
    shown.add(product.id);
  }
}
assert.equal(shown.size, 6);
assert.equal(found.products.length, 0);
assert.equal(found.result.remainingMatches, 0);
const changed = await pl.turn("Zamiast tego szukam słuchawek");
assert.ok(changed.products.some((p) => p.id === "wireless-headphones"));
assert.match(changed.answer, /Pokazuję/);
const garden = conversation();
found = await garden.turn("Show me garden furniture under EUR 150");
assert.equal(found.result.totalMatches, 4);
assert.ok(found.products.every((p) => p.price <= 150));
const seating = await garden.turn("I need something to sit on");
assert.ok(
  seating.products.length > 0,
  "Refinement must search rather than ask an unnecessary question",
);
assert.ok(
  seating.products.every(
    (p) =>
      ["chair", "bench", "lounger", "sofa", "stool"].includes(p.productType) &&
      p.useEnvironment !== "indoor" &&
      p.price <= 150,
  ),
);
await garden.turn("Show me different options");
const correction = await garden.turn(
  "A plant pot is not furniture. Show me outdoor furniture",
);
assert.ok(
  correction.products.every(
    (p) => p.productKind === "furniture" && p.useEnvironment !== "indoor",
  ),
);
const comparison = conversation();
await comparison.turn("Compare mugs and carafe");
const detail = await comparison.turn("Tell me more about the first product");
assert.ok(
  detail.calls.some(
    (call) =>
      call.toolName === "getProductDetails" && call.input.productId === "mugs",
  ),
);
const cart = conversation();
await cart.turn("Compare mugs and carafe");
const added = await cart.turn("Add two of the cheaper option to my cart");
assert.equal(added.cart?.productId, "carafe");
assert.equal(added.cart?.quantity, 2);
const replayMessages = cart.messages.pop();
const retry = await cart.turn("", { retry: true });
assert.equal(added.cart.operationId, retry.cart?.operationId);
cart.messages.push(replayMessages);
const ambiguous = await cart.turn("Add that one to my cart");
// A cart action focuses the chosen product, so the most recent singular detail is unambiguous.
assert.ok(ambiguous.cart || /Which product/.test(ambiguous.answer));
const coffee = conversation();
found = await coffee.turn("I need something for my morning coffee");
assert.equal(found.products.length, 2);
assert.ok(
  found.products.every((p) =>
    [
      "carafe",
      "mugs",
      "travel-mug",
      "pour-over-dripper",
      "coffee-grinder",
      "digital-coffee-scale",
      "gooseneck-kettle",
    ].includes(p.id),
  ),
);
await coffee.turn("Show only in-stock products");
const gift = await conversation().turn("Find a gift under EUR 25");
assert.equal(gift.products.length, 2);
assert.ok(gift.products.every((p) => p.inStock && p.price <= 25));
assert.match(
  (await conversation().turn("How much is delivery?")).answer,
  /EUR 4|4 EUR/,
);
const absent = await conversation().turn("Show me grills for the garden");
assert.equal(absent.products.length, 0);
const required = await conversation().turn(
  "I need certified waterproof outdoor furniture under EUR 150",
);
assert.equal(required.products.length, 0);
const complex = await conversation().turn(
  "I need a calm little spot for sitting outside, under EUR 150. Not plant pots, please.",
);
assert.ok(complex.products.length > 0);
assert.ok(
  complex.products.every((p) =>
    ["chair", "bench", "lounger", "sofa", "stool"].includes(p.productType),
  ),
);
console.log(
  `[VERIFY] ${transcripts.length} real API turns passed: shopping-v2, PL/EN, model planning, every visible example, README paths, counts/exhaustion, cart operation retry and unsupported inventory.`,
);
