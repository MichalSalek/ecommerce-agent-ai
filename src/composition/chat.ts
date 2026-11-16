import { chatConfig } from "./shop";
import {
  resolveLlamaModel,
  LLAMA_PROVIDER,
} from "@/infrastructure/chat/llama-model";
import { createGroqRuntime } from "@/infrastructure/chat/groq-model";
import type { ChatRuntime } from "@/infrastructure/chat/runtime";
export const catalogOnlyRuntime: ChatRuntime = {
  model: {
    specificationVersion: "v4",
    provider: "catalog",
    modelId: "catalog-only",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("Unexpected inference for a catalog action.");
    },
    doStream: async () => {
      throw new Error("Unexpected inference for a catalog action.");
    },
  },
  label: "Catalog",
  providerOptions: {},
  maxOutputTokens: 0,
};
export async function resolveChatRuntime(
  signal: AbortSignal,
): Promise<ChatRuntime> {
  const config = chatConfig();
  if (config.provider === "groq") {
    const runtime = createGroqRuntime(config.groq);
    console.log("[LLM] provider:", runtime.label);
    return runtime;
  }
  if (config.provider !== "llama")
    throw new Error("Unknown CHAT_PROVIDER. Use llama or groq.");
  const model = await resolveLlamaModel(config, signal);
  return {
    model,
    label: config.modelId ?? "Local llama.cpp",
    currentRoute: () => ({ modelId: model.modelId, reason: "local" }),
    providerOptions: { [LLAMA_PROVIDER]: { parallel_tool_calls: false } },
    maxOutputTokens: 1024,
    stableAdviceTools: true,
  };
}
