import { test, expect } from "@playwright/test";
import { shoppingExamples, shoppingStarters } from "../../src/application/chat/shopping-v3";

const headers = { "x-vercel-ai-ui-message-stream": "v1" };
const answer = (parts: object[]) => [...[{ type: "start", messageId: crypto.randomUUID() }], ...parts, { type: "finish" }]
  .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
const text = (value: string) => [{ type: "text-start", id: "reply" }, { type: "text-delta", id: "reply", delta: value }, { type: "text-end", id: "reply" }];
const results = { evidenceId: "e", products: [{ id: "mugs" }, { id: "carafe" }], appliedCriteria: {}, outcome: "matches", requestedCount: 2, scopeTotal: 2, totalMatches: 2, unseenMatches: 2, remainingMatches: 0 };

test("catalog actions work during advice cooldown and retry targets the existing operation", async ({ page }) => {
  await page.clock.install();
  const actions: unknown[] = [];
  const retryAt = Date.now() + 20_000;
  await page.route("**/api/chat", async (route) => {
    const action = route.request().postDataJSON().messages.at(-1).metadata?.shoppingAction;
    actions.push(action);
    const advice = action?.type === "advice";
    const parts = advice
      ? [...text("The results remain available."), { type: "data-operation", data: { id: "op-search", kind: "search", status: "completed" } }, { type: "data-advice", data: { status: "included", text: "The mugs are convenient for sharing." } }]
      : [...text("Here are the results."), { type: "data-operation", data: { id: "op-search", kind: "search", status: "completed" } }, { type: "data-products", data: results }, { type: "data-advice", data: { status: "unavailable", reason: "quota", retryAt } }, { type: "data-turnStatus", data: { status: "complete" } }];
    await route.fulfill({ status: 200, contentType: "text/event-stream", headers, body: answer(parts) });
  });
  await page.goto("/chat");
  await page.getByRole("button", { name: "My morning coffee", exact: true }).click();
  await expect(page.getByText("Advice is unavailable right now.")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Retry last message" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry advice" })).toBeDisabled();
  await page.getByRole("textbox").fill("Keep this draft");
  await page.getByRole("button", { name: "More details" }).click();
  await expect.poll(() => actions.length).toBe(2);
  expect(actions[1]).toEqual({ type: "details", productId: "mugs" });
  await expect(page.getByRole("textbox")).toHaveValue("Keep this draft");
  await page.clock.fastForward(21_000);
  await page.getByRole("button", { name: "Retry advice" }).last().click();
  await expect(page.getByText("The mugs are convenient for sharing.")).toHaveCount(1);
  expect(actions.at(-1)).toEqual({ type: "advice", operationId: "op-search" });
  await expect(page.getByRole("button", { name: "Retry last message" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("The mugs are convenient for sharing.")).toHaveCount(1);
  await expect(page.getByRole("textbox")).toHaveValue("Keep this draft");
});

test("every starter and example sends its declared structural action", async ({ page }) => {
  const actions: unknown[] = [];
  await page.route("**/api/chat", async (route) => {
    actions.push(route.request().postDataJSON().messages.at(-1).metadata?.shoppingAction);
    await route.fulfill({ status: 200, contentType: "text/event-stream", headers, body: answer([...text("Ready."), { type: "data-operation", data: { id: `op-${actions.length}`, kind: "search", status: "completed" } }]) });
  });
  await page.goto("/chat");
  for (const starter of shoppingStarters) {
    await page.getByRole("button", { name: "New conversation" }).click();
    await page.getByRole("button", { name: starter.label, exact: true }).click();
    await expect.poll(() => actions.length).toBe(shoppingStarters.indexOf(starter) + 1);
    expect(actions.at(-1)).toEqual(starter.action);
    await expect(page.getByText("Ready.")).toBeVisible();
  }
  for (const example of shoppingExamples) {
    await page.getByRole("button", { name: example.text, exact: true }).click();
    await expect.poll(() => actions.length).toBe(shoppingStarters.length + shoppingExamples.indexOf(example) + 1);
    expect(actions.at(-1)).toEqual(example.action);
    await expect(page.locator(".chat-progress")).toHaveCount(0);
  }
});

test("pending cart choice sends its product and creates only one stored receipt", async ({ page }) => {
  const actions: unknown[] = [];
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    const user = body.messages.at(-1);
    actions.push(user.metadata?.shoppingAction);
    const parts = actions.length === 1
      ? [...text("Which product should I add?"), { type: "data-operation", data: { id: "pending", kind: "cart", status: "needs-input", question: "Which product should I add?", choices: ["mugs", "carafe"] } }]
      : [...text("Your selection is ready."), { type: "data-operation", data: { id: "cart-op", kind: "cart", status: "awaiting-device", cartOperationId: "cart-op" } }, { type: "data-cartAction", data: { operationId: "cart-op", userMessageId: user.id, productId: "mugs", quantity: 2 } }];
    await route.fulfill({ status: 200, contentType: "text/event-stream", headers, body: answer(parts) });
  });
  await page.goto("/chat");
  await page.getByRole("textbox").fill("Add two of these");
  await page.getByRole("textbox").press("Enter");
  await page.getByRole("button", { name: "Ceramic mugs", exact: true }).click();
  await expect.poll(() => actions.length).toBe(2);
  expect(actions[1]).toEqual({ type: "cart", productId: "mugs", selection: "selected", quantity: 1 });
  await expect(page.getByText("Added 2 × Ceramic mugs to your cart.")).toHaveCount(1);
  await page.reload();
  await expect(page.getByText("Added 2 × Ceramic mugs to your cart.")).toHaveCount(1);
  const cart = await page.evaluate(() => JSON.parse(localStorage.getItem("aurelle.cart.v1")!));
  expect(cart.receipts).toHaveLength(1);
  expect(cart.lines).toEqual([{ productId: "mugs", quantity: 2 }]);
});

test("reload repairs a legacy comparison with failed presentation", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("aurelle.conversation.v1")) return;
    localStorage.setItem("aurelle.conversation.v1", JSON.stringify({ version: 1, id: "legacy", draft: "Saved draft", messages: [
      { id: "u", role: "user", parts: [{ type: "text", text: "Compare mugs and carafe" }] },
      { id: "a", role: "assistant", parts: [
        { type: "text", text: "The lowest price is at €" },
        { type: "data-comparison", data: { productIds: ["mugs", "carafe"], cheapestIds: ["mugs"], differencesCents: [] } },
        { type: "data-turnStatus", data: { status: "partial", code: "MODEL_RESPONSE_INCOMPLETE" } },
      ] },
    ] }));
  });
  await page.goto("/chat");
  await expect(page.getByText(/This comparison covers 2 products/)).toBeVisible();
  await expect(page.getByText("The lowest price is at €")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry last message" })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveValue("Saved draft");
  await page.reload();
  await expect(page.getByText(/This comparison covers 2 products/)).toBeVisible();
});
