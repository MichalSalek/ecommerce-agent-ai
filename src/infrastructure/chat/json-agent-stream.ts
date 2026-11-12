import {
  createUIMessageStream,
  generateText,
  type ModelMessage,
  type LanguageModel,
} from "ai";
import { instructions, refusal } from "@/application/chat/instructions";
import type { ShopTools } from "@/application/chat/tools";
import { requestedProductId } from "@/application/chat/requests";
import { budgetBrowseRequest } from "@/application/catalog/search-intent";
import {
  actionSchema,
  type ShopAction,
  selectionInstruction,
  parseToolAction,
} from "./json-protocol";
import { productSchema } from "@/domain/catalog/product";
import { LLAMA_PROVIDER } from "./llama-model";
import type { ChatRuntime } from "./runtime";
export function createJsonAgentStream(
  model: LanguageModel,
  messages: ModelMessage[],
  tools: ShopTools,
  signal: AbortSignal,
  options?: Pick<ChatRuntime, "providerOptions" | "maxOutputTokens">,
) {
  return createUIMessageStream({
    execute: async ({ writer }) => {
      const write = (text: string) => {
        writer.write({ type: "text-start", id: "answer" });
        writer.write({ type: "text-delta", id: "answer", delta: text });
        writer.write({ type: "text-end", id: "answer" });
      };
      const last = messages.findLast((message) => message.role === "user");
      const lastText =
        typeof last?.content === "string"
          ? last.content
          : Array.isArray(last?.content)
            ? last.content
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join(" ")
            : "";
      const browse = budgetBrowseRequest(lastText);
      const productId = requestedProductId(lastText);
      let action: ShopAction;
      if (browse) {
        action = actionSchema.parse({ tool: "searchProducts", input: browse });
      } else if (productId) {
        action = actionSchema.parse({
          tool: "getProductDetails",
          input: { productId },
        });
      } else {
        const result = await generateText({
          model,
          system: instructions,
          messages: [
            ...messages,
            { role: "user", content: selectionInstruction },
          ],
          abortSignal: signal,
          maxRetries: 0,
          temperature: 0.1,
          maxOutputTokens: options?.maxOutputTokens ?? 3000,
          providerOptions: options?.providerOptions ?? {
            [LLAMA_PROVIDER]: { response_format: { type: "json_object" } },
          },
        });
        action = parseToolAction(result.text);
      }
      if (action.tool === "refuse") {
        write(refusal);
        return;
      }
      const id = crypto.randomUUID();
      const execution = { toolCallId: id, messages, context: {} };
      let output: unknown;
      switch (action.tool) {
        case "searchProducts":
          output = await tools.searchProducts.execute!(action.input, execution);
          break;
        case "getProductDetails":
          output = await tools.getProductDetails.execute!(
            action.input,
            execution,
          );
          break;
        case "getPolicy":
          output = await tools.getPolicy.execute!(action.input, execution);
          break;
      }
      writer.write({
        type: "tool-input-available",
        toolCallId: id,
        toolName: action.tool,
        input: action.input,
      });
      writer.write({ type: "tool-output-available", toolCallId: id, output });
      // Tool output owns facts. Deterministic presentation cannot contradict successful retrieval.
      if (action.tool === "searchProducts" && Array.isArray(output)) {
        write(
          output.length
            ? `Here are ${output.length} options${action.input.maxPrice !== undefined ? ` up to EUR ${action.input.maxPrice}` : ""}. Open a product for details or add it to your cart.`
            : "No matching products found. Try a different request or budget.",
        );
      } else if (typeof output === "string") write(output);
      else {
        const product = productSchema.safeParse(output);
        write(
          product.success
            ? `${product.data.name}: ${product.data.description} EUR ${product.data.price.toFixed(2)}. ${product.data.inStock ? "In stock." : "Currently out of stock."}`
            : "Product not found. Please choose a product from the catalog.",
        );
      }
    },
    onError: (error) => {
      console.error(
        "[LLM] agent failed:",
        error instanceof Error ? error.message : "Unknown error",
      );
      return "The assistant could not answer. Please try again.";
    },
    onFinish: () => console.log("[AGENT] finished"),
  });
}
