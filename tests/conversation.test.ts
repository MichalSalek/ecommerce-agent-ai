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
import { createLlamaModel } from "../src/infrastructure/chat/llama-model";
import { createJsonAgentStream } from "../src/infrastructure/chat/json-agent-stream";
import {
  requestedBudget,
  conversationContext,
} from "../src/application/chat/conversation";

test("replays the reported conversation with real LanceDB: language, clarification, alternatives, around/USD and categories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aurelle-conversation-"));
  try {
    const repository = new LanceProductRepository(
      directory,
      new BgeEmbedding(".data/models"),
      products,
    );
    const tools = createShopTools(new CatalogService(repository));
    const model = createLlamaModel("http://fixture/v1", "unused", async () => {
      throw Error("These structured turns should not call the LLM");
    });
    const history: ModelMessage[] = [];
    async function turn(text: string) {
      history.push({ role: "user", content: text });
      const stream = createJsonAgentStream(
        model,
        history,
        tools,
        new AbortController().signal,
      );
      const reader = stream.getReader();
      let answer = "";
      let output: unknown;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "error") throw Error(value.errorText);
        if (value.type === "text-delta") answer += value.delta;
        if (value.type === "tool-input-available")
          history.push({
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: value.toolCallId,
                toolName: value.toolName,
                input: value.input,
              },
            ],
          });
        if (value.type === "tool-output-available") {
          output = value.output;
          const call = history.at(-1);
          const name =
            call?.role === "assistant" &&
            Array.isArray(call.content) &&
            call.content[0].type === "tool-call"
              ? call.content[0].toolName
              : "";
          history.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: value.toolCallId,
                toolName: name,
                output: {
                  type: "json",
                  value: JSON.parse(JSON.stringify(value.output)),
                },
              },
            ],
          });
        }
      }
      history.push({ role: "assistant", content: answer });
      return { answer, output };
    }
    assert.match((await turn("test")).answer, /Hello/);
    assert.match((await turn("możesz pisać po polsku")).answer, /po polsku/);
    const home = await turn("szukam czegoś do domu");
    assert.match(home.answer, /dekoracje.*tekstylia.*oświetlenie/);
    assert.ok(Array.isArray(home.output) && home.output.length === 2);
    const more = await turn("A coś więcej?");
    assert.ok(Array.isArray(more.output));
    const shown = Array.isArray(home.output)
      ? home.output.map((p: { id: string }) => p.id)
      : [];
    assert.ok(more.output.every((p: { id: string }) => !shown.includes(p.id)));
    assert.notEqual(more.answer, home.answer);
    const around = await turn(
      "a umiesz odpisać po polsku jakie produkty polecasz za około 30 dolarów?",
    );
    assert.match(around.answer, /nie przeliczenie 30 USD/);
    assert.match(around.answer, /Czy mogę przyjąć taki budżet w euro\?/);
    assert.ok(Array.isArray(around.output));
    assert.ok(
      around.output.some(
        (p: { id: string; price: number }) =>
          p.id === "vase-01" && p.price === 32,
      ),
    );
    assert.ok(!around.output.some((p: { id: string }) => p.id === "candle"));
    const categories = await turn(
      "jakie kategorie produktów macie dostępne na sklepie?",
    );
    assert.match(categories.answer, /kuchnia/);
    assert.match(categories.answer, /Która kategoria/);
    assert.ok(
      Array.isArray(categories.output) && categories.output.length >= 10,
    );
    const max = await repository.browse(30, { category: "Home" });
    assert.ok(max.every((p) => p.price <= 30));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("budgets preserve ceiling/target/currency and continuation resumes an unanswered question", () => {
  assert.deepEqual(requestedBudget("około 30 dolarów"), {
    amount: 30,
    mode: "around",
    currency: "USD",
  });
  assert.deepEqual(requestedBudget("do 30 euro"), {
    amount: 30,
    mode: "max",
    currency: "EUR",
  });
  assert.equal(
    conversationContext([
      { role: "user", content: "co polecasz za około 30 dolarów?" },
      { role: "user", content: "kontynuuj" },
    ]).text,
    "co polecasz za około 30 dolarów?",
  );
});
