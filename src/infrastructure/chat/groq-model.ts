import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ChatRuntime } from "./runtime";
import { windowsFetch } from "./windows-fetch";
export interface GroqConfig {
  baseURL: string;
  modelId: string;
  apiKey?: string;
  balancer: boolean;
  windowsTransport: boolean;
}
export function createGroqRuntime(
  config: GroqConfig,
  fetchImplementation: typeof fetch = config.windowsTransport
    ? windowsFetch
    : fetch,
): ChatRuntime {
  if (!config.balancer && !config.apiKey)
    throw new Error("GROQ_API_KEY is required for direct Groq access.");
  const transport: typeof fetch = async (input, init) => {
    // Background traffic preserves the balancer's dictation reservation; never use its cleanup route.
    const url = String(input).replace(
      /\/chat\/completions$/,
      config.balancer ? "/background/chat/completions" : "/chat/completions",
    );
    return fetchImplementation(url, init);
  };
  const provider = createOpenAICompatible({
    name: "groq",
    baseURL: config.baseURL,
    apiKey: config.apiKey ?? "not-needed",
    fetch: transport,
    headers: config.balancer
      ? {
          "X-Balancer-Client": "aurelle-demo",
          "X-Balancer-Purpose": "shopping-assistant",
        }
      : undefined,
  });
  return {
    model: provider(config.modelId),
    label: `Groq / ${config.modelId}`,
    providerOptions: { groq: { response_format: { type: "json_object" } } },
    maxOutputTokens: 3000,
  };
}
