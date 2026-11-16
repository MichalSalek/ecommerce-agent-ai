import { z } from "zod";
import type { ChatMessage } from "@/types/shop";
import { getStorePolicy } from "@/domain/catalog/policies";
import { products } from "@/data/products";
import { cartActionSchema } from "./cart-action";
import {
  checkpointSchema,
  searchEvidenceSchema,
  categoryCardsSchema,
  categoryCards,
  comparisonSchema,
  comparison,
  turnStatusSchema,
  chatMetadataSchema,
  operationSchema,
  adviceSchema,
} from "./shopping-v3";
import { assistantTextError } from "./assistant-text";
import {
  comparisonSummary,
  searchSummary,
  detailsSummary,
} from "./operation-summary";
import {
  searchInput,
  detailsInput,
  policyInput,
  compareInput,
} from "./tool-inputs";
export const CHAT_STORAGE_KEY = "aurelle.conversation.v1";
export const WELCOME_ID = "aurelle-welcome";
export function welcomeMessage(): ChatMessage {
  return {
    id: WELCOME_ID,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Welcome to Aurelle. What can I help you find today? Tell me what you have in mind, or try one of the ideas below.",
      },
    ],
  };
}
const textPart = z.object({
  type: z.literal("text"),
  text: z.string().max(12000),
});
const callFields = {
  toolCallId: z.string().min(1).max(150),
  state: z.literal("output-available"),
};
const searchPart = z
  .object({
    type: z.literal("tool-searchProducts"),
    ...callFields,
    input: searchInput,
    output: z.union([
      z.array(z.object({ id: z.string() })).max(12),
      z.object({
        products: z.array(z.object({ id: z.string() })).max(12),
        totalMatches: z.number().int().min(0).max(products.length),
        unseenMatches: z.number().int().min(0).max(products.length),
        remainingMatches: z.number().int().min(0).max(products.length),
      }),
    ]),
  })
  .transform((part) => ({
    ...part,
    output: Array.isArray(part.output)
      ? part.output.flatMap((item) => {
          const product = products.find((p) => p.id === item.id);
          return product ? [product] : [];
        })
      : {
          ...part.output,
          products: part.output.products.flatMap((item) =>
            products.filter((p) => p.id === item.id),
          ),
        },
  }));
const detailPart = z
  .object({
    type: z.literal("tool-getProductDetails"),
    ...callFields,
    input: detailsInput,
    output: z.union([
      z.object({ id: z.string() }),
      z.object({ error: z.string().max(500) }),
    ]),
  })
  .transform((part) => ({
    ...part,
    output:
      "id" in part.output
        ? (products.find(
            (p) => p.id === ("id" in part.output ? part.output.id : ""),
          ) ?? {
            error: "Product not found.",
          })
        : part.output,
  }));
const policyPart = z
  .object({
    type: z.literal("tool-getPolicy"),
    ...callFields,
    input: policyInput,
    output: z.string().max(2000),
  })
  .transform((part) => ({ ...part, output: getStorePolicy(part.input.topic) }));
const categoriesPart = z
  .object({
    type: z.literal("tool-getCategories"),
    ...callFields,
    input: z.object({}),
    output: z.array(z.string().max(80)).max(30),
  })
  .transform((part) => ({
    ...part,
    output: [...new Set(products.map((p) => p.category))].sort(),
  }));
const comparisonPart = z
  .object({
    type: z.literal("tool-compareProducts"),
    ...callFields,
    input: compareInput,
    output: z.object({
      products: z.array(z.object({ id: z.string() })).max(10),
      missingIds: z.array(z.string()).max(10),
    }),
  })
  .transform((part) => ({
    ...part,
    output: {
      products: part.output.products.flatMap((value) => {
        const product = products.find((p) => p.id === value.id);
        return product ? [product] : [];
      }),
      missingIds: part.output.missingIds,
    },
  }));
