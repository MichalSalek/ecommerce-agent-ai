import { test, expect, type Page } from "@playwright/test";
import { products } from "../../src/data/products";

const headers = { "x-vercel-ai-ui-message-stream": "v1" };
const sse = (chunks: object[]) =>
  chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
  "data: [DONE]\n\n";
const answer = (parts: object[]) =>
  sse([
    { type: "start", messageId: `answer-${crypto.randomUUID()}` },
    ...parts,
    { type: "finish" },
  ]);
async function send(page: Page, text: string) {
  await page.getByRole("textbox").fill(text);
  await page.getByRole("textbox").press("Enter");
}
function evidence(count: number) {
  return {
    evidenceId: `e-${count}`,
    products: products.slice(0, count).map(({ id }) => ({ id })),
    appliedCriteria: {},
    outcome: "matches",
    requestedCount: count,
    scopeTotal: products.length,
    totalMatches: products.length,
    unseenMatches: products.length,
    remainingMatches: products.length - count,
  };
}

test("shows all five and ten results and preserves contextual follow-ups", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    expect(route.request().postDataJSON().contract).toBe("shopping-v3");
    const count = ++calls === 1 ? 5 : 10;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: answer([{ type: "data-products", data: evidence(count) }]),
    });
  });
  await page.goto("/chat");
  await send(page, "Show five products");
  await expect(
    page.locator(".chat-products").last().locator(".product"),
  ).toHaveCount(5);
  await expect(page.getByText(`In scope: ${products.length}`)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show other options" }),
  ).toBeVisible();
  await send(page, "Show ten products");
  await expect(
    page.locator(".chat-products").last().locator(".product"),
  ).toHaveCount(10);
  await expect(page.getByText("Showing 10 products")).toBeVisible();
});

test("selected product cards do not show catalog search counts, including after reload", async ({
  page,
}) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: answer([
        {
          type: "data-products",
          data: {
            evidenceId: "selection",
            evidenceKind: "selection",
            products: [{ id: "mugs" }],
            appliedCriteria: {},
            outcome: "matches",
            requestedCount: 5,
            scopeTotal: 1,
            totalMatches: 1,
            unseenMatches: 1,
            remainingMatches: 0,
          },
        },
      ]),
    });
  });
  await page.goto("/chat");
  await send(page, "Tell me about the mugs");
  const results = page.locator(".product-results");
  const check = async () => {
    await expect(results.locator(".product.compact")).toHaveCount(1);
    await expect(
      results.getByRole("link", { name: "Ceramic mugs", exact: true }),
    ).toBeVisible();
    await expect(results.getByText("Showing 1 product")).toBeVisible();
    await expect(results.locator(".result-counts")).toHaveCount(0);
    await expect(results.locator(".result-explanation")).toHaveCount(0);
  };
  await check();
  await page.reload();
  await check();
});

test("comparison after details names the original five displayed products", async ({
  page,
}) => {
  let calls = 0;
  const prompts: string[] = [];
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    calls++;
    prompts.push(body.messages.at(-1).parts[0].text);
    const part =
      calls === 1
        ? { type: "data-products", data: evidence(5) }
        : calls === 2
          ? {
              type: "data-products",
              data: {
                ...evidence(1),
                evidenceKind: "selection",
                products: [{ id: products[0].id }],
                scopeTotal: 1,
                totalMatches: 1,
                unseenMatches: 1,
                remainingMatches: 0,
              },
            }
          : {
              type: "text-delta",
              id: "reply",
              delta: "Comparing your selection.",
            };
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: answer(
        calls >= 3
          ? [
              { type: "text-start", id: "reply" },
              part,
              { type: "text-end", id: "reply" },
            ]
          : [part],
      ),
    });
  });
  await page.goto("/chat");
  await send(page, "Find coffee products");
  await expect(
    page.locator(".chat-products").last().locator(".product"),
  ).toHaveCount(5);
  await page.getByRole("button", { name: "More details" }).click();
  await expect(
    page.locator(".chat-products").last().locator(".product"),
  ).toHaveCount(1);
  expect(prompts[1]).toBe(`Tell me more about ${products[0].name}`);
  await page.getByRole("button", { name: "Compare these" }).click();
  await expect.poll(() => calls).toBe(3);
  expect(prompts[2]).toBe(
    `Compare ${products
      .slice(0, 5)
      .map((product) => product.name)
      .join(", ")}`,
  );
  await page.getByRole("button", { name: "Add the first to cart" }).click();
  await expect.poll(() => calls).toBe(4);
  expect(prompts[3]).toBe(`Add ${products[0].name} to my cart`);
});

