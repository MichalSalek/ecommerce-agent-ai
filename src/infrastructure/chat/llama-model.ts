import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
export const LLAMA_PROVIDER = "llamaCpp";
export function createLlamaModel(
  baseURL: string,
  modelId: string,
  fetchImplementation: typeof fetch = fetch,
) {
  return createOpenAICompatible({
    name: LLAMA_PROVIDER,
    baseURL,
    apiKey: "not-needed",
    fetch: fetchImplementation,
  })(modelId);
}
export async function resolveLlamaModel(
  config: { baseURL: string; modelId?: string },
  signal: AbortSignal,
) {
  try {
    const response = await fetch(`${config.baseURL}/models`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = z
      .object({ data: z.array(z.object({ id: z.string().min(1) })).min(1) })
      .parse(await response.json());
    const id = config.modelId ?? catalog.data[0].id;
    if (!catalog.data.some((model) => model.id === id))
      throw new Error(`Model ${id} is not available.`);
    console.log("[LLM] model:", id);
    return createLlamaModel(config.baseURL, id);
  } catch {
    throw new Error(
      `Cannot connect to the configured model at ${config.baseURL}. Check llama-server or llama-swap and the model ID.`,
    );
  }
}