const partSchema = z.union([
  z.object({
    type: z.literal("data-operation"),
    id: z.string().optional(),
    data: operationSchema,
  }),
  z.object({
    type: z.literal("data-advice"),
    id: z.string().optional(),
    data: adviceSchema,
  }),
  z.object({
    type: z.literal("data-shoppingState"),
    id: z.string().optional(),
    data: checkpointSchema,
  }),
  z
    .object({
      type: z.literal("data-products"),
      id: z.string().optional(),
      data: searchEvidenceSchema,
    })
    .transform((part) => ({
      ...part,
      data: {
        ...part.data,
        products: part.data.products.filter((row) =>
          products.some((p) => p.id === row.id),
        ),
      },
    })),
  z
    .object({
      type: z.literal("data-categories"),
      id: z.string().optional(),
      data: categoryCardsSchema,
    })
    .transform((part) => ({ ...part, data: categoryCards() })),
  z
    .object({
      type: z.literal("data-comparison"),
      id: z.string().optional(),
      data: comparisonSchema,
    })
    .transform((part) => ({
      ...part,
      data: comparison(
        part.data.productIds.filter((id) => products.some((p) => p.id === id)),
      ),
    })),
  z.object({
    type: z.literal("data-turnStatus"),
    id: z.string().optional(),
    data: turnStatusSchema,
  }),
  textPart,
  searchPart,
  detailPart,
  policyPart,
  categoriesPart,
  comparisonPart,
  z.object({
    type: z.literal("data-cartAction"),
    id: z.string().optional(),
    data: cartActionSchema,
  }),
  z.object({
    type: z.literal("tool-getCatalogOverview"),
    ...callFields,
    input: searchInput.partial(),
    output: z.object({
      total: z.number().int().nonnegative().max(products.length),
      categories: z
        .array(
          z.object({ name: z.string(), count: z.number().int().nonnegative() }),
        )
        .max(30),
      types: z
        .array(
          z.object({
            type: z.string(),
            kind: z.string(),
            count: z.number().int().nonnegative(),
          }),
        )
        .max(100),
    }),
  }),
]);
const baseMessage = z.object({
  id: z.string().min(1).max(150),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.unknown()).max(40),
  metadata: chatMetadataSchema.optional(),
});
export interface ConversationSnapshot {
  version: 1;
  id: string;
  messages: ChatMessage[];
  draft: string;
}
export function settledMessages(values: readonly unknown[]): ChatMessage[] {
  const seen = new Set<string>();
  const result: ChatMessage[] = [];
  for (const value of values) {
    const parsed = baseMessage.safeParse(value);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    const parts: ChatMessage["parts"] = [];
    for (const raw of parsed.data.parts) {
      const part = partSchema.safeParse(raw);
      if (
        part.success &&
        (parsed.data.role === "assistant" || part.data.type === "text")
      )
        parts.push(part.data);
    }
    if (parsed.data.role === "assistant" && parsed.data.id !== WELCOME_ID) {
      const hasOperation = parts.some((part) => part.type === "data-operation");
      const failed = parts.some(
        (part) =>
          part.type === "data-turnStatus" && part.data.status !== "complete",
      );
      const compared = parts.find((part) => part.type === "data-comparison");
      const found = parts.find((part) => part.type === "data-products");
      const detailId =
        found?.type === "data-products" &&
        found.data.evidenceKind === "selection" &&
        found.data.products.length === 1
          ? found.data.products[0].id
          : undefined;
      // Old v3 responses could contain verified results plus a failed optional presentation.
      if (!hasOperation && failed && (compared || found)) {
        const state = parts.find((part) => part.type === "data-shoppingState");
        const pl =
          state?.type === "data-shoppingState" &&
          state.data.after.language === "pl";
        const language = pl ? "pl" : "en";
        const summary =
          compared?.type === "data-comparison" &&
          compared.data.productIds.length >= 2
            ? comparisonSummary(compared.data, language)
            : detailId
              ? detailsSummary(detailId, language)
              : found?.type === "data-products"
                ? searchSummary(found.data, language)
                : pl
                  ? "Nie można odtworzyć porównania produktów."
                  : "The product comparison could not be restored.";
        const keep = parts.filter(
          (part) => part.type !== "text" && part.type !== "data-turnStatus",
        );
        parts.splice(
          0,
          parts.length,
          { type: "text", text: summary },
          ...keep,
          {
            type: "data-operation",
            data: {
              id: `legacy:${parsed.data.id}`,
              kind: compared ? "comparison" : detailId ? "details" : "search",
              status: "completed",
            },
          },
          { type: "data-turnStatus", data: { status: "complete" } },
        );
      } else {
        for (let i = parts.length - 1; i >= 0; i--) {
          const part = parts[i];
          // Legacy replies can exceed the new advice limit. Check their ending separately.
          if (
            part.type === "text" &&
            assistantTextError(
              part.text.length > 400 ? part.text.slice(-400) : part.text,
            )
          )
            parts.splice(i, 1);
          if (
            part.type === "data-advice" &&
            part.data.status === "included" &&
            assistantTextError(part.data.text)
          )
            parts.splice(i, 1);
        }
      }
    }
    if (!parts.length) continue;
    seen.add(parsed.data.id);
    result.push({ ...parsed.data, parts });
  }
  return result.slice(-60);
}
export function restoreConversation(
  raw: string | null,
): ConversationSnapshot | undefined {
  if (!raw || raw.length > 600000) return undefined;
  try {
    const snapshot = z
      .object({
        version: z.literal(1),
        id: z.string().min(1).max(150),
        messages: z.array(z.unknown()).max(60),
        draft: z.string().max(2000),
      })
      .parse(JSON.parse(raw));
    const messages = settledMessages(snapshot.messages);
    return {
      ...snapshot,
      messages: messages.length ? messages : [welcomeMessage()],
    };
  } catch {
    return undefined;
  }
}
export function requestMessages(messages: ChatMessage[]): ChatMessage[] {
  let result = settledMessages(messages)
    .filter((m) => m.id !== WELCOME_ID)
    .slice(-60);
  // Send identities rather than duplicate full metadata. The server hydrates current catalog facts.
  result = result.map((message) => ({
    ...message,
    parts: message.parts
      .filter((p) => p.type !== "data-cartAction")
      .map((part) => {
        if (
          part.type.startsWith("tool-") &&
          "output" in part &&
          part.state === "output-available"
        ) {
          const output = part.output;
          if (Array.isArray(output) && part.type === "tool-searchProducts")
            return { ...part, output: output.map((p) => ({ id: p.id })) };
          if (
            output &&
            typeof output === "object" &&
            "products" in output &&
            Array.isArray(output.products)
          )
            return {
              ...part,
              output: {
                ...output,
                products: output.products.map((p) => ({ id: p.id })),
              },
            };
        }
        return part;
      }),
  })) as ChatMessage[];
  while (
    result.length > 1 &&
    (result[0].role !== "user" ||
      new TextEncoder().encode(JSON.stringify(result)).length > 80000)
  )
    result = result.slice(1);
  return result;
}
