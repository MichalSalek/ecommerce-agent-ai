import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ModelMessage } from "ai";
import { products } from "../src/data/products";
import { LanceProductRepository } from "../src/infrastructure/catalog/lance-product-repository";
import {
  TransformerEmbedding,
  embeddingProfiles,
} from "../src/infrastructure/embeddings/transformer-embedding";
import { CatalogService } from "../src/application/catalog/catalog-service";
import { createShopTools } from "../src/application/chat/tools";
import { createLlamaModel } from "../src/infrastructure/chat/llama-model";
import { createJsonAgentStream } from "../src/infrastructure/chat/json-agent-stream";
import { shoppingState } from "../src/application/chat/shopping-state";
import {
  hasCartIntent,
  resolveCartSelection,
} from "../src/application/chat/cart-selection";

async function collect(
  stream: ReturnType<typeof createJsonAgentStream>,
  allowError = false,
) {
  const events = [],
    reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!allowError) assert.notEqual(value.type, "error");
    events.push(value);
  }
  return events;
}
test("cart selection resolves canonical prices/types/quantities and rejects ambiguity or unavailable goods", () => {
  const state = shoppingState([]);
  state.lastIds = ["folding-garden-chair", "outdoor-bistro-table"];
  assert.deepEqual(resolveCartSelection("biorę tańszy, dwie sztuki", state), {
    productId: "folding-garden-chair",
    quantity: 2,
  });
  assert.deepEqual(resolveCartSelection("dodaj ten stolik", state), {
    productId: "outdoor-bistro-table",
    quantity: 1,
  });
  assert.deepEqual(resolveCartSelection("add 3 of the second", state), {
    productId: "outdoor-bistro-table",
    quantity: 3,
  });
  assert.deepEqual(resolveCartSelection("add that one", state), {
    error: "ambiguous",
  });
  for (const text of [
    "add 0 mugs",
    "add 100 mugs",
    "add 1.5 mugs",
    "add mugs 1.5",
    "dodaj -2 sztuki",
  ])
    assert.deepEqual(
      resolveCartSelection(text, state),
      { error: "quantity" },
      text,
    );
  state.lastIds = ["mugs"];
  for (const text of [
    "add a grill",
    "add that fountain",
    "add carafe holder",
    "add blue mugs",
  ])
    assert.deepEqual(
      resolveCartSelection(text, state),
      { error: "ambiguous" },
      text,
    );
  assert.deepEqual(resolveCartSelection("can you add two mugs", state), {
    productId: "mugs",
    quantity: 2,
  });
  assert.deepEqual(resolveCartSelection("add Glass carafe", state), {
    productId: "carafe",
    quantity: 1,
  });
  state.lastIds = ["brass-pen", "tea-infuser"];
  assert.deepEqual(resolveCartSelection("take the cheaper one", state), {
    error: "ambiguous",
  });
  assert.deepEqual(resolveCartSelection("add waffle towels", state), {
    error: "unavailable",
  });
  assert.equal(hasCartIntent("What can I buy under EUR 25?"), false);
  assert.equal(hasCartIntent("don't add mugs"), false);
  assert.equal(hasCartIntent("nie dodaj mugs"), false);
});
test("v2 cart action is stable for retry, legacy stays manual and cancelled streams emit no action", async () => {
  const repository = {
    searchResult: async () => ({
      products: [],
      totalMatches: 0,
      unseenMatches: 0,
      remainingMatches: 0,
    }),
    overview: async () => ({ total: 0, categories: [], types: [] }),
    search: async () => [],
    browse: async () => [],
    categories: async () => [],
    findById: async (id: string) => products.find((p) => p.id === id),
  };
  const tools = createShopTools(new CatalogService(repository), "shopping-v2");
  const model = createLlamaModel("http://fixture/v1", "unused", async () => {
    throw Error("No provider for explicit cart operation");
  });
  const messages: ModelMessage[] = [
    { role: "user", content: "Compare mugs and carafe" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "c",
          toolName: "compareProducts",
          input: { productIds: ["mugs", "carafe"] },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c",
          toolName: "compareProducts",
          output: {
            type: "json",
            value: {
              products: [{ id: "mugs" }, { id: "carafe" }],
              missingIds: [],
            },
          },
        },
      ],
    },
    { role: "user", content: "Add two of the cheaper option to my cart" },
  ];
  const options = {
    providerOptions: {},
    maxOutputTokens: 3000,
    contract: "shopping-v2" as const,
    conversationId: "conversation",
    userMessageId: "user-request",
  };
  const first = await collect(
    createJsonAgentStream(
      model,
      messages,
      tools,
      new AbortController().signal,
      options,
    ),
  );
  const retried = await collect(
    createJsonAgentStream(
      model,
      messages,
      tools,
      new AbortController().signal,
      options,
    ),
  );
  const a = first.find((e) => e.type === "data-cartAction"),
    b = retried.find((e) => e.type === "data-cartAction");
  assert.ok(a && b);
  assert.deepEqual(a, b);
  assert.equal(a.data.productId, "carafe");
  assert.equal(a.data.quantity, 2);
  const legacy = await collect(
    createJsonAgentStream(model, messages, tools, new AbortController().signal),
  );
  assert.ok(!legacy.some((e) => e.type === "data-cartAction"));
  const abort = new AbortController();
  abort.abort();
  const cancelled = await collect(
    createJsonAgentStream(model, messages, tools, abort.signal, options),
    true,
  );
  assert.ok(!cancelled.some((e) => e.type === "data-cartAction"));
});
test("legacy wrong garden cards are corrected and all six outdoor furniture products exhaust without repeats", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aurelle-v2-agent-"));
  try {
    const repository = new LanceProductRepository(
      directory,
      new TransformerEmbedding(".data/models", "minilm"),
      products,
      embeddingProfiles.minilm.maxDistance,
    );
    const tools = createShopTools(
      new CatalogService(repository),
      "shopping-v2",
    );
    const model = createLlamaModel("http://fixture/v1", "unused", async () => {
      throw Error("These clear refinements must not use a model");
    });
    const messages: ModelMessage[] = [
      { role: "user", content: "Pisz po polsku" },
      { role: "user", content: "Szukam czegoś do ogrodu" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "old",
            toolName: "searchProducts",
            input: { query: "garden" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "old",
            toolName: "searchProducts",
            output: {
              type: "json",
              value: [{ id: "planters" }, { id: "oak-side-table" }],
            },
          },
        ],
      },
    ];
    const seen = new Set<string>();
    for (const text of [
      "A jakieś meble?",
      "Pokaż coś innego, doniczka to nie mebel",
      "Poproszę kolejne propozycje",
      "Czy możesz pokazać jeszcze coś innego?",
    ]) {
      messages.push({ role: "user", content: text });
      const events = await collect(
        createJsonAgentStream(
          model,
          messages,
          tools,
          new AbortController().signal,
        ),
      );
      const input = events.find((e) => e.type === "tool-input-available"),
        output = events.find((e) => e.type === "tool-output-available");
      assert.ok(input && output);
      const result = output.output as {
        products: typeof products;
        totalMatches: number;
        remainingMatches: number;
      };
      assert.equal(result.totalMatches, 6);
      for (const p of result.products) {
        assert.equal(p.productKind, "furniture");
        assert.equal(p.useEnvironment, "outdoor");
        assert.ok(!seen.has(p.id));
        seen.add(p.id);
      }
      messages.push(
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: input.toolCallId,
              toolName: input.toolName,
              input: input.input,
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: input.toolCallId,
              toolName: input.toolName,
              output: {
                type: "json",
                value: JSON.parse(JSON.stringify(output.output)),
              },
            },
          ],
        },
      );
    }
    assert.equal(seen.size, 6);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
