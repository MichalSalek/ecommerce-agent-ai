import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { products } from "../src/data/products";
import { BgeEmbedding } from "../src/infrastructure/embeddings/bge-embedding";
import { LanceProductRepository } from "../src/infrastructure/catalog/lance-product-repository";
import { CatalogService } from "../src/application/catalog/catalog-service";
import { createShopTools } from "../src/application/chat/tools";
import { comparisonIds } from "../src/application/chat/discovery";
import { compareInput } from "../src/application/chat/tool-inputs";
import { createLlamaModel } from "../src/infrastructure/chat/llama-model";
import { createJsonAgentStream } from "../src/infrastructure/chat/json-agent-stream";
import { restoreConversation } from "../src/application/chat/history";
test("comparison and stock-aware gift discovery execute real catalog contracts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aurelle-discovery-"));
  try {
    const repository = new LanceProductRepository(
      directory,
      new BgeEmbedding(".data/models"),
      products,
    );
    const catalog = new CatalogService(repository);
    const tools = createShopTools(catalog);
    const comparison = await catalog.compare(["mugs", "carafe"]);
    assert.equal(comparison.products.length, 2);
    assert.equal(
      Math.abs(comparison.products[0].price - comparison.products[1].price),
      3,
    );
    assert.deepEqual((await catalog.compare(["mugs", "missing"])).missingIds, [
      "missing",
    ]);
    assert.equal(
      compareInput.safeParse({ productIds: ["mugs", "mugs"] }).success,
      false,
    );
    assert.deepEqual(
      comparisonIds("Compare these products", ["mugs", "carafe"], products),
      ["mugs", "carafe"],
    );
    const stock = await catalog.search({
      query: "",
      maxPrice: 60,
      category: "Electronics",
      inStockOnly: true,
    });
    assert.ok(stock.every((p) => p.inStock));
    assert.ok(!stock.some((p) => p.id === "compact-keyboard"));
    const model = createLlamaModel("http://fixture/v1", "unused", async () => {
      throw Error("Structured tools should not depend on LLM");
    });
    async function run(text: string) {
      const stream = createJsonAgentStream(
        model,
        [{ role: "user", content: text }],
        tools,
        new AbortController().signal,
      );
      const reader = stream.getReader();
      const parts = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assert.notEqual(value.type, "error");
        parts.push(value);
      }
      return parts;
    }
    const compared = await run("Compare mugs and carafe");
    assert.ok(
      compared.some(
        (p) =>
          p.type === "tool-input-available" && p.toolName === "compareProducts",
      ),
    );
    assert.ok(
      compared.some(
        (p) => p.type === "text-delta" && p.delta.includes("3.00 EUR"),
      ),
    );
    const gift = await run("Find a gift under EUR 25");
    const result = gift.find((p) => p.type === "tool-output-available");
    assert.ok(
      result?.type === "tool-output-available" && Array.isArray(result.output),
    );
    assert.equal(result.output.length, 2);
    assert.ok(
      result.output.every(
        (p: { price: number; inStock: boolean }) => p.price <= 25 && p.inStock,
      ),
    );
    const restored = restoreConversation(
      JSON.stringify({
        version: 1,
        id: "comparison",
        draft: "",
        messages: [
          {
            id: "answer",
            role: "assistant",
            parts: [
              {
                type: "tool-compareProducts",
                toolCallId: "call",
                state: "output-available",
                input: { productIds: ["mugs", "carafe"] },
                output: {
                  products: [
                    { id: "mugs", price: 0 },
                    { id: "carafe", price: 0 },
                  ],
                  missingIds: [],
                },
              },
            ],
          },
        ],
      }),
    );
    assert.ok(restored);
    assert.equal(restored.messages[0].parts[0].type, "tool-compareProducts");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
