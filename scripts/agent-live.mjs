// Explicit live acceptance only: npm run test:agent:live -- <built-app-url>.
// Provider identity must additionally be verified from the target's runtime logs.
import assert from "node:assert/strict";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const target = process.argv[2];
if (!target)
  throw new Error("Usage: npm run test:agent:live -- <built-app-url>");
const targetUrl = new URL(target);
assert.ok(
  ["http:", "https:"].includes(targetUrl.protocol) &&
    !targetUrl.username &&
    !targetUrl.password &&
    !targetUrl.search &&
    !targetUrl.hash,
  "Use a plain HTTP(S) URL without credentials, query or fragment",
);
const base = targetUrl.href.replace(/\/$/, "");
const artifact =
  process.env.AGENT_LIVE_ARTIFACT ??
  join(tmpdir(), `aurelle-live-${Date.now()}.json`);
const tpm = Number(process.env.AGENT_LIVE_TPM ?? 8000);
const reserve = Number(process.env.AGENT_LIVE_TURN_RESERVE ?? 3000);
const interval = Number(process.env.AGENT_LIVE_INTERVAL_MS ?? 15000);
assert.ok(
  Number.isFinite(tpm) &&
    tpm > 0 &&
    Number.isFinite(reserve) &&
    reserve > 0 &&
    reserve <= tpm &&
    Number.isFinite(interval) &&
    interval >= 0,
  "Invalid pacing configuration",
);
// Local fingerprints cover source and the dependency lock. A caller targeting a remote
// deployment can instead supply its immutable revision as AGENT_LIVE_INPUTS.
const root = fileURLToPath(new URL("../", import.meta.url));
async function sourceFiles(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...(await sourceFiles(path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}
async function hashFiles(paths) {
  const hash = createHash("sha256");
  for (const path of paths) {
    const content = await readFile(join(root, path));
    hash.update(`${path.length}:${path}:${content.length}:`);
    hash.update(content);
  }
  return hash.digest("hex");
}
const explicitInputs = process.env.AGENT_LIVE_INPUTS;
const fingerprint = explicitInputs
  ? {
      kind: "explicit",
      hash: createHash("sha256").update(explicitInputs).digest("hex"),
    }
  : {
      kind: "local-source",
      hash: await hashFiles([
        ...(await sourceFiles("src")),
        "package-lock.json",
      ]),
    };
const runnerHash = await hashFiles(["scripts/agent-live.mjs"]);
const resumePath = process.env.AGENT_LIVE_RESUME;
let previous;
if (resumePath) {
  assert.notEqual(
    resolve(resumePath),
    resolve(artifact),
    "Use a different output artifact when resuming so the prior run is preserved",
  );
  previous = JSON.parse(await readFile(resumePath, "utf8"));
  assert.ok(
    previous.fingerprint?.kind &&
      previous.fingerprint?.hash &&
      previous.runnerHash,
    "Resume artifact has no verifiable input and runner fingerprint; refusing reuse",
  );
  assert.deepEqual(
    previous.fingerprint,
    fingerprint,
    "Resume input fingerprint does not match current inputs",
  );
  assert.equal(
    previous.runnerHash,
    runnerHash,
    "Resume runner differs from the recorded runner",
  );
  assert.equal(previous.target, base, "Resume target does not match");
  assert.ok(Array.isArray(previous.conversations), "Invalid resume artifact");
}
const transcript = {
  target: base,
  started: new Date().toISOString(),
  fingerprint,
  runnerHash,
  ...(previous
    ? {
        previousRun: {
          artifact: resumePath,
          started: previous.started,
          finished: previous.finished ?? null,
        },
      }
    : {}),
  provider:
    "Verify Groq and exact model in the target runtime logs; health does not expose provider identity.",
  pacing: { tpm, reserve, interval, algorithm: "replenishing token bucket" },
  conversations: [],
  failures: [],
};
async function saveArtifact() {
  const temporary = `${artifact}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(transcript, null, 2), {
    mode: 0o600,
  });
  await rename(temporary, artifact);
}
// Begin empty to avoid assuming unused provider capacity, including traffic from
// other clients. This is pacing, not knowledge of the provider's shared quota.
const bucket = {
  tokens: 0,
  at: performance.now(),
  capacity: Math.max(reserve, tpm / 2),
};
let previousStart = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function refill() {
  const now = performance.now();
  bucket.tokens = Math.min(
    bucket.capacity,
    bucket.tokens + ((now - bucket.at) * tpm) / 60000,
  );
  bucket.at = now;
}
async function pace() {
  for (;;) {
    refill();
    const tokenWait = Math.max(0, ((reserve - bucket.tokens) * 60000) / tpm);
    const wait = Math.max(
      0,
      previousStart + interval - performance.now(),
      tokenWait,
    );
    if (wait < 1) break;
    console.log(
      `[PACE] waiting ${Math.ceil(wait / 1000)}s for replenishing token budget or interval`,
    );
    await sleep(Math.ceil(wait));
  }
  previousStart = performance.now();
}
function chargeUsage(usage) {
  // Groq's reported input includes cached tokens, which do not consume TPM.
  const input = Number(usage?.inputTokens);
  const cached = Number(usage?.cachedInputTokens);
  const output = Number(usage?.outputTokens);
  const tokens =
    Number.isFinite(input) &&
    input >= 0 &&
    Number.isFinite(output) &&
    output >= 0
      ? Math.max(
          0,
          input - (Number.isFinite(cached) && cached >= 0 ? cached : 0),
        ) + output
      : reserve;
  refill();
  bucket.tokens -= tokens; // Debt carries forward when a turn exceeds its reservation.
  return tokens;
}
const partsOf = (events, type) =>
  events.find((event) => event.type === type)?.data;
function checkCounts(result) {
  assert.ok(
    result && Array.isArray(result.products),
    "Expected typed search evidence",
  );
  assert.ok(
    result.products.length <= 10 &&
      new Set(result.products.map((p) => p.id)).size === result.products.length,
  );
  for (const field of [
    "requestedCount",
    "scopeTotal",
    "totalMatches",
    "unseenMatches",
    "remainingMatches",
  ])
    assert.ok(
      Number.isInteger(result[field]) && result[field] >= 0,
      `Invalid ${field}`,
    );
  assert.ok(result.totalMatches <= result.scopeTotal, "Matches exceed scope");
  assert.ok(
    result.unseenMatches <= result.totalMatches,
    "Unseen exceeds matching",
  );
  assert.equal(
    result.unseenMatches - (result.newlyShownCount ?? result.products.length),
    result.remainingMatches,
    "Remaining count does not match this page",
  );
}
function conversation(name, language) {
  const prior = previous?.conversations.find(
    (row) => row.name === name && row.language === language,
  );
  const entry = {
    name,
    language,
    id: prior?.id ?? crypto.randomUUID(),
    turns: [],
  };
  transcript.conversations.push(entry);
  let mayReuse = Boolean(prior);
  const messages = [];
  // Local simulation of a successful browser write; this is not evidence of a real cart write.
  const simulatedCart = new Map();
  const simulatedLedger = new Set();
  return {
    async turn(text) {
      const saved = mayReuse ? prior.turns[entry.turns.length] : undefined;
      if (
        saved?.validated &&
        saved.user === text &&
        saved.userMessage?.id &&
        saved.assistantMessage?.id &&
        saved.state?.userMessageId === saved.userMessage.id
      ) {
        assert.equal(
          saved.userMessage.parts?.[0]?.text,
          text,
          "Saved prompt mismatch",
        );
        assert.equal(
          saved.state.after?.language,
          language,
          "Saved language mismatch",
        );
        assert.equal(
          saved.status?.status,
          "complete",
          "Saved turn is incomplete",
        );
        if (saved.result) checkCounts(saved.result);
        const before = {
          lines: [...simulatedCart].map(([productId, quantity]) => ({
            productId,
            quantity,
          })),
        };
        assert.deepEqual(
          saved.simulatedCartBefore,
          before,
          "Saved simulated cart history mismatch",
        );
        if (saved.simulatedCartWrite) {
          assert.equal(saved.simulatedCartWrite.outcome, "success");
          simulatedCart.clear();
          for (const item of saved.simulatedCartWrite.lines)
            simulatedCart.set(item.productId, item.quantity);
          simulatedLedger.add(saved.simulatedCartWrite.operationId);
        }
        messages.push(saved.userMessage, saved.assistantMessage);
        entry.turns.push({ ...saved, reused: true });
        await saveArtifact();
        console.log(
          `[RESUME] ${name} turn ${entry.turns.length}: reused validated response`,
        );
        return {
          answer: saved.answer,
          state: saved.state.after,
          result: saved.result,
          categories: saved.categories,
          comparison: saved.comparison,
          cart: saved.cart,
        };
      }
      // Any changed, missing, or failed turn invalidates the rest of this history.
      mayReuse = false;
      await pace();
      const user = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
      };
      messages.push(user);
      const turn = {
        user: text,
        userMessage: user,
        sentAt: new Date().toISOString(),
      };
      entry.turns.push(turn);
      const cartSnapshot = {
        lines: [...simulatedCart].map(([productId, quantity]) => ({
          productId,
          quantity,
        })),
      };
      turn.simulatedCartBefore = cartSnapshot;
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract: "shopping-v3",
          conversationId: entry.id,
          messages,
          cart: cartSnapshot,
        }),
        signal: AbortSignal.timeout(120000),
      });
      turn.httpStatus = response.status;
      turn.rateHeaders = Object.fromEntries(
        [...response.headers].filter(([key]) =>
          /ratelimit|retry-after/i.test(key),
        ),
      );
      if (!response.ok) {
        const body = await response.text();
        turn.failure = {
          source: "application API",
          status: response.status,
          retryAfter: response.headers.get("retry-after"),
          body: body.slice(0, 1000),
          window: /hour/i.test(body)
            ? "application hourly window as reported"
            : "not reported",
        };
        throw new Error(
          `${name}: application API ${response.status}, Retry-After ${turn.failure.retryAfter ?? "not reported"}s, window ${turn.failure.window}: ${body.slice(0, 300)}`,
        );
      }
      const raw = await response.text();
      const events = raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
        .map((line) => JSON.parse(line.slice(6)));
      const status = partsOf(events, "data-turnStatus");
      const textAnswer = events
        .filter((event) => event.type === "text-delta")
        .map((event) => event.delta)
        .join("");
      const state = partsOf(events, "data-shoppingState");
      const result = partsOf(events, "data-products");
      const categories = partsOf(events, "data-categories");
      const comparison = partsOf(events, "data-comparison");
      const cart = partsOf(events, "data-cartAction");
      Object.assign(turn, {
        answer: textAnswer,
        status,
        state,
        result,
        categories,
        comparison,
        cart,
      });
      turn.chargedTokens = chargeUsage(status?.usage);
      if (
        status?.status !== "complete" ||
        events.some((event) => event.type === "error")
      ) {
        const source =
          status?.status === "provider-limit"
            ? "upstream provider"
            : "application/provider connection";
        throw new Error(
          `${name}: ${source} reported ${status?.status ?? "stream error"}; Retry-After ${status?.retryAfter ?? "not reported"} seconds; window not reported`,
        );
      }
      assert.ok(state?.after, `${name}: missing checkpoint`);
      assert.equal(state.after.language, language, `${name}: language changed`);
      assert.ok(
        textAnswer.trim().length >= 3,
        `${name}: missing natural response`,
      );
      assert.doesNotMatch(
        textAnswer,
        /\{\s*"(?:type|productIds|evidenceIds|status)"|<\/?(?:think|analysis)>|\b(?:tool_call|presentAnswer|searchProducts|evidenceId)\b|\[\[(?:price|name|count):/i,
        `${name}: internal output leaked`,
      );
      assert.ok(
        !events.some((event) => event.type.startsWith("tool-")),
        `${name}: raw tool output leaked`,
      );
      if (result) checkCounts(result);
      if (cart && !simulatedLedger.has(cart.operationId)) {
        const next = new Map(simulatedCart);
        for (const item of cart.items ?? [
          { productId: cart.productId, quantity: cart.quantity },
        ]) {
          assert.ok(
            typeof item.productId === "string" &&
              Number.isInteger(item.quantity) &&
              item.quantity > 0,
            "Invalid cart proposal",
          );
          const quantity = (next.get(item.productId) ?? 0) + item.quantity;
          assert.ok(quantity <= 99, "Simulated cart limit exceeded");
          next.set(item.productId, quantity);
        }
        simulatedCart.clear();
        for (const [id, quantity] of next) simulatedCart.set(id, quantity);
        simulatedLedger.add(cart.operationId);
        turn.simulatedCartWrite = {
          outcome: "success",
          operationId: cart.operationId,
          lines: [...simulatedCart].map(([productId, quantity]) => ({
            productId,
            quantity,
          })),
        };
      }
      const parts = [
        { type: "text", text: textAnswer },
        ...events
          .filter((event) =>
            [
              "data-shoppingState",
              "data-products",
              "data-categories",
              "data-comparison",
              "data-turnStatus",
            ].includes(event.type),
          )
          .map(({ type, data, id }) => ({ type, data, ...(id ? { id } : {}) })),
      ];
      const assistantMessage = {
        id:
          events.find((event) => event.type === "start")?.messageId ??
          crypto.randomUUID(),
        role: "assistant",
        parts,
      };
      messages.push(assistantMessage);
      turn.assistantMessage = assistantMessage;
      turn.validated = true;
      await saveArtifact();
      console.log(
        `[LIVE] ${name} turn ${entry.turns.length}: ${status.status}, ${status.usage?.inputTokens ?? "?"} input / ${status.usage?.outputTokens ?? "?"} output tokens`,
      );
      return {
        answer: textAnswer,
        state: state.after,
        result,
        categories,
        comparison,
        cart,
      };
    },
  };
}
const nonempty = (result) =>
  assert.ok(result?.products?.length > 0, "Expected product cards");
const comparisonCheck = (value) => {
  assert.ok(
    value &&
      value.productIds.includes("mugs") &&
      value.productIds.includes("carafe"),
    "Expected mugs and carafe",
  );
  assert.ok(
    value.cheapestIds.includes("carafe"),
    "Cheapest item differs from canonical prices",
  );
  assert.equal(
    value.differencesCents.find((row) => row.productId === "mugs")?.cents,
    300,
  );
};
const cartCheck = (value) => {
  assert.ok(value, "Explicit request did not produce a cart proposal");
  assert.equal(
    value.items?.find((item) => item.productId === "carafe")?.quantity,
    2,
  );
};
try {
  for (const [language, prompt] of [
    ["en", "I need something for my morning coffee"],
    ["pl", "Szukam czegoś do porannej kawy"],
  ]) {
    const c = conversation(`discovery-${language}`, language);
    nonempty((await c.turn(prompt)).result);
    await c.turn(
      language === "en"
        ? "Show only in-stock products"
        : "Pokaż tylko dostępne produkty",
    );
  }
  for (const [language, prompt, refine] of [
    [
      "en",
      "Show me garden furniture under EUR 150",
      "I need something to sit on",
    ],
    ["pl", "Co macie do ogrodu?", "A jakieś meble?"],
  ]) {
    const c = conversation(`garden-${language}`, language);
    const first = await c.turn(prompt);
    nonempty(first.result);
    const second = await c.turn(refine);
    nonempty(second.result);
    assert.equal(second.state.criteria.useEnvironment, "outdoor");
    assert.equal(second.state.criteria.productKind, "furniture");
    if (language === "en") assert.equal(second.state.criteria.maxPrice, 150);
    const next = await c.turn(
      language === "en"
        ? "Show me different options"
        : "Pokaż proszę coś innego, doniczka to nie mebel",
    );
    if (next.result)
      assert.equal(
        new Set(
          [...second.result.products, ...next.result.products].map((p) => p.id),
        ).size,
        second.result.products.length + next.result.products.length,
        "Alternative repeated a product",
      );
  }
  for (const [language, prompt] of [
    ["en", "What product categories do you have?"],
    ["pl", "Jakie kategorie produktów macie w sklepie?"],
  ]) {
    const categories = (
      await conversation(`categories-${language}`, language).turn(prompt)
    ).categories;
    assert.equal(categories?.length, 10);
    assert.equal(
      categories.reduce((sum, item) => sum + item.count, 0),
      86,
    );
    assert.ok(
      categories.every((item) => item.name && item.exampleId && item.count > 0),
    );
  }
  for (const [language, prompt, detail] of [
    ["en", "Compare mugs and carafe", "Tell me more about the first product"],
    ["pl", "Porównaj kubki i karafkę", "Powiedz więcej o pierwszym produkcie"],
  ]) {
    const c = conversation(`comparison-${language}`, language);
    comparisonCheck((await c.turn(prompt)).comparison);
    const result = await c.turn(detail);
    assert.ok(
      result.state.lastIds.includes("mugs"),
      "First-product reference was not resolved",
    );
  }
  for (const [language, first, correction] of [
    [
      "en",
      "Show me garden furniture under EUR 150",
      "A plant pot is not furniture. Show me outdoor furniture",
    ],
    [
      "pl",
      "Pokaż meble ogrodowe do 150 EUR",
      "Doniczka nie jest meblem. Pokaż meble do ogrodu",
    ],
  ]) {
    const c = conversation(`correction-${language}`, language);
    nonempty((await c.turn(first)).result);
    const result = await c.turn(correction);
    nonempty(result.result);
    assert.equal(result.state.criteria.productKind, "furniture");
    assert.equal(result.state.criteria.useEnvironment, "outdoor");
  }
  for (const [language, compare, add] of [
    [
      "en",
      "Compare mugs and carafe",
      "Add two of the cheaper option to my cart",
    ],
    [
      "pl",
      "Porównaj kubki i karafkę",
      "Dodaj dwie sztuki tańszego produktu do koszyka",
    ],
  ]) {
    const c = conversation(`cart-${language}`, language);
    comparisonCheck((await c.turn(compare)).comparison);
    cartCheck((await c.turn(add)).cart);
  }
  const c = conversation("twenty-turn-polish", "pl");
  const prompts = [
    "Pisz po polsku. Pokaż meble ogrodowe do 150 EUR.",
    "Szukam czegoś do siedzenia.",
    "Pokaż inne propozycje.",
    "Powiedz więcej o pierwszej propozycji.",
    "Czy te produkty nadają się do ogrodu?",
    "Pokaż tylko dostępne produkty.",
    "Jaki nadal obowiązuje mój limit cenowy?",
    "Porównaj kubki i karafkę.",
    "Dodaj dwie sztuki tańszego produktu do koszyka.",
    "Powiedz więcej o karafce.",
    "Z czego jest zrobiona?",
    "Jakie ma ograniczenia?",
    "Ile kosztuje dostawa?",
    "Jakie są zasady zwrotu?",
    "Czy to sklep demonstracyjny?",
    "Czy mogę obejrzeć szczegóły produktu?",
    "Pisz dalej po polsku.",
    "Przypomnij, który produkt z porównania był tańszy.",
    "Jaką ilość wybrałem wcześniej?",
    "Dziękuję za pomoc.",
  ];
  assert.equal(prompts.length, 20);
  for (let i = 0; i < prompts.length; i++) {
    const turn = await c.turn(prompts[i]);
    if (i === 0 || i === 1 || i === 2 || i === 5) {
      assert.equal(turn.state.criteria.maxPrice, 150);
      assert.equal(turn.state.criteria.useEnvironment, "outdoor");
    }
    if (i === 7) comparisonCheck(turn.comparison);
    if (i === 8) cartCheck(turn.cart);
    if (i >= 8)
      assert.ok(
        turn.state.comparisonIds.includes("mugs") &&
          turn.state.comparisonIds.includes("carafe"),
        "Comparison context was lost",
      );
    if (i === 17)
      assert.match(
        turn.answer,
        /carafe|karaf/i,
        "Cheaper product reference was lost",
      );
    if (i === 18)
      assert.match(
        turn.answer,
        /\b2\b|dwie|dwa/i,
        "Cart quantity was not recalled",
      );
  }
  const gift = await conversation("readme-gift-en", "en").turn(
    "Find a gift under EUR 25",
  );
  nonempty(gift.result);
  assert.equal(gift.state.criteria.maxPrice, 25);
  await conversation("readme-delivery-en", "en").turn("How much is delivery?");
  transcript.finished = new Date().toISOString();
  console.log(
    `[VERIFY] ${transcript.conversations.length} live conversations passed. Verify provider/model separately from server logs. Artifact: ${artifact}`,
  );
} catch (error) {
  // Scenario assertions run immediately after a turn returns. If one fails,
  // do not treat that response as a successful turn on the next resume.
  const lastTurn = transcript.conversations.at(-1)?.turns.at(-1);
  if (lastTurn) {
    lastTurn.validated = false;
    lastTurn.failure ??= { source: "acceptance", message: error.message };
  }
  transcript.failures.push({ message: error.message });
  transcript.finished = new Date().toISOString();
  console.error(`[FAIL] ${error.message}. Artifact: ${artifact}`);
  process.exitCode = 1;
} finally {
  await saveArtifact();
}
