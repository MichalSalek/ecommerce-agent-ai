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
test("chat fills the remaining viewport and serves product photos directly", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto("/chat");
  await page
    .getByRole("button", { name: "My morning coffee", exact: true })
    .click();
  await expect(page.locator(".product.compact")).toHaveCount(2);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
    { width: 1440, height: 1200 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect
      .poll(async () => {
        const panel = await page.locator(".chat-panel").boundingBox();
        return Boolean(
          panel &&
          panel.y + panel.height <= viewport.height + 1 &&
          panel.height >= viewport.height - panel.y - 32,
        );
      })
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const photos = page.locator(".product.compact img");
  await expect(photos).toHaveCount(2);
  for (const photo of await photos.all()) {
    await expect
      .poll(() =>
        photo.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const source = await photo.evaluate(
      (img: HTMLImageElement) => img.currentSrc,
    );
    expect(new URL(source).pathname).toMatch(/^\/images\/.+\.webp$/);
  }
});

test("all ten examples are reachable beside the conversation and by keyboard on a short phone", async ({ page }) => {
  const calls = await fixture(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/chat");
  const examples = page.getByRole("complementary").getByRole("region", { name: "Shopping examples" });
  const rows = examples.getByRole("listitem");
  const last = rows.last().getByRole("button", { name: "How much is delivery?" });
  await expect(rows).toHaveCount(10);
  const sidebar = await examples.boundingBox();
  const chat = await page.getByRole("region", { name: "Shopping conversation" }).boundingBox();
  const catalog = await page.getByRole("link", { name: "Browse products" }).boundingBox();
  expect(sidebar!.x + sidebar!.width).toBeLessThan(chat!.x);
  expect(sidebar!.y).toBeGreaterThanOrEqual(catalog!.y + catalog!.height);
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const field = page.getByRole("textbox");
  await expect(field).toBeInViewport({ ratio: 1 });

  await page.setViewportSize({ width: 375, height: 667 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const toggle = examples.getByRole("button", { name: "Explore with the assistant" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => page.getByRole("log").evaluate((thread) => thread.scrollTop)).toBe(0);
  await field.fill("I am still writing this question");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(rows.first().getByRole("button")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await field.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  const more = examples.getByRole("button", { name: "More examples" });
  await more.click();
  await expect(last).toBeInViewport({ ratio: 1 });
  await expect(examples.getByRole("button", { name: "Back to first examples" })).toBeVisible();
  await last.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".chat-message.user")).toHaveText(/How much is delivery\?/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(field).toHaveValue("I am still writing this question");
  await expect(page.getByRole("log")).toBeFocused();
  await expect(field).toBeInViewport({ ratio: 1 });
  expect(calls()).toBe(1);

  await page.setViewportSize({ width: 740, height: 390 });
  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Send message" })).toBeInViewport({ ratio: 1 });
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
  await page.route("**/images/products/*.webp", (route) => route.abort());
  await page.goto("/chat");
  await page
    .getByRole("button", { name: "My morning coffee", exact: true })
    .click();
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

test("a full saved conversation locks input, survives reload and resets only through a new topic", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const messages = Array.from({ length: 20 }, (_, i) => [
      { id: `u${i}`, role: "user", parts: [{ type: "text", text: "Hello" }] },
      {
        id: `a${i}`,
        role: "assistant",
        parts: [{ type: "text", text: "How can I help?" }],
      },
    ]).flat();
    sessionStorage.setItem(
      "aurelle.conversation.session.v1",
      JSON.stringify({ version: 1, id: "full", draft: "", messages }),
    );
  });
  await page.goto("/chat");
  await expect(page.getByText("This conversation is complete.")).toBeVisible();
  await expect(page.getByRole("textbox")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(page.getByRole("textbox")).toBeEnabled();
  await expect(
    page.getByText("Welcome to Aurelle.", { exact: false }),
  ).toBeVisible();
});

test("manual retry reuses the failed user message and context without duplicating it", async ({
  page,
}) => {
  let calls = 0;
  const bodies: unknown[] = [];
  await page.route("**/api/chat", async (route) => {
    calls++;
    bodies.push(route.request().postDataJSON());
    if (calls === 1)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Temporary provider connection problem.",
        }),
      });
    else
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "x-vercel-ai-ui-message-stream": "v1" },
        body: response("retry"),
      });
  });
  await page.goto("/chat");
  await page.getByRole("textbox").fill("trwałość materiału");
  await page.getByRole("textbox").press("Enter");
  await expect(
    page.getByRole("button", { name: "Retry last message" }),
  ).toBeVisible();
  await expect(page.locator(".chat-error")).toHaveCount(1);
  await expect(page.getByText("Połączenie zostało przerwane. Spróbuj ponownie.")).toBeVisible();
  await page.getByRole("button", { name: "Retry last message" }).click();
  await expect(page.locator(".product.compact")).toHaveCount(2);
  await expect(page.locator(".chat-message.user")).toHaveCount(1);
  expect(bodies[1]).toEqual(bodies[0]);
});

