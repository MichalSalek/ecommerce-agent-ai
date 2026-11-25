import { test, expect, type Page } from "@playwright/test";
import { products } from "../../src/data/products";

const headers = { "x-vercel-ai-ui-message-stream": "v1" };
const sse = (chunks: object[]) =>
  chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
  "data: [DONE]\n\n";
async function send(page: Page, text: string) {
  await page.getByRole("textbox").fill(text);
  await page.getByRole("textbox").press("Enter");
}
function cartAction(
  body: { conversationId: string; messages: { id: string; role: string }[] },
  quantity = 2,
) {
  const userMessageId = body.messages
    .filter((message) => message.role === "user")
    .at(-1)!.id;
  return {
    operationId: `${body.conversationId}:${userMessageId}`,
    userMessageId,
    productId: "mugs",
    quantity,
  };
}
function actionStream(action: ReturnType<typeof cartAction>, error = false) {
  return sse([
    { type: "start", messageId: "answer" },
    { type: "data-cartAction", data: action, transient: true },
    { type: "data-cartAction", data: action, transient: true },
    ...(error
      ? [{ type: "error", errorText: "Temporary failure" }]
      : [
          { type: "text-start", id: "text" },
          { type: "text-delta", id: "text", delta: "Your selection is ready." },
          { type: "text-end", id: "text" },
          { type: "finish" },
        ]),
  ]);
}

test("live cart action is applied once across duplicate chunks, retry and reload", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.contract).toBe("shopping-v3");
    expect(body.conversationId).toBeTruthy();
    calls++;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: actionStream(cartAction(body), calls === 1),
    });
  });
  await page.goto("/chat");
  await send(page, "Add two mugs");
  await expect(
    page.getByText("Added 2 × Ceramic mugs to your cart."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry last message" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry last message" }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByText("Your selection is ready.")).toBeVisible();
  const cart = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("aurelle.cart.v1")!));
  expect((await cart()).lines).toEqual([{ productId: "mugs", quantity: 2 }]);
  expect((await cart()).executedOperations).toHaveLength(1);
  await page.reload();
  expect((await cart()).lines).toEqual([{ productId: "mugs", quantity: 2 }]);
  await expect(
    page.getByText("Added 2 × Ceramic mugs to your cart."),
  ).toBeVisible();
  await page.getByRole("link", { name: /Cart/ }).first().click();
  await expect(page.getByRole("spinbutton")).toHaveValue("2");
});

test("old history and a response cancelled by reset cannot mutate the cart", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "aurelle.conversation.session.v1",
      JSON.stringify({
        version: 1,
        id: "old",
        draft: "",
        messages: [
          {
            id: "u-old",
            role: "user",
            parts: [{ type: "text", text: "Add mugs" }],
          },
          {
            id: "a-old",
            role: "assistant",
            parts: [
              { type: "text", text: "Earlier conversation." },
              {
                type: "data-cartAction",
                data: {
                  operationId: "old:u-old",
                  userMessageId: "u-old",
                  productId: "mugs",
                  quantity: 2,
                },
              },
            ],
          },
        ],
      }),
    );
  });
  let release: () => void = () => undefined;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    await delayed;
    await route
      .fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers,
        body: actionStream(cartAction(body)),
      })
      .catch(() => undefined);
  });
  await page.goto("/chat");
  await expect(page.getByText("Earlier conversation.")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("aurelle.cart.v1")),
  ).toBeNull();
  await send(page, "Add mugs again");
  await expect(
    page.getByRole("button", { name: "Stop response" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New conversation" }).click();
  release();
  await expect(
    page.getByText("Welcome to Aurelle.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".chat-cart-feedback")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("aurelle.cart.v1")),
  ).toBeNull();
});

test("overflow does not claim that an item was added", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "aurelle.cart.v1",
      JSON.stringify({
        version: 1,
        lines: [{ productId: "mugs", quantity: 98 }],
      }),
    );
  });
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: actionStream(cartAction(body)),
    });
  });
  await page.goto("/chat");
  await send(page, "Add two mugs");
  await expect(
    page.getByText("The cart cannot hold more than 99 of this item."),
  ).toBeVisible();
  await expect(page.getByText(/Added 2 ×/)).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("aurelle.cart.v1")!).lines[0].quantity,
    ),
  ).toBe(98);
});

test("a failed cart write neither changes the cart nor claims success", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "aurelle.cart.v1")
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return write.call(this, key, value);
    };
  });
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: actionStream(cartAction(body)),
    });
  });
  await page.goto("/chat");
  await send(page, "Add two mugs");
  await expect(
    page.getByText(
      "The cart could not be saved, so this item was not added. Please try again.",
    ),
  ).toBeVisible();
  await expect(page.getByText(/Added 2 ×/)).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("aurelle.cart.v1")),
  ).toBeNull();
});

test("product button reports the cart limit instead of a false addition", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "aurelle.cart.v1",
      JSON.stringify({
        version: 1,
        lines: [{ productId: "mugs", quantity: 99 }],
      }),
    );
  });
  await page.goto("/products/mugs");
  await page
    .locator(".product-detail")
    .getByRole("button", { name: "Add to cart" })
    .click();
  await expect(
    page.getByText("The cart cannot hold more than 99 of this item."),
  ).toBeVisible();
  await expect(page.getByText("Added to your cart.")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("aurelle.cart.v1")!).lines[0].quantity,
    ),
  ).toBe(99);
});

test("search envelopes show actual page size and hide exhausted suggestions", async ({
  page,
}) => {
  const selected = products.filter((product) =>
    ["mugs", "carafe"].includes(product.id),
  );
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers,
      body: sse([
        { type: "start", messageId: "search" },
        {
          type: "tool-input-available",
          toolCallId: "call",
          toolName: "searchProducts",
          input: { query: "coffee" },
        },
        {
          type: "tool-output-available",
          toolCallId: "call",
          output: {
            products: selected,
            totalMatches: 3,
            unseenMatches: 2,
            remainingMatches: 0,
          },
        },
        { type: "text-start", id: "text" },
        { type: "text-delta", id: "text", delta: "Here are two options." },
        { type: "text-end", id: "text" },
        { type: "finish" },
      ]),
    });
  });
  await page.goto("/chat");
  await send(page, "Coffee");
  await expect(page.getByText("Showing 2 products")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compare these" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show other options" }),
  ).toHaveCount(0);
});