test("restored legacy results replace a presentation failure with a canonical summary", async ({
  page,
}) => {
  await page.addInitScript(
    ({ savedEvidence }) => {
      sessionStorage.setItem(
        "aurelle.conversation.session.v1",
        JSON.stringify({
          version: 1,
          id: "legacy-failure",
          draft: "",
          messages: [
            {
              id: "user-legacy",
              role: "user",
              parts: [{ type: "text", text: "Find a mug" }],
            },
            {
              id: "assistant-legacy",
              role: "assistant",
              parts: [
                {
                  type: "text",
                  text: "OLD GENERIC FAILURE secret-provider-detail",
                },
                { type: "data-products", data: savedEvidence },
                { type: "data-turnStatus", data: { status: "partial" } },
                {
                  type: "data-turnStatus",
                  data: {
                    status: "connection-error",
                    code: "NETWORK_ERROR",
                    message:
                      "The connection was interrupted. Please try again.",
                  },
                },
              ],
            },
          ],
        }),
      );
    },
    { savedEvidence: evidence(1) },
  );
  await page.goto("/chat");
  await expect(page.locator(".chat-error")).toHaveCount(0);
  await expect(page.getByText(/Showing 1 product from 86 matching your criteria/)).toBeVisible();
  await expect(
    page.getByText(/OLD GENERIC FAILURE|secret-provider-detail/),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry last message" })).toHaveCount(0);
  await expect(page.locator(".product-results .product.compact")).toHaveCount(
    1,
  );
});

test("unknown HTTP error details are never shown in the conversation", async ({
  page,
}) => {
  await page.route("**/api/chat", async (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Retry-After": "30" },
      body: JSON.stringify({ error: "raw-secret-provider-error" }),
    }),
  );
  await page.goto("/chat");
  await send(page, "Find coffee");
  await expect(page.locator(".chat-error")).toHaveCount(1);
  await expect(
    page.getByText("The model provider has reached its limit."),
  ).toBeVisible();
  await expect(page.getByText(/raw-secret-provider-error/)).toHaveCount(0);
});

test("provider cooldown blocks retry while new requests and catalog starters remain available", async ({
  page,
}) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    calls++;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: answer([
        {
          type: "data-turnStatus",
          data: {
            status: "provider-limit",
            code: "PROVIDER_RATE_LIMIT",
            retryAt: now + 180_000,
            message: "The provider limit was reached.",
            providerLimit: {
              metric: "tokens",
              window: "day",
              limit: 200000,
              used: 199453,
              requested: 2390,
            },
          },
        },
      ]),
    });
  });
  await page.goto("/chat");
  await send(page, "Find coffee");
  await expect(page.getByText(/daily token limit/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry last message" }),
  ).toBeDisabled();
  await expect(page.locator(".chat-error")).toHaveCount(1);
  const thread = page.getByRole("log", { name: "Conversation messages" });
  await expect(thread.getByRole("alert")).toHaveCount(0);
  await expect(
    thread.getByText("The response could not be completed. Please try again."),
  ).toHaveCount(0);
  await page.getByRole("textbox").fill("Keep this draft");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  expect(calls).toBe(1);
  const firstCountdown = await page.getByText(/^Retry in /).textContent();
  await page.clock.fastForward("00:02");
  await expect(page.getByText(/^Retry in /)).not.toHaveText(
    firstCountdown ?? "",
  );
  await page.reload();
  await expect(page.getByText(/daily token limit/)).toBeVisible();
  await expect(page.locator(".chat-error")).toHaveCount(1);
  await expect(thread.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Find coffee", { exact: true })).toBeVisible();
  await expect(page.getByText(/no saved response/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Resume response" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry last message" }),
  ).toBeDisabled();
  await expect(page.getByRole("textbox")).toHaveValue("Keep this draft");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(
    page.getByRole("button", { name: "My morning coffee", exact: true }),
  ).toBeEnabled();
  await page.clock.fastForward("03:01");
  await expect(
    page.getByRole("button", { name: "My morning coffee", exact: true }),
  ).toBeEnabled();
  expect(calls).toBe(1);
});

