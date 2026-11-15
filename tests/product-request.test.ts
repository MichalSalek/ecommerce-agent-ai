import { repositoryFixture } from "./repository-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { products } from "../src/data/products";
import { productDetailsRequest } from "../src/application/chat/product-request";
import { createLlamaModel } from "../src/infrastructure/chat/llama-model";
import { createJsonAgentStream } from "../src/infrastructure/chat/json-agent-stream";
import { CatalogService } from "../src/application/catalog/catalog-service";
import { createShopTools } from "../src/application/chat/tools";

const first = "Dodaj do koszyka ten coffee grinder.";
const history: ModelMessage[] = [
  { role: "user", content: first },
  {
    role: "assistant",
    content:
      "Nie mogę dodać produktu do koszyka, ale mogę podać szczegóły i sprawdzić dostępność. Czy chcesz zobaczyć opis i cenę młynka do kawy?",
  },
  { role: "user", content: "To podaj mi wszystko, co wiesz na ten temat.lo" },
];

test("reported coffee grinder exchange uses canonical details without a provider or vector search", async () => {
  const tools = createShopTools(
    new CatalogService(
      repositoryFixture({
        findById: async (id) => products.find((p) => p.id === id),
        categories: async () => [],
        browse: async () => {
          throw Error("No browse needed");
        },
        search: async () => {
          throw Error("No semantic search needed");
        },
      }),
    ),
  );
  const model = createLlamaModel("http://fixture/v1", "offline", async () => {
    throw Error("Provider unavailable");
  });
  for (const messages of [[history[0]], history]) {
    const parts = [];
    const reader = createJsonAgentStream(
      model,
      messages,
      tools,
      new AbortController().signal,
    ).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    assert.equal(parts[0].type, "start");
    assert.ok(!parts.some((p) => p.type === "error"));
    const call = parts.find((p) => p.type === "tool-input-available");
    assert.equal(call?.toolName, "getProductDetails");
    assert.deepEqual(call?.input, { productId: "coffee-grinder" });
    const output = parts.find((p) => p.type === "tool-output-available");
    assert.deepEqual(
      output?.output,
      products.find((p) => p.id === "coffee-grinder"),
    );
    const text = parts
      .filter((p) => p.type === "text-delta")
      .map((p) => p.delta)
      .join("");
    assert.match(text, /39\.00 EUR/);
    assert.ok(
      text.includes(products.find((p) => p.id === "coffee-grinder")!.name),
    );
    assert.match(text, /Add to cart|dodać.*do koszyka/);
    assert.doesNotMatch(text, /dodałem|added to your cart/i);
  }
});

test("details follow-up does not guess among multiple products or cross a later topic", () => {
  assert.equal(
    productDetailsRequest(
      [{ role: "user", content: "Tell me everything about mugs and carafe" }],
      products,
    ),
    undefined,
  );
  assert.equal(
    productDetailsRequest(
      [
        { role: "user", content: "coffee grinder" },
        { role: "user", content: "How much is delivery?" },
        { role: "user", content: "Tell me everything about it" },
      ],
      products,
    ),
    undefined,
  );
  assert.equal(
    productDetailsRequest(
      [{ role: "user", content: "Tell me about the opening hours" }],
      products,
    ),
    undefined,
  );
  assert.equal(
    productDetailsRequest(
      [{ role: "user", content: "Tell me about the brass pen" }],
      products,
    ),
    "brass-pen",
  );
});

test("the stream opens before a slow provider and cancellation releases admission", async () => {
  const tools = createShopTools(
    new CatalogService(
      repositoryFixture({
        findById: async () => undefined,
        categories: async () => [],
        browse: async () => [],
        search: async () => [],
      }),
    ),
  );
  const model = createLlamaModel(
    "http://fixture/v1",
    "slow",
    async (_url, init) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) reject(signal.reason);
        else
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
      });
    },
  );
  const controller = new AbortController();
  let settled = false;
  const reader = createJsonAgentStream(
    model,
    [{ role: "user", content: "How much is delivery?" }],
    tools,
    controller.signal,
    {
      providerOptions: {},
      maxOutputTokens: 3000,
      onSettled: () => {
        settled = true;
      },
    },
  ).getReader();
  const first = await reader.read();
  assert.equal(first.value?.type, "start");
  controller.abort();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  assert.equal(settled, true);
});
