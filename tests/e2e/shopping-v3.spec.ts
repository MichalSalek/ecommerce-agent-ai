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