test("transient progress animates and stopped or reset streams cannot update it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      if (new URL(String(input), location.href).pathname !== "/api/chat")
        return original(input, init);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const sendPart = (part: object) =>
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(part)}\n\n`),
            );
          sendPart({ type: "start", messageId: crypto.randomUUID() });
          sendPart({
            type: "data-progress",
            transient: true,
            data: { phase: "catalog", startedAt: Date.now() },
          });
          (window as unknown as { emitSwitch: () => void }).emitSwitch = () =>
            sendPart({
              type: "data-progress",
              transient: true,
              data: { phase: "provider-switch", startedAt: Date.now() },
            });
          (window as unknown as { emitLate: () => void }).emitLate = () => {
            try {
              sendPart({
                type: "data-progress",
                transient: true,
                data: { phase: "cart", startedAt: Date.now() },
              });
            } catch {}
          };
          init?.signal?.addEventListener(
            "abort",
            () => {
              try {
                controller.error(new DOMException("Aborted", "AbortError"));
              } catch {}
            },
            { once: true },
          );
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
    };
  });
  await page.goto("/chat");
  await send(page, "Find products");
  await expect(page.getByText("Searching the collection…")).toBeVisible();
  expect(
    await page
      .locator(".progress-dots")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).not.toBe("none");
  await page.evaluate(() =>
    (window as unknown as { emitSwitch: () => void }).emitSwitch(),
  );
  await expect(
    page.getByText("Switching to an available model…"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop response" }).click();
  await page.evaluate(() =>
    (window as unknown as { emitLate: () => void }).emitLate(),
  );
  await expect(page.locator(".chat-progress")).toHaveCount(0);
  await send(page, "Try another search");
  await expect(page.getByText("Searching the collection…")).toBeVisible();
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.evaluate(() =>
    (window as unknown as { emitLate: () => void }).emitLate(),
  );
  await expect(page.locator(".chat-progress")).toHaveCount(0);
  await expect(page.getByText("Preparing your cart selection…")).toHaveCount(0);
});

test("pre-stream request limit uses one disabled failure panel", async ({
  page,
}) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    calls++;
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Retry-After": "30" },
      body: JSON.stringify({
        code: "REQUEST_LIMIT",
        message: "The demo has reached its hourly request limit.",
        retryAt: now + 30_000,
        retryAfter: 30,
      }),
    });
  });
  await page.goto("/chat");
  await send(page, "Find coffee");
  await expect(
    page.getByText("The demo has reached its hourly request limit."),
  ).toBeVisible();
  await expect(page.locator(".chat-error")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Retry last message" }),
  ).toBeDisabled();
  await page.getByRole("textbox").fill("Keep this text");
  expect(calls).toBe(1);
  await page.reload();
  await expect(
    page.getByText("The demo has reached its hourly request limit."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  expect(calls).toBe(1);
});

test("category selection sends a chat turn and product details survive Back and reload", async ({
  page,
}) => {
  const categories = [...new Set(products.map((product) => product.category))]
    .sort()
    .map((name) => {
      const rows = products
        .filter((product) => product.category === name)
        .sort((a, b) => a.id.localeCompare(b.id));
      return {
        name,
        count: rows.length,
        exampleId: (rows.find((product) => product.inStock) ?? rows[0]).id,
      };
    });
  expect(categories).toHaveLength(10);
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    if (calls === 2)
      expect(body.messages.at(-1).parts[0].text).toBe(
        `Show me products in category ${categories[0].name}`,
      );
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: answer([{ type: "data-categories", data: categories }]),
    });
  });
  await page.goto("/chat");
  await send(page, "Show categories");
  await expect(page.locator(".category-result")).toHaveCount(10);
  const example = products.find(
    (product) => product.id === categories[0].exampleId,
  )!;
  await page
    .locator(".category-result")
    .first()
    .getByRole("link", { name: `View ${example.name}` })
    .click();
  await expect(page).toHaveURL(example.productUrl);
  await page.goBack();
  await expect(page.locator(".category-result")).toHaveCount(10);
  await page.reload();
  await expect(page.locator(".category-result")).toHaveCount(10);
  await page
    .locator(".category-result")
    .first()
    .getByRole("button", { name: categories[0].name })
    .click();
  await expect.poll(() => calls).toBe(2);
});

test("comparison of ten products fits a phone and uses server price differences", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const selected = products.slice(0, 10);
  const minimum = Math.min(
    ...selected.map((product) => Math.round(product.price * 100)),
  );
  await page.route("**/api/chat", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: answer([
        {
          type: "data-comparison",
          data: {
            productIds: selected.map(({ id }) => id),
            cheapestIds: selected
              .filter((product) => Math.round(product.price * 100) === minimum)
              .map(({ id }) => id),
            differencesCents: selected.map((product) => ({
              productId: product.id,
              cents: Math.round(product.price * 100) - minimum,
            })),
          },
        },
      ]),
    }),
  );
  await page.goto("/chat");
  await send(page, "Compare ten products");
  await expect(page.locator(".comparison-product")).toHaveCount(10);
  await expect(page.getByText(/lowest price/).first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("bulk cart receipt follows successful storage and survives reload", async ({
  page,
}) => {
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    const userMessageId = body.messages
      .filter((message: { role: string }) => message.role === "user")
      .at(-1).id;
    const items = [
      { productId: "mugs", quantity: 2 },
      { productId: "carafe", quantity: 1 },
    ];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: answer([
        {
          type: "data-cartAction",
          transient: true,
          data: {
            operationId: `${body.conversationId}:${userMessageId}`,
            userMessageId,
            ...items[0],
            items,
          },
        },
      ]),
    });
  });
  await page.goto("/chat");
  await send(page, "Add two mugs and a carafe");
  await expect(page.getByText("2 × Ceramic mugs")).toBeVisible();
  await expect(page.getByText("1 × Glass carafe")).toBeVisible();
  await page.reload();
  await expect(page.getByText("2 × Ceramic mugs")).toBeVisible();
  await expect(page.getByText("1 × Glass carafe")).toBeVisible();
});

async function blockCartWrites(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("test.blockCart") === null)
      sessionStorage.setItem("test.blockCart", "yes");
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        key === "aurelle.cart.v1" &&
        sessionStorage.getItem("test.blockCart") === "yes"
      )
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return write.call(this, key, value);
    };
  });
}

function mockCartAction(page: Page) {
  let calls = 0;
  let operationId = "";
  const install = page.route("**/api/chat", async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    const userMessageId = body.messages
      .filter((message: { role: string }) => message.role === "user")
      .at(-1).id;
    operationId = `${body.conversationId}:${userMessageId}`;
    const items = [
      { productId: "mugs", quantity: 2 },
      { productId: "carafe", quantity: 1 },
    ];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: answer([
        { type: "text-start", id: "reply" },
        { type: "text-delta", id: "reply", delta: "Your selection is ready." },
        { type: "text-end", id: "reply" },
        {
          type: "data-cartAction",
          data: { operationId, userMessageId, ...items[0], items },
        },
      ]),
    });
  });
  return { install, calls: () => calls, operationId: () => operationId };
}

test("failed bulk cart save can be retried once with the same operation", async ({
  page,
}) => {
  await blockCartWrites(page);
  const api = mockCartAction(page);
  await api.install;
  await page.goto("/chat");
  await send(page, "Add two mugs and a carafe");
  await expect(page.getByText(/cart could not be saved/)).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("aurelle.cart.v1")),
  ).toBeNull();
  await page.evaluate(() => sessionStorage.setItem("test.blockCart", "no"));
  await page.getByRole("button", { name: "Retry adding to cart" }).click();
  await expect(page.getByText("2 × Ceramic mugs")).toBeVisible();
  await expect(page.getByText("1 × Glass carafe")).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("aurelle.cart.v1")!),
  );
  expect(saved.lines).toEqual([
    { productId: "mugs", quantity: 2 },
    { productId: "carafe", quantity: 1 },
  ]);
  expect(saved.executedOperations).toEqual([api.operationId()]);
  expect(saved.receipts[0].operationId).toBe(api.operationId());
  expect(api.calls()).toBe(1);
  await page.reload();
  await expect(page.getByText("2 × Ceramic mugs")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry adding to cart" }),
  ).toHaveCount(0);
  expect(api.calls()).toBe(1);
});

test("restoring a failed cart action never replays it", async ({ page }) => {
  await blockCartWrites(page);
  const api = mockCartAction(page);
  await api.install;
  await page.goto("/chat");
  await send(page, "Add two mugs and a carafe");
  await expect(
    page.getByRole("button", { name: "Retry adding to cart" }),
  ).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("test.blockCart", "no"));
  await page.reload();
  await expect(page.getByText("Your selection is ready.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry adding to cart" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("aurelle.cart.v1")),
  ).toBeNull();
  expect(api.calls()).toBe(1);
});

test("a cart ledger entry wins over manual retry", async ({ page }) => {
  await blockCartWrites(page);
  const api = mockCartAction(page);
  await api.install;
  await page.goto("/chat");
  await send(page, "Add two mugs and a carafe");
  await expect(
    page.getByRole("button", { name: "Retry adding to cart" }),
  ).toBeVisible();
  await page.evaluate((operationId) => {
    sessionStorage.setItem("test.blockCart", "no");
    const saved = JSON.stringify({
      version: 1,
      lines: [
        { productId: "mugs", quantity: 2 },
        { productId: "carafe", quantity: 1 },
      ],
      executedOperations: [operationId],
      receipts: [],
    });
    localStorage.setItem("aurelle.cart.v1", saved);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "aurelle.cart.v1", newValue: saved }),
    );
  }, api.operationId());
  await page.getByRole("button", { name: "Retry adding to cart" }).click();
  await expect(
    page.getByText("This request was already processed."),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("aurelle.cart.v1")!),
  );
  expect(saved.lines).toEqual([
    { productId: "mugs", quantity: 2 },
    { productId: "carafe", quantity: 1 },
  ]);
  expect(saved.executedOperations).toEqual([api.operationId()]);
  expect(api.calls()).toBe(1);
});

test("a partial twentieth response can retry the same user turn", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("aurelle.conversation.session.v1")) return;
    const messages = Array.from({ length: 20 }, (_, i) => [
      {
        id: `u-${i}`,
        role: "user",
        parts: [{ type: "text", text: `Question ${i}` }],
      },
      {
        id: `a-${i}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: i === 19 ? "The response is incomplete." : "Earlier reply.",
          },
          ...(i === 19
            ? [{ type: "data-turnStatus", data: { status: "partial" } }]
            : []),
        ],
      },
    ]).flat();
    sessionStorage.setItem(
      "aurelle.conversation.session.v1",
      JSON.stringify({ version: 1, id: "partial20", draft: "", messages }),
    );
  });
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    calls++;
    expect(
      body.messages.filter((m: { role: string }) => m.role === "user"),
    ).toHaveLength(20);
    expect(body.messages.at(-1).id).toBe("u-19");
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: answer([
        { type: "text-start", id: "reply" },
        { type: "text-delta", id: "reply", delta: "Recovered final response." },
        { type: "text-end", id: "reply" },
      ]),
    });
  });
  await page.goto("/chat");
  await expect(page.getByRole("textbox")).toBeDisabled();
  await page.getByRole("button", { name: "Retry last message" }).click();
  await expect(page.getByText("Recovered final response.")).toBeVisible();
  expect(calls).toBe(1);
  await page.reload();
  await expect(page.getByText("Recovered final response.")).toBeVisible();
});
