import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import type { Product } from "@/domain/catalog/product";
import type { ConversationContext } from "@/application/chat/conversation";
import type { ChatRuntime } from "./runtime";
import { compactModelHistory } from "@/application/chat/model-history";
import { parseJsonObject } from "./json-protocol";
const schema = z.object({
  opening: z.string().min(1).max(240),
  followUp: z.string().min(1).max(240),
});
export async function narrateResults(
  model: LanguageModel,
  messages: ModelMessage[],
  products: Product[],
  context: ConversationContext,
  options: Pick<ChatRuntime, "providerOptions" | "maxOutputTokens">,
  signal: AbortSignal,
  broad: boolean,
) {
  try {
    const result = await generateText({
      model,
      system:
        "You write only conversational transitions for Aurelle. Product facts and prices are displayed separately by the application. Do not repeat earlier openings or use a generic sales script. Use the customer's language, honoring their most recent explicit language preference. Return JSON with opening and followUp. No digits, prices, currency amounts, URLs, availability claims, payment/order offers or invented product attributes. followUp must be one relevant question ending in a question mark.",
      messages: [
        ...compactModelHistory(messages),
        {
          role: "user",
          content: `Write a short natural opening and a helpful next question after successful retrieval. Known product names and categories: ${JSON.stringify(products.map((p) => ({ name: p.name, category: p.category })))}. ${broad ? "The customer only said they want something for home. Ask which category interests them, for example decor, textiles, lighting or kitchen." : "Help refine the current shopping request without inventing facts."} Fallback language preference detected by the app: ${context.language}. If the customer is using a different language, use theirs.`,
        },
      ],
      maxRetries: 0,
      maxOutputTokens: options.maxOutputTokens,
      temperature: 0.4,
      providerOptions: options.providerOptions,
      abortSignal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    });
    const reply = schema.parse(parseJsonObject(result.text));
    const text = reply.opening + " " + reply.followUp;
    if (
      /[\d€$]|https?:|\b(EUR|USD|dollars?|no products|no matching|out of stock|checkout|payment)\b|brak produktów|nie mam|płatno|złóż zamów/i.test(
        text,
      ) ||
      !/[?？؟]$/.test(reply.followUp)
    )
      throw new Error(
        "Narration contains unsupported facts or no follow-up question.",
      );
    return reply;
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn(
      "[LLM] conversational wording unavailable; using grounded reply:",
      error instanceof Error ? error.name : "Unknown error",
    );
    return undefined;
  }
}
