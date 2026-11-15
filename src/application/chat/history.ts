import { z } from "zod";
import type { ChatMessage } from "@/types/shop";
import { getStorePolicy } from "@/domain/catalog/policies";
import { products } from "@/data/products";
import { cartActionSchema } from "./cart-action";
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
      products: z.array(z.object({ id: z.string() })).max(3),
      missingIds: z.array(z.string()).max(3),
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
    .slice(-24);
  while (
    result.length > 1 &&
    (result[0].role !== "user" ||
      new TextEncoder().encode(JSON.stringify(result)).length > 80000)
  )
    result = result.slice(1);
  // Send identities rather than duplicate full metadata. The server hydrates current catalog facts.
  return result.map((message) => ({
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
}
