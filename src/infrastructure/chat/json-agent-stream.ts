import {
  createUIMessageStream,
  generateText,
  type ModelMessage,
  type LanguageModel,
} from "ai";
import { narrateResults } from "./narration";
import { instructions } from "@/application/chat/instructions";
import type { ShopTools } from "@/application/chat/tools";
import {
  comparisonIds,
  latestResultIds,
  wantsAvailableOnly,
  giftRequest,
} from "@/application/chat/discovery";
import { products as catalogProducts } from "@/data/products";
import { compactModelHistory } from "@/application/chat/model-history";
import { clearShoppingRequest } from "@/application/chat/shopping-intent";
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
  > & { onSettled?: () => void },
) {
  const started = performance.now();
  let llmCalls = 0;
  let route = "structured";
  let operation = "reply";
  const context = conversationContext(messages);
  return createUIMessageStream({
    execute: async ({ writer }) => {
      try {
        const write = (text: string) => {
          writer.write({ type: "text-start", id: "answer" });
          writer.write({ type: "text-delta", id: "answer", delta: text });
          writer.write({ type: "text-end", id: "answer" });
        };
        const { text } = context;
        if (
          /trwało[sś][cć]|durabil|odporność/i.test(text) &&
          messages.some((m) => JSON.stringify(m.content).match(/wazon|vase/i))
        ) {
          operation = "material-evidence";
          write(
            context.language === "pl"
              ? "Jeśli najważniejsza jest trwałość, nie chcę zgadywać: katalog potwierdza ceramikę lub szkło, ale nie zawiera testów odporności na uderzenia ani grubości ścianek. Oba materiały mogą się stłuc. Czy chodzi Ci o codzienne użytkowanie, czy ryzyko upadku? Mogę też poszukać mniej kruchej alternatywy."
              : "For durability, I should not guess: the catalog identifies ceramic or glass, but has no impact-resistance tests or wall-thickness data. Both can break. Is your concern daily use or accidental drops? I can also help find a less fragile alternative.",
          );
          return;
        }
        const budget = requestedBudget(text);
        const more = isMoreRequest(text);
        const broad = isHomeRequest(text);
        const productId = requestedProductId(text);
        const shoppingRequest = clearShoppingRequest(text);
        const compareIds = comparisonIds(
          text,
          latestResultIds(messages),
          catalogProducts,
        );
        if (compareIds && compareIds.length < 2) {
          write(
            context.language === "pl"
              ? "Które dwa produkty chcesz porównać? Podaj ich nazwy lub najpierw poproś o propozycje."
              : "Which two products would you like to compare? Name them or ask for suggestions first.",
          );
          return;
        }

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
        if (compareIds)
          action = {
            tool: "compareProducts",
            input: { productIds: compareIds },
          };
        else if (giftRequest(text))
          action = {
            tool: "searchProducts",
            input: { query: "", limit: 2, inStockOnly: true },
          };
        else if (wantsAvailableOnly(text))
          action = {
            tool: "searchProducts",
            input: {
              ...(context.previousSearch ?? { query: "" }),
              inStockOnly: true,
              limit: 2,
            },
          };
        else if (isCategoriesRequest(text))
          action = { tool: "getCategories", input: {} };
        else if (productId)
          action = { tool: "getProductDetails", input: { productId } };
        else if (shoppingRequest)
          action = { tool: "searchProducts", input: shoppingRequest };
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
          route = "llm-planner";
          llmCalls++;
          const result = await generateText({
            model,
            system: instructions,
            messages: [
              ...compactModelHistory(messages),
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
          const {
            maxPrice: _max,
            targetPrice: _target,
            ...input
          } = action.input;
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
        if (action.tool === "searchProducts" && wantsAvailableOnly(text))
          action = { ...action, input: { ...action.input, inStockOnly: true } };
        operation = action.tool;
        const id = crypto.randomUUID();
        const execution = { toolCallId: id, messages, context: {} };
        let output: unknown;
        switch (action.tool) {
          case "searchProducts":
            output = await tools.searchProducts.execute!(
              action.input,
              execution,
            );
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
          case "compareProducts":
            output = await tools.compareProducts.execute!(
              action.input,
              execution,
            );
            break;
          case "getCategories":
            output = await tools.getCategories.execute!(
              action.input,
              execution,
            );
            break;
        }
        writer.write({
          type: "tool-input-available",
          toolCallId: id,
          toolName: action.tool,
          input: action.input,
        });
        writer.write({ type: "tool-output-available", toolCallId: id, output });
        if (action.tool === "compareProducts") {
          const comparison = output as {
            products: import("@/domain/catalog/product").Product[];
            missingIds: string[];
          };
          if (
            comparison &&
            typeof comparison === "object" &&
            "products" in comparison &&
            Array.isArray(comparison.products)
          ) {
            const rows = comparison.products.map(
              (p) =>
                `${p.name}: ${p.price.toFixed(2)} EUR · ${context.language === "pl" ? (p.inStock ? "dostępny" : "niedostępny") : p.inStock ? "in stock" : "out of stock"} · ${p.description}`,
            );
            const difference =
              comparison.products.length === 2
                ? Math.abs(
                    comparison.products[0].price - comparison.products[1].price,
                  ).toFixed(2)
                : undefined;
            write(
              [
                context.language === "pl"
                  ? "Porównanie na podstawie danych katalogu:"
                  : "Comparison based on catalog facts:",
                ...rows,
                difference
                  ? `${context.language === "pl" ? "Różnica ceny" : "Price difference"}: ${difference} EUR.`
                  : "",
                comparison.missingIds.length
                  ? `Missing product IDs: ${comparison.missingIds.join(", ")}`
                  : "",
                context.language === "pl"
                  ? "Wolisz niższą cenę czy konkretny sposób użycia? Nie oceniam trwałości bez danych."
                  : "Would you prioritize price or a particular use? Durability cannot be inferred from these records.",
              ]
                .filter(Boolean)
                .join("\n\n"),
            );
            return;
          }
        }
        if (action.tool === "searchProducts" && Array.isArray(output)) {
          const products = output.map((p) => productSchema.parse(p));
          const willNarrate = !!(
            options?.narrate &&
            !giftRequest(text) &&
            products.length &&
            (!budget || budget.currency === "EUR")
          );
          if (willNarrate) llmCalls++;
          const narration =
            options?.narrate &&
            !giftRequest(text) &&
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
              gift: giftRequest(text),
            }),
          );
        } else if (action.tool === "getCategories" && Array.isArray(output))
          write(
            categoriesReply(
              output.filter((v): v is string => typeof v === "string"),
              context,
            ),
          );
        else if (typeof output === "string")
          write(policyReply(output, context));
        else {
          const product = productSchema.safeParse(output);
          write(
            product.success
              ? `${product.data.name} — ${product.data.price.toFixed(2)} EUR. ${context.language === "pl" ? (product.data.inStock ? "Produkt dostępny." : "Produkt obecnie niedostępny.") : product.data.inStock ? "In stock." : "Currently out of stock."}\n\n${nextQuestion(context)}`
              : simpleReply("repair", context),
          );
        }
      } finally {
        console.log("[AGENT] trace", {
          route,
          operation,
          llmCalls,
          elapsedMs: Math.round(performance.now() - started),
          responseCache: false,
        });
        options?.onSettled?.();
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
