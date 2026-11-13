import { test, expect, type Page } from "@playwright/test";
import { products } from "../../src/data/products";
function response(id: string) {
  const items = products.filter((p) => ["mugs", "carafe"].includes(p.id));
  const parts = [
    { type: "start", messageId: id },
    {
      type: "tool-input-available",
      toolCallId: id,
      toolName: "searchProducts",
      input: { query: "coffee" },
    },
    { type: "tool-output-available", toolCallId: id, output: items },
    { type: "text-start", id: "answer" },
    {
      type: "text-delta",
      id: "answer",
      delta:
        "These are two real options for your morning coffee. Would you prefer a mug or a carafe?",
    },
    { type: "text-end", id: "answer" },
    { type: "finish" },
  ];
  return (
    parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}
async function fixture(page: Page) {
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    calls++;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: response(`fixture-${calls}`),
    });
  });
  return () => calls;
}
test("Enter sends, Shift+Enter adds a line, Back/reload retain messages and draft, new conversation resets", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.goto("/chat");
  const input = page.getByRole("textbox");
  await expect(
    page.getByText("Welcome to Aurelle.", { exact: false }),
  ).toBeVisible();
  await input.fill("First line");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("First line\n");
  expect(calls()).toBe(0);
  await input.fill("I need something for my morning coffee");
  await input.press("Enter");
  await expect(page.locator(".product.compact")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeVisible();
  expect(calls()).toBe(1);
  await input.fill("My next question");
  await page
    .locator(".product.compact")
    .first()
    .getByRole("link")
    .first()
    .click();
  await expect(page).toHaveURL(/\/products\/mugs/);
  await page.goBack();
  await expect(page.locator(".product.compact")).toHaveCount(2);
  await expect(input).toHaveValue("My next question");
  await page.reload();
  await expect(page.locator(".product.compact")).toHaveCount(2);
  await expect(input).toHaveValue("My next question");
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.locator(".product.compact")).toHaveCount(0);
  await expect(input).toHaveValue("");
  await expect(
    page.getByText("Welcome to Aurelle.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".chat-message.user")).toHaveCount(0);
});
test("reset cancels a pending response without letting it enter the new conversation", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/chat", async (route) => {
    await delayed;
    await route
      .fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "x-vercel-ai-ui-message-stream": "v1" },
        body: response("obsolete"),
      })
      .catch(() => undefined);
  });
  await page.goto("/chat");
  await page
    .getByRole("textbox")
    .fill("I need something for my morning coffee");
  await page.getByRole("textbox").press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop response" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New conversation" }).click();
  release();
  await expect(
    page.getByText("Welcome to Aurelle.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".chat-message.user")).toHaveCount(0);
  await expect(page.locator(".product.compact")).toHaveCount(0);
});
test("390px mobile keeps the composer reachable and the page free of horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto("/chat");
  await page.getByRole("button", { name: "My morning coffee" }).click();
  await expect(page.locator(".product.compact")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("incoming replies do not pull a reader away from older messages", async ({
  page,
}) => {
  let calls = 0;
  let release: () => void = () => undefined;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/chat", async (route) => {
    calls++;
    const id = calls;
    if (id === 5) await delayed;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: response(`scroll-${id}`),
    });
  });
  await page.goto("/chat");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("textbox").fill(`Coffee idea ${i}`);
    await page.getByRole("textbox").press("Enter");
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".product.compact")).toHaveCount((i + 1) * 2);
  }
  await page.getByRole("textbox").fill("Coffee idea final");
  await page.getByRole("textbox").press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop response" }),
  ).toBeVisible();
  await page.locator(".chat-thread").evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  release();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Latest response" }),
  ).toBeVisible();
  expect(
    await page.locator(".chat-thread").evaluate((el) => el.scrollTop),
  ).toBeLessThan(10);
  await page.getByRole("button", { name: "Latest response" }).click();
  await expect
    .poll(() =>
      page
        .locator(".chat-thread")
        .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(5);
});

test("failed product photos have a visible fallback without breaking recommendations", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/_next/image?*", (route) => route.abort());
  await page.goto("/chat");
  await page.getByRole("button", { name: "My morning coffee" }).click();
  await expect(page.locator(".product.compact")).toHaveCount(2);
  await expect(
    page.getByText("Image unavailable", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page
      .locator(".product.compact")
      .first()
      .getByRole("button", { name: "Add to cart" }),
  ).toBeEnabled();
});
