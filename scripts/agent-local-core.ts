// Local functional QA only: executes the real engine with a longer test boundary.
// This is not the production HTTP route and provides no HTTP latency evidence.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { z } from "zod";
import { createUIMessageStreamResponse } from "ai";
import {
  conversationUsage,
  MAX_CONVERSATION_TURNS,
  MAX_CONVERSATION_CHARACTERS,
} from "../src/application/chat/conversation-limit";
import { settledMessages } from "../src/application/chat/history";
import { legacyButtonAction } from "../src/application/chat/shopping-v3";
import { getShop } from "../src/composition/shop";
import {
  catalogOnlyRuntime,
  resolveChatRuntime,
} from "../src/composition/chat";
import { products } from "../src/data/products";
import {
  adviceResultFromMessages,
  createNativeAgentStream,
  needsModel,
  stateFromMessages,
} from "../src/infrastructure/chat/native-agent";

if (process.argv.includes("--help")) {
  console.log(
    "Usage: CHAT_PROVIDER=llama LLAMA_MODEL=qwen38-uncensored LLAMA_BASE_URL=http://127.0.0.1:<proxy-port>/v1 node --import tsx scripts/agent-local-core.ts\nLocal-only ENGINE functional QA server; uses an ephemeral loopback port and 600s turn timeout. Not production HTTP latency evidence.",
  );
  process.exit(0);
}
assert.equal(
  process.env.CHAT_PROVIDER,
  "llama",
  "Engine QA requires CHAT_PROVIDER=llama",
);
assert.equal(
  process.env.LLAMA_MODEL,
  "qwen38-uncensored",
  "Engine QA requires LLAMA_MODEL=qwen38-uncensored",
);
assert.ok(
  !Object.entries(process.env).some(
    ([key, value]) => /^GROQ_/i.test(key) && value,
  ),
  "Engine QA refuses Groq keys and routes",
);
assert.equal(
  process.env.HOSTNAME ?? "127.0.0.1",
  "127.0.0.1",
  "Engine QA requires loopback binding",
);
assert.equal(
  process.env.EMBEDDING_MODEL ?? "minilm",
  "minilm",
  "Engine QA requires MiniLM",
);
process.env.EMBEDDING_MODEL = "minilm";
const modelUrl = new URL(process.env.LLAMA_BASE_URL ?? "");
assert.ok(
  modelUrl.protocol === "http:" &&
    modelUrl.hostname === "127.0.0.1" &&
    Number(modelUrl.port) > 0 &&
    modelUrl.pathname === "/v1" &&
    !modelUrl.username &&
    !modelUrl.password &&
    !modelUrl.search &&
    !modelUrl.hash,
  "Engine QA requires a loopback llama proxy URL",
);

const bodySchema = z.object({
  messages: z.array(z.unknown()).min(1).max(60),
  contract: z.enum(["shopping-v2", "shopping-v3"]).optional(),
  conversationId: z.string().min(1).max(150).optional(),
  cart: z
    .object({
      lines: z
        .array(
          z.object({
            productId: z
              .string()
              .max(150)
              .refine((id) => products.some((p) => p.id === id)),
            quantity: z.number().int().min(1).max(99),
          }),
        )
        .max(products.length)
        .refine(
          (lines) =>
            new Set(lines.map((x) => x.productId)).size === lines.length,
        ),
    })
    .optional(),
});
const server = createServer(async (req, res) => {
  if (req.socket.remoteAddress !== "127.0.0.1") {
    res.writeHead(403).end();
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(
        JSON.stringify({
          mode: "engine-functional-QA",
          model: "qwen38-uncensored",
          turnTimeoutMs: 600000,
        }),
      );
    return;
  }
  if (req.method !== "POST" || req.url !== "/api/chat") {
    res.writeHead(404).end();
    return;
  }
  const controller = new AbortController();
  const disconnected = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", disconnected);
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const value of req) {
      const chunk = Buffer.from(value);
      size += chunk.length;
      assert.ok(size <= 100000, "Conversation is too long");
      chunks.push(chunk);
    }
    const body = bodySchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    const normalized = settledMessages(body.messages);
    assert.equal(
      normalized.length,
      body.messages.length,
      "Unsupported conversation messages",
    );
    const usage = conversationUsage(normalized);
    assert.ok(
      usage.turns <= MAX_CONVERSATION_TURNS &&
        usage.characters <= MAX_CONVERSATION_CHARACTERS,
      "Conversation limit reached",
    );
    const user = normalized.findLast((m) => m.role === "user");
    assert.ok(
      user && normalized.at(-1)?.role === "user",
      "Final message must be a user turn",
    );
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(600000),
    ]);
    const text = user.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    const state = stateFromMessages(normalized, user.id);
    const action =
      user.metadata?.shoppingAction ?? legacyButtonAction(text, state);
    const runtime = needsModel({ text, action })
      ? await resolveChatRuntime(signal)
      : catalogOnlyRuntime;
    const response = createUIMessageStreamResponse({
      stream: createNativeAgentStream(
        runtime,
        getShop().catalog,
        {
          text,
          userMessageId: user.id,
          conversationId: body.conversationId,
          state,
          action,
          adviceFor:
            action?.type === "advice"
              ? adviceResultFromMessages(normalized, action.operationId)
              : undefined,
          cart: body.cart?.lines,
          history: normalized
            .slice(0, -1)
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join(" "),
            })),
        },
        signal,
        { contract: body.contract },
      ),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    const reader = response.body?.getReader();
    if (reader)
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          if (res.destroyed) break;
          res.write(Buffer.from(next.value));
        }
      } finally {
        reader.releaseLock();
      }
    if (!res.destroyed) res.end();
  } catch (error) {
    if (!res.destroyed) {
      if (!res.headersSent)
        res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Engine QA request failed" }));
    }
    console.error(
      "[ENGINE QA]",
      error instanceof Error ? error.message : "Unknown error",
    );
  } finally {
    res.off("close", disconnected);
  }
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const info = { mode: "engine-functional-QA", port: address.port };
  if (process.send) process.send(info);
  else console.log(JSON.stringify(info));
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () =>
    server.close(() => process.exit(signal === "SIGINT" ? 130 : 143)),
  );
