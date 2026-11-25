import { test, expect } from "@playwright/test";

const headers = { "x-vercel-ai-ui-message-stream": "v1" };
const comparison = { productIds: ["mugs", "carafe"], cheapestIds: ["carafe"], differencesCents: [{ productId: "mugs", cents: 300 }, { productId: "carafe", cents: 0 }] };
const summary = "Porównanie obejmuje 2 produkty. Najniższa cena to 19.00 EUR (Glass carafe).";
const recommendation = "Polecam Ceramic mugs, bo mają uchwyty do gorących napojów.";
function stream(advice: { status: string; text?: string; reason?: string }) {
  const parts = [
    { type: "start", messageId: crypto.randomUUID() },
    { type: "text-start", id: "answer" }, { type: "text-delta", id: "answer", delta: summary }, { type: "text-end", id: "answer" },
    { type: "data-operation", data: { id: "comparison-op", kind: "comparison", status: "completed" } },
    { type: "data-comparison", data: comparison },
    { type: "data-advice", data: advice },
    { type: "data-turnStatus", data: { status: "complete" } },
    { type: "finish" },
  ];
  return parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n";
}
async function sendComparison(page: import("@playwright/test").Page) {
  await page.goto("/chat");
  await page.getByRole("textbox").fill("Porównaj kubki i karafkę do gorącej kawy.");
  await page.getByRole("textbox").press("Enter");
}

test("a recommendation precedes price summary and cards and Copy reply follows that order", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/chat", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", headers, body: stream({ status: "included", text: recommendation }) }));
  await sendComparison(page);
  const answer = page.locator(".chat-message.assistant").last();
  await expect(answer.getByText(recommendation, { exact: true })).toBeVisible();
  await expect(answer.locator(".comparison-product")).toHaveCount(2);
  expect(await answer.locator(":scope > p").allTextContents()).toEqual([recommendation, summary]);
  const order = await answer.evaluate((node) => {
    const paragraphs = node.querySelectorAll(":scope > p");
    const cards = node.querySelector(".comparison-results");
    return cards && Boolean(paragraphs[1].compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  await answer.getByRole("button", { name: "Copy reply" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${recommendation}\n${summary}`);
});

test("a retry keeps one set of cards and copies only the newly shown advice", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let calls = 0;
  await page.route("**/api/chat", (route) => {
    calls++;
    return route.fulfill({ status: 200, contentType: "text/event-stream", headers, body: stream(calls === 1 ? { status: "unavailable", reason: "temporary" } : { status: "included", text: recommendation }) });
  });
  await sendComparison(page);
  await expect(page.getByText("Porada jest teraz niedostępna.")).toBeVisible();
  await expect(page.locator(".comparison-product")).toHaveCount(2);
  await page.getByRole("button", { name: "Retry advice" }).click();
  const reply = page.locator(".chat-message.assistant").last();
  await expect(reply.getByText(recommendation, { exact: true })).toBeVisible();
  await expect(page.getByText(recommendation, { exact: true })).toHaveCount(1);
  await expect(page.locator(".comparison-product")).toHaveCount(2);
  await expect(page.getByText(summary, { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Retry advice" })).toHaveCount(0);
  await reply.getByRole("button", { name: "Copy reply" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(recommendation);
});

test("a non-recommendation remains after the direct summary and before cards", async ({ page }) => {
  const advice = "Ceramic mugs mają uchwyty do gorących napojów.";
  await page.route("**/api/chat", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", headers, body: stream({ status: "included", text: advice }) }));
  await sendComparison(page);
  const answer = page.locator(".chat-message.assistant").last();
  await expect(answer.getByText(advice, { exact: true })).toBeVisible();
  expect(await answer.locator(":scope > p").allTextContents()).toEqual([summary, advice]);
  const order = await answer.evaluate((node) => {
    const paragraphs = node.querySelectorAll(":scope > p");
    const cards = node.querySelector(".comparison-results");
    return cards && Boolean(paragraphs[1].compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
});
