import { test } from "node:test";
import assert from "node:assert/strict";
import { generateText } from "ai";
import { createGroqRuntime } from "../src/infrastructure/chat/groq-model";
import { chatConfig } from "../src/composition/chat-config";
import { GROQ_IDENTITY } from "../src/infrastructure/chat/groq-identity.mjs";
const GROQ_MODEL = GROQ_IDENTITY.modelId;

const direct = { baseURL: "https://api.groq.com/openai/v1", modelId: GROQ_MODEL, apiKey: "fixture-only" };
test("429 and retries never request another model", async () => {
  const requested: string[] = [];
  const runtime = createGroqRuntime(direct, async (_url, init) => {
    requested.push(JSON.parse(String(init?.body)).model);
    return Response.json({ error: { message: "limited" } }, { status: 429, headers: { "retry-after": "30" } });
  });
  await assert.rejects(generateText({ model: runtime.model, prompt: "test", maxRetries: 0 }));
  await assert.rejects(generateText({ model: runtime.model, prompt: "test", maxRetries: 0 }));
  assert.deepEqual(requested, [GROQ_MODEL]);
});

test("public configuration ignores all alternative provider settings", () => {
  assert.ok(Object.isFrozen(GROQ_IDENTITY));
  const config = chatConfig({ GROQ_API_KEY: "fixture", CHAT_PROVIDER: "llama", GROQ_BASE_URL: "http://localhost:1", GROQ_MODEL: "qwen/qwen3.8-27b", GROQ_FALLBACK_MODEL: "qwen/qwen3.8-27b", GROQ_BALANCER: "true", LLAMA_MODEL: "other" });
  assert.equal(config.provider, "groq");
  if (config.provider !== "groq") throw new Error("unexpected provider");
  assert.deepEqual(config.groq, { ...direct, apiKey: "fixture" });
});

test("local QA is explicit, loopback-only and forbidden on Render", () => {
  const base = { HOSTNAME: "127.0.0.1", AURELLE_LOCAL_QA: "llama", LLAMA_BASE_URL: "http://127.0.0.1:9999/v1", LLAMA_MODEL: "qwen" };
  assert.equal(chatConfig(base).provider, "llama");
  for (const overrides of [{ HOSTNAME: "0.0.0.0" }, { RENDER: "true" }, { RENDER: "" }, { RENDER_SERVICE_ID: "srv" }, { RENDER_EXTERNAL_URL: "https://example.com" }, { LLAMA_BASE_URL: "https://api.groq.com/openai/v1" }, { LLAMA_BASE_URL: "http://127.0.0.1:9999@evil.test/v1" }]) {
    assert.throws(() => chatConfig({ ...base, ...overrides }));
  }
  assert.throws(() => chatConfig({ HOSTNAME: "127.0.0.1", AURELLE_LOCAL_QA: "groq-proxy", GROQ_BASE_URL: "http://127.0.0.1:1234/v1", RENDER: "true" }));
  const proxy = chatConfig({ HOSTNAME: "127.0.0.1", AURELLE_LOCAL_QA: "groq-proxy", GROQ_BASE_URL: "http://127.0.0.1:1234/v1", GROQ_MODEL: "qwen/qwen3.8-27b", GROQ_API_KEY: "fixture" });
  assert.equal(proxy.provider, "groq");
  if (proxy.provider === "groq") assert.equal(proxy.groq.modelId, GROQ_MODEL);
});

test("a completion reporting another or unverified model cannot reach the shop", async () => {
  const runtime = createGroqRuntime(direct, async () => Response.json({ id: "completion-id", model: "actual/provider-model", created: 0, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "Ready" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }, { headers: { "x-request-id": "req_123" } }));
  await assert.rejects(generateText({ model: runtime.model, prompt: "test", maxRetries: 0 }), /did not confirm the requested model/);
  assert.deepEqual(runtime.currentRoute?.(), { modelId: GROQ_MODEL, reason: "primary", reportedModelId: "actual/provider-model", providerRequestId: "req_123" });
  const unsafe = createGroqRuntime(direct, async () => Response.json({ id: "completion-id", model: "private model", created: 0, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "Ready" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }, { headers: { "x-request-id": "private payload" } }));
  await assert.rejects(generateText({ model: unsafe.model, prompt: "test", maxRetries: 0 }), /did not confirm the requested model/);
  assert.equal(unsafe.currentRoute?.().reportedModelId, undefined);
  assert.equal(unsafe.currentRoute?.().providerRequestId, undefined);
});

test("explicit local key file is parsed only for local normal runtime", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "aurelle-key-fixture-"));
  const path = join(dir, "fixture.env");
  try {
    await writeFile(path, 'API_KEY = "fixture-secret"\n');
    const local = chatConfig({ AURELLE_GROQ_KEY_FILE: path });
    assert.equal(local.provider === "groq" && local.groq.apiKey, "fixture-secret");
    const explicit = chatConfig({ AURELLE_GROQ_KEY_FILE: "/missing", GROQ_API_KEY: "explicit" });
    assert.equal(explicit.provider === "groq" && explicit.groq.apiKey, "explicit");
    const render = chatConfig({ RENDER: "true", AURELLE_GROQ_KEY_FILE: "/missing" });
    assert.equal(render.provider === "groq" && render.groq.apiKey, undefined);
    assert.equal(chatConfig({ HOSTNAME: "127.0.0.1", AURELLE_LOCAL_QA: "llama", LLAMA_BASE_URL: "http://127.0.0.1:9999/v1", LLAMA_MODEL: "fixture", AURELLE_GROQ_KEY_FILE: "/missing" }).provider, "llama");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
