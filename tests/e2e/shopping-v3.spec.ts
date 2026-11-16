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
    if (localStorage.getItem("aurelle.conversation.v1")) return;
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
    localStorage.setItem(
      "aurelle.conversation.v1",
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
