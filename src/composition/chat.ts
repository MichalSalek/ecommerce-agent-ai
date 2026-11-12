import { chatConfig } from "./shop";
import {
  resolveLlamaModel,
  LLAMA_PROVIDER,
} from "@/infrastructure/chat/llama-model";
import { createGroqRuntime } from "@/infrastructure/chat/groq-model";
import type { ChatRuntime } from "@/infrastructure/chat/runtime";
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
  return {
    model: await resolveLlamaModel(config, signal),
    label: config.modelId ?? "Local llama.cpp",
    providerOptions: {
      [LLAMA_PROVIDER]: { response_format: { type: "json_object" } },
    },
    maxOutputTokens: 3000,
  };
}