test("capability guide is explicit about mock data and sends the advertised comparison scenario", async ({
  page,
}) => {
  let sent = "";
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    sent = body.messages.at(-1).parts[0].text;
    const parts = [
      { type: "start", messageId: "comparison" },
      {
        type: "tool-input-available",
        toolCallId: "comparison",
        toolName: "compareProducts",
        input: { productIds: ["mugs", "carafe"] },
      },
      {
        type: "tool-output-available",
        toolCallId: "comparison",
        output: {
          products: products.filter((p) => ["mugs", "carafe"].includes(p.id)),
          missingIds: [],
        },
      },
      { type: "text-start", id: "answer" },
      {
        type: "text-delta",
        id: "answer",
        delta: "Price difference: 3.00 EUR. Which use matters most?",
      },
      { type: "text-end", id: "answer" },
      { type: "finish" },
    ];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body:
        parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("") +
        "data: [DONE]\n\n",
    });
  });
  await page.goto("/chat");
  await expect(
    page.getByRole("region", { name: "Shopping examples" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      `All ${products.length} products, prices, stock and policies are mock data.`,
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compare mugs and carafe" }).click();
  await expect(page.locator(".product.compact")).toHaveCount(2);
  expect(sent).toBe("Compare mugs and carafe");
  await page.reload();
  await expect(page.locator(".product.compact")).toHaveCount(2);
});

test("a fresh tab starts empty, purges legacy history and leaves unrelated local data intact", async ({ page, context }) => {
  await fixture(page);
  await page.goto("/chat");
  await page.evaluate(() => {
    localStorage.setItem("aurelle.conversation.v1", JSON.stringify({ version: 1, id: "old", draft: "Legacy draft", messages: [{ id: "old-user", role: "user", parts: [{ type: "text", text: "Legacy secret" }] }] }));
    localStorage.setItem("unrelated-marker", "keep");
  });
  await page.getByRole("textbox").fill("First tab marker");
  await page.getByRole("textbox").press("Enter");
  await expect(page.locator(".product.compact")).toHaveCount(2);
  await page.locator(".product.compact").first().getByRole("button", { name: "Add to cart" }).click();
  const cartBefore = await page.evaluate(() => localStorage.getItem("aurelle.cart.v1"));
  expect(cartBefore).toBeTruthy();
  const cooldownBefore = JSON.stringify({ version: 1, status: { status: "provider-limit", retryAt: Date.now() + 60_000 } });
  await page.evaluate((value) => localStorage.setItem("aurelle.chat.cooldown.v1", value), cooldownBefore);
  await page.getByRole("textbox").fill("First tab draft");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("aurelle.conversation.session.v1"))).toContain("First tab draft");
  const fresh = await context.newPage();
  await fresh.goto("/chat");
  await expect(fresh.locator(".chat-message.user")).toHaveCount(0);
  await expect(fresh.getByRole("textbox")).toHaveValue("");
  await expect(fresh.getByText("Legacy secret")).toHaveCount(0);
  expect(await fresh.evaluate(() => localStorage.getItem("aurelle.conversation.v1"))).toBeNull();
  expect(await fresh.evaluate(() => localStorage.getItem("unrelated-marker"))).toBe("keep");
  expect(await fresh.evaluate(() => localStorage.getItem("aurelle.cart.v1"))).toBe(cartBefore);
  expect(await fresh.evaluate(() => localStorage.getItem("aurelle.chat.cooldown.v1"))).toBe(cooldownBefore);
  await expect(page.getByText("First tab marker", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue("First tab draft");
  await fresh.close();
});

test("reset excludes the old marker and conversation id from the next request", async ({ page }) => {
  const bodies: { conversationId: string; messages: { id: string; role: string; parts: unknown[] }[] }[] = [];
  await page.route("**/api/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: response(`reset-${bodies.length}`) });
  });
  await page.goto("/chat");
  await page.getByRole("textbox").fill("OLD PRIVATE MARKER");
  await page.getByRole("textbox").press("Enter");
  await expect(page.locator(".product.compact")).toHaveCount(2);
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("textbox").fill("Fresh question");
  await page.getByRole("textbox").press("Enter");
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].conversationId).not.toBe(bodies[0].conversationId);
  expect(JSON.stringify(bodies[1])).not.toContain("OLD PRIVATE MARKER");
  expect(bodies[1].messages).toHaveLength(1);
  expect(bodies[1].messages[0].role).toBe("user");
  await expect(page.locator(".product.compact")).toHaveCount(2);
  await page.reload();
  await expect(page.getByText("Fresh question", { exact: true })).toBeVisible();
  await expect(page.getByText("OLD PRIVATE MARKER", { exact: true })).toHaveCount(0);
});

