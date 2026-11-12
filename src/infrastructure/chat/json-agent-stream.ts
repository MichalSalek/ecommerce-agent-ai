import {
  createUIMessageStream,
  generateText,
  type ModelMessage,
  type LanguageModel,
} from "ai";
import { narrateResults } from "./narration";
import { instructions } from "@/application/chat/instructions";
import type { ShopTools } from "@/application/chat/tools";
import { requestedProductId } from "@/application/chat/requests";
import { budgetBrowseRequest } from "@/application/catalog/search-intent";
import {
  conversationContext,
  requestedBudget,
  isMoreRequest,
  isHomeRequest,
  isCategoriesRequest,
  isLanguageRequest,
  isGreeting,
  isBudgetBrowse,
} from "@/application/chat/conversation";
import {
  searchReply,
  simpleReply,
  categoriesReply,
  policyReply,
  nextQuestion,
} from "@/application/chat/replies";
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
  options?: Pick<
    ChatRuntime,
    "providerOptions" | "maxOutputTokens" | "narrate"
  >,
) {
  const context = conversationContext(messages);
  return createUIMessageStream({
    execute: async ({ writer }) => {
      const write = (text: string) => {
        writer.write({ type: "text-start", id: "answer" });
        writer.write({ type: "text-delta", id: "answer", delta: text });
        writer.write({ type: "text-end", id: "answer" });
      };
      const { text } = context;
      const budget = requestedBudget(text);
      const more = isMoreRequest(text);
      const broad = isHomeRequest(text);
      const productId = requestedProductId(text);
      let action: ShopAction;
      if (isGreeting(text)) {
        write(simpleReply("greeting", context));
        return;
      }
      if (isLanguageRequest(text)) {
        write(simpleReply("language", context));
        return;
      }
      if (
        /\b(python|javascript|write code|programming)\b|napisz.*(?:kod|pętl)/i.test(
          text,
        )
      ) {
        write(simpleReply("refuse", context));
        return;
      }
      if (isCategoriesRequest(text))
        action = { tool: "getCategories", input: {} };
      else if (productId)
        action = { tool: "getProductDetails", input: { productId } };
      else if (broad)
        action = {
          tool: "searchProducts",
          input: { query: "", category: "Home", limit: 2 },
        };
      else if (more && context.previousSearch)
        action = actionSchema.parse({
          tool: "searchProducts",
          input: {
            ...context.previousSearch,
            excludeIds: context.shownIds,
            limit: 2,
          },
        });
      else if (isBudgetBrowse(text) || budgetBrowseRequest(text))
        action = {
          tool: "searchProducts",
          input: {
            query: "",
            category: context.homeContext ? "Home" : undefined,
            limit: budget?.mode === "around" ? 2 : 12,
          },
        };
      else {
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
        try {
          action = parseToolAction(result.text);
        } catch (error) {
          console.warn(
            "[LLM] invalid action; asking for clarification:",
            error instanceof Error ? error.message : "Unknown error",
          );
          write(simpleReply("repair", context));
          return;
        }
      }
      if (action.tool === "refuse") {
        write(simpleReply("refuse", context));
        return;
      }
      if (action.tool === "respond") {
        write(action.input.message);
        return;
      }
      if (action.tool === "searchProducts" && budget) {
        // Numeric budget meaning is owned by the application, not guessed by the LLM.
        const { maxPrice: _max, targetPrice: _target, ...input } = action.input;
        action = {
          ...action,
          input: {
            ...input,
            ...(budget.mode === "around"
              ? { targetPrice: budget.amount }
              : { maxPrice: budget.amount }),
          },
        };
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
        case "getCategories":
          output = await tools.getCategories.execute!(action.input, execution);
          break;
      }
      writer.write({
        type: "tool-input-available",
        toolCallId: id,
        toolName: action.tool,
        input: action.input,
      });
      writer.write({ type: "tool-output-available", toolCallId: id, output });
      if (action.tool === "searchProducts" && Array.isArray(output)) {
        const products = output.map((p) => productSchema.parse(p));
        const narration =
          options?.narrate &&
          products.length &&
          (!budget || budget.currency === "EUR")
            ? await narrateResults(
                model,
                messages,
                products,
                context,
                options,
                signal,
                broad,
              )
            : undefined;
        write(
          searchReply(products, context, {
            broad,
            more,
            budget,
            narration: narration || undefined,
          }),
        );
      } else if (action.tool === "getCategories" && Array.isArray(output))
        write(
          categoriesReply(
            output.filter((v): v is string => typeof v === "string"),
            context,
          ),
        );
      else if (typeof output === "string") write(policyReply(output, context));
      else {
        const product = productSchema.safeParse(output);
        write(
          product.success
            ? `${product.data.name} — ${product.data.price.toFixed(2)} EUR. ${context.language === "pl" ? (product.data.inStock ? "Produkt dostępny." : "Produkt obecnie niedostępny.") : product.data.inStock ? "In stock." : "Currently out of stock."}\n\n${nextQuestion(context)}`
            : simpleReply("repair", context),
        );
      }
    },
    onError: (error) => {
      console.error(
        "[LLM] agent failed:",
        error instanceof Error ? error.message : "Unknown error",
      );
      return context.language === "pl"
        ? "Nie udało się połączyć z asystentem. Twoja wiadomość pozostała w rozmowie — spróbuj ponownie."
        : "The assistant could not respond. Your message is still in the conversation — please try again.";
    },
    onFinish: () => console.log("[AGENT] finished"),
  });
}
