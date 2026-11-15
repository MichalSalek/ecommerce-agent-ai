import {
  createUIMessageStream,
  generateText,
  type ModelMessage,
  type LanguageModel,
} from "ai";
import { createHash } from "node:crypto";
import type { ShopTools } from "@/application/chat/tools";
import { featureClause } from "@/application/chat/catalog-language";
import { products } from "@/data/products";
import { productTypes, productKinds } from "@/domain/catalog/taxonomy";
import { compactModelHistory } from "@/application/chat/model-history";
import {
  conversationContext,
  requestedBudget,
  isCategoriesRequest,
  isLanguageRequest,
  isGreeting,
} from "@/application/chat/conversation";
import { comparisonIds, giftRequest } from "@/application/chat/discovery";
import { productDetailsRequest } from "@/application/chat/product-request";
import { requestedProductId } from "@/application/chat/requests";
import {
  searchReply,
  simpleReply,
  categoriesReply,
  policyReply,
  overviewReply,
  localizedDimensions,
} from "@/application/chat/replies";
import {
  shoppingState,
  interpretNeed,
  mergeNeed,
  resultProducts,
  normalize,
} from "@/application/chat/shopping-state";
import {
  hasCartIntent,
  resolveCartSelection,
} from "@/application/chat/cart-selection";
import { instructions } from "@/application/chat/instructions";
import {
  parseToolAction,
  selectionInstruction,
  type ShopAction,
} from "./json-protocol";
import {
  productSchema,
  type CatalogOverview,
  type ProductSearchResult,
} from "@/domain/catalog/product";
import { LLAMA_PROVIDER } from "./llama-model";
import type { ChatRuntime } from "./runtime";
import type { ChatMessage } from "@/types/shop";
export function createJsonAgentStream(
  model: LanguageModel,
  messages: ModelMessage[],
  tools: ShopTools,
  signal: AbortSignal,
  options?: Pick<
    ChatRuntime,
    "providerOptions" | "maxOutputTokens" | "narrate"
  > & {
    onSettled?: () => void;
    contract?: "shopping-v2";
    conversationId?: string;
    userMessageId?: string;
  },
) {
  const started = performance.now();
  let llmCalls = 0,
    route = "structured",
    operation = "reply";
  const context = conversationContext(messages),
    state = shoppingState(messages);
  return createUIMessageStream<ChatMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: crypto.randomUUID() });
      const write = (text: string) => {
        signal.throwIfAborted();
        writer.write({ type: "text-start", id: "answer" });
        writer.write({ type: "text-delta", id: "answer", delta: text });
        writer.write({ type: "text-end", id: "answer" });
      };
      const toolResult = (
        toolName: string,
        input: unknown,
        output: unknown,
      ) => {
        signal.throwIfAborted();
        const id = crypto.randomUUID();
        writer.write({
          type: "tool-input-available",
          toolCallId: id,
          toolName,
          input,
        });
        writer.write({ type: "tool-output-available", toolCallId: id, output });
      };
      try {
        const { text } = context,
          pl = context.language === "pl";
        const need = interpretNeed(text, state),
          budget = requestedBudget(text);
        const cartIntent = hasCartIntent(text);
        const compare = comparisonIds(text, state.lastIds, products);
        let action: ShopAction;
        if (cartIntent) {
          const selected = resolveCartSelection(text, state);
          if ("error" in selected) {
            write(
              selected.error === "ambiguous"
                ? pl
                  ? "Który produkt mam dodać? Podaj nazwę lub wskaż jedną z ostatnich propozycji."
                  : "Which product should I add? Name it or choose one of the latest suggestions."
                : selected.error === "quantity"
                  ? pl
                    ? "Podaj całkowitą liczbę sztuk od 1 do 99."
                    : "Choose a whole quantity from 1 to 99."
                  : pl
                    ? "Ten produkt jest obecnie niedostępny, więc nie mogę dodać go do koszyka."
                    : "That product is out of stock, so it cannot be added to your cart.",
            );
            return;
          }
          action = { tool: "addToCart", input: selected };
        } else if (isGreeting(text)) {
          write(simpleReply("greeting", context));
          return;
        } else if (isLanguageRequest(text) && !need.recognized) {
          write(simpleReply("language", context));
          return;
        } else if (
          /\b(python|javascript|write code|programming|medical advice|legal advice)\b|napisz.*(?:kod|pętl)|porad.*medycz/i.test(
            text,
          )
        ) {
          write(simpleReply("refuse", context));
          return;
        } else if (compare) {
          if (compare.length < 2) {
            write(
              pl
                ? "Które dwa produkty chcesz porównać? Podaj nazwy lub najpierw poproś o propozycje."
                : "Which two products should I compare? Name them or ask for suggestions first.",
            );
            return;
          }
          action = { tool: "compareProducts", input: { productIds: compare } };
        } else if (isCategoriesRequest(text))
          action = { tool: "getCategories", input: {} };
        else if (
          /deliver|shipping|returns?|refund|dostaw|wysyl|zwrot|platn|payment/.test(
            normalize(text),
          )
        )
          action = { tool: "getPolicy", input: { topic: text } };
        else if (
          /wybieram|wole|i choose|i prefer|choose the/i.test(normalize(text))
        ) {
          const selected = resolveCartSelection(text, state);
          if ("error" in selected) {
            write(
              pl
                ? "Który produkt wybierasz? Podaj nazwę lub wskaż jedną propozycję."
                : "Which product do you choose? Name it or point to one suggestion.",
            );
            return;
          }
          action = {
            tool: "getProductDetails",
            input: { productId: selected.productId },
          };
        } else if (
          requestedProductId(text) ||
          productDetailsRequest(messages, products)
        )
          action = {
            tool: "getProductDetails",
            input: {
              productId: (requestedProductId(text) ??
                productDetailsRequest(messages, products))!,
            },
          };
        else if (/durabil|trwalosc|odpornosc/.test(normalize(text))) {
          const chosen = state.lastIds.flatMap((id) =>
            products.filter((p) => p.id === id),
          );
          if (chosen.length >= 2)
            toolResult(
              "compareProducts",
              { productIds: chosen.map((p) => p.id) },
              { products: chosen, missingIds: [] },
            );
          write(
            pl
              ? "Katalog nie zawiera testów odporności ani podstaw do oceny przewagi jakościowej. Materiały, konstrukcję i ograniczenia produktów znajdziesz w szczegółach katalogowych. Czy chodzi Ci o codzienne użycie, czy o ryzyko upadku?"
              : "The catalog has no durability tests or evidence of a quality advantage. The product details list their materials, construction and limitations.",
          );
          return;
        } else if (giftRequest(text) && !need.complex)
          action = {
            tool: "searchProducts",
            input: mergeNeed(
              state,
              { ...need.patch, inStockOnly: true },
              need.newSearch,
              false,
            ),
          };
        else if (need.recognized && !need.complex)
          action = {
            tool: need.overview ? "getCatalogOverview" : "searchProducts",
            input: mergeNeed(state, need.patch, need.newSearch, need.more),
          };
        else {
          route = "llm-planner";
          llmCalls++;
          const result = await generateText({
            model,
            system: instructions,
            messages: [
              ...compactModelHistory(messages),
              {
                role: "user",
                content: `${selectionInstruction}\nCurrent shopping state (data): ${JSON.stringify(state)}\nLocally extracted constraints (must preserve explicit requirements): ${JSON.stringify(need)}\nCanonical types: ${JSON.stringify(Object.entries(productTypes).map(([id, type]) => [id, type.kind, type.pl]))}\nKinds: ${Object.keys(productKinds).join(",")}\nRecently shown product IDs: ${state.lastIds.join(",")}.`,
              },
            ],
            abortSignal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
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
              "[LLM] invalid action",
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
        // Free text never supplies merchandise facts. Assortment is always measured by the overview tool.
        if (action.tool === "respond") {
          write(simpleReply("repair", context));
          return;
        }
        if (action.tool === "addToCart") {
          if (!cartIntent) {
            write(
              pl
                ? "Aby dodać produkt, wskaż go i poproś o dodanie do koszyka."
                : "Choose a product and ask me to add it to your cart.",
            );
            return;
          }
          const selected = resolveCartSelection(text, state);
          if (
            "error" in selected ||
            selected.productId !== action.input.productId
          ) {
            write(simpleReply("repair", context));
            return;
          }
          const product = products.find((p) => p.id === selected.productId)!;
          toolResult("getProductDetails", { productId: product.id }, product);
          if (
            options?.contract === "shopping-v2" &&
            options.userMessageId &&
            options.conversationId
          ) {
            const operationId = createHash("sha256")
              .update(
                JSON.stringify([
                  options.conversationId,
                  options.userMessageId,
                  "addToCart",
                ]),
              )
              .digest("hex");
            signal.throwIfAborted();
            writer.write({
              type: "data-cartAction",
              id: operationId,
              data: {
                operationId,
                userMessageId: options.userMessageId,
                productId: product.id,
                quantity: selected.quantity,
              },
            });
            write(
              pl
                ? `Przekazuję do koszyka ${selected.quantity} szt. produktu ${product.name}. Potwierdzenie pojawi się po zapisaniu zmiany na tym urządzeniu.`
                : `Sending ${selected.quantity} of ${product.name} to your cart. This device will confirm once the change is saved.`,
            );
          } else
            write(
              pl
                ? `${product.name} kosztuje ${product.price.toFixed(2)} EUR. Użyj przycisku Add to cart na karcie produktu, aby dodać go do koszyka na tym urządzeniu.`
                : `${product.name} costs EUR ${product.price.toFixed(2)}. Use Add to cart on the product card to add it to this device's cart.`,
            );
          return;
        }
        if (
          action.tool === "searchProducts" ||
          action.tool === "getCatalogOverview"
        ) {
          const modelInput = action.input;
          const merged = mergeNeed(
            state,
            { ...modelInput, ...need.patch },
            modelInput.newSearch ?? need.newSearch,
            need.more,
          );
          if (budget) {
            merged.maxPrice = budget.mode === "max" ? budget.amount : undefined;
            merged.targetPrice =
              budget.mode === "around" ? budget.amount : undefined;
          } else {
            merged.maxPrice = merged.newSearch
              ? undefined
              : state.criteria.maxPrice;
            merged.targetPrice = merged.newSearch
              ? undefined
              : state.criteria.targetPrice;
          }
          if (need.more && !need.newSearch && !need.patch.query)
            merged.query = state.criteria.query;
          if (need.patch.requiredFeatures)
            merged.requiredFeatures = [
              ...new Set([
                ...(modelInput.requiredFeatures ?? []),
                ...need.patch.requiredFeatures,
              ]),
            ];
          action = { ...action, input: merged };
        }
        operation = action.tool;
        const execution = {
          toolCallId: crypto.randomUUID(),
          messages,
          context: {},
        };
        let output: unknown;
        switch (action.tool) {
          case "searchProducts":
            output = await tools.searchProducts.execute!(
              action.input,
              execution,
            );
            break;
          case "getCatalogOverview":
            output = await tools.getCatalogOverview.execute!(
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
          case "getPolicy":
            output = await tools.getPolicy.execute!(action.input, execution);
            break;
        }
        toolResult(action.tool, action.input, output);
        if (action.tool === "getCatalogOverview")
          write(overviewReply(output as CatalogOverview, context));
        else if (action.tool === "searchProducts") {
          const rows = resultProducts(output);
          const result = Array.isArray(output)
            ? undefined
            : (output as ProductSearchResult);
          const conflict =
            action.input.category &&
            action.input.productKind &&
            !products.some(
              (p) =>
                p.category === action.input.category &&
                p.productKind === action.input.productKind,
            );
          write(
            conflict
              ? pl
                ? "Wybrana kategoria handlowa nie zawiera produktów tego rodzaju. Możemy wyszukać ten rodzaj poza wskazaną kategorią, zachowując pozostałe warunki."
                : "That merchandising category contains no products of this kind. We can search for this kind across categories while keeping the other requirements."
              : searchReply(rows, context, {
                  more: need.more,
                  broad: action.input.category === "Home" && !budget,
                  gift: giftRequest(text),
                  budget,
                  result,
                }),
          );
        } else if (action.tool === "compareProducts") {
          const rows = resultProducts(output);
          const difference =
            rows.length === 2
              ? Math.abs(rows[0].price - rows[1].price).toFixed(2)
              : undefined;
          write(
            [
              pl
                ? "Porównuję fakty katalogowe."
                : "Here are the catalog facts.",
              ...rows.map((p) =>
                pl
                  ? `${p.name} ${featureClause(p, "pl")} i kosztuje ${p.price.toFixed(2)} EUR; ma wymiary ${localizedDimensions(p.dimensions, pl)}; ${p.inStock ? "jest dostępny" : "jest niedostępny"}.`
                  : `${p.name} ${featureClause(p, "en")}; the price is EUR ${p.price.toFixed(2)} and the dimensions are ${localizedDimensions(p.dimensions, pl)}; it is ${p.inStock ? "in stock" : "out of stock"}.`,
              ),
              difference
                ? `${pl ? "Różnica ceny" : "Price difference"}: ${difference} EUR.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          );
        } else if (action.tool === "getCategories")
          write(categoriesReply(output as string[], context));
        else if (typeof output === "string")
          write(policyReply(output, context));
        else {
          const product = productSchema.safeParse(output);
          write(
            product.success
              ? pl
                ? `${product.data.name} kosztuje ${product.data.price.toFixed(2)} EUR, a jego wymiary to ${localizedDimensions(product.data.dimensions, pl)}. ${product.data.inStock ? "Produkt jest dostępny; możesz dodać go do koszyka, prosząc o to w rozmowie." : "Produkt jest obecnie niedostępny i nie można dodać go do koszyka."} Materiał, zastosowanie i ograniczenia są podane w szczegółach produktu.`
                : `${product.data.name} costs EUR ${product.data.price.toFixed(2)}. ${product.data.fullDescription} ${product.data.inStock ? "You can ask me to add it to your cart." : "It is out of stock and cannot be added to your cart."}`
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
        ? "Nie udało się uzyskać odpowiedzi. Twoja wiadomość pozostała w rozmowie; spróbuj ponownie."
        : "The assistant could not respond. Your message is saved; please try again.";
    },
  });
}