test("chat remains usable when session storage is disabled", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } });
  });
  await fixture(page);
  await page.goto("/chat");
  await expect(page.getByText("Conversation saving is unavailable.", { exact: false })).toBeVisible();
  await page.getByRole("textbox").fill("Find coffee");
  await page.getByRole("textbox").press("Enter");
  await expect(page.locator(".product.compact")).toHaveCount(2);
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.locator(".chat-message.user")).toHaveCount(0);
  await page.getByRole("textbox").fill("Another question");
  await page.getByRole("textbox").press("Enter");
  await expect(page.locator(".product.compact")).toHaveCount(2);
});

test("Polish request limit without retry timing shows one translated failure and retries the same turn", async ({ page }) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  const bodies: { conversationId: string; messages: { id: string; role: string }[] }[] = [];
  await page.route("**/api/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ code: "REQUEST_LIMIT" }) });
    else await route.fulfill({ status: 200, contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: response("after-limit") });
  });
  await page.goto("/chat");
  await page.getByRole("textbox").fill("Szukam kubka do kawy");
  await page.getByRole("textbox").press("Enter");
  await expect(page.locator(".chat-error")).toHaveCount(1);
  await expect(page.getByText("Wersja demonstracyjna osiągnęła godzinowy limit zapytań.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry last message" })).toBeDisabled();
  await page.clock.fastForward("00:01");
  await page.reload();
  await expect(page.locator(".chat-error")).toHaveCount(1);
  await expect(page.getByText("Wersja demonstracyjna osiągnęła godzinowy limit zapytań.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry last message" })).toBeDisabled();
  await page.clock.fastForward("00:30");
  await page.getByRole("button", { name: "Retry last message" }).click();
  await expect(page.locator(".product.compact")).toHaveCount(2);
  expect(bodies[1].conversationId).toBe(bodies[0].conversationId);
  expect(bodies[1].messages.at(-1)?.id).toBe(bodies[0].messages.at(-1)?.id);
  await expect(page.locator(".chat-message.user")).toHaveCount(1);
});

test("a child tab does not inherit its opener's conversation and keeps its own after reload", async ({ page, context }) => {
  let calls = 0;
  await context.route("**/api/chat", async (route) => {
    calls++;
    await route.fulfill({ status: 200, contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: response(`child-${calls}`) });
  });
  await page.goto("/chat");
  await page.getByRole("textbox").fill("Opener private marker");
  await page.getByRole("textbox").press("Enter");
  await expect(page.locator(".product.compact")).toHaveCount(2);
  await page.getByRole("textbox").fill("Opener draft");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("aurelle.conversation.session.v1"))).toContain("Opener draft");
  const popupPromise = page.waitForEvent("popup");
  await page.evaluate(() => window.open("/chat", "_blank"));
  const child = await popupPromise;
  await expect(child.getByRole("textbox")).toHaveValue("");
  await expect(child.locator(".chat-message.user")).toHaveCount(0);
  await child.getByRole("textbox").fill("Child question");
  await child.getByRole("textbox").press("Enter");
  await expect(child.locator(".product.compact")).toHaveCount(2);
  await child.getByRole("textbox").fill("Child draft");
  await expect.poll(() => child.evaluate(() => sessionStorage.getItem("aurelle.conversation.session.v1"))).toContain("Child draft");
  await child.reload();
  await expect(child.getByText("Child question", { exact: true })).toBeVisible();
  await expect(child.getByRole("textbox")).toHaveValue("Child draft");
  await expect(child.getByText("Opener private marker", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Opener private marker", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue("Opener draft");
  await child.close();
});
