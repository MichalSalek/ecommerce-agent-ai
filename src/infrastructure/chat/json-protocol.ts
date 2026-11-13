import JSON5 from "json5";
import { z } from "zod";
import {
  searchInput,
  detailsInput,
  policyInput,
} from "@/application/chat/tools";
export const actionSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("searchProducts"), input: searchInput }),
  z.object({ tool: z.literal("getProductDetails"), input: detailsInput }),
  z.object({ tool: z.literal("getPolicy"), input: policyInput }),
  z.object({ tool: z.literal("getCategories"), input: z.object({}) }),
  z.object({
    tool: z.literal("respond"),
    input: z.object({ message: z.string().min(1).max(800) }),
  }),
  z.object({ tool: z.literal("refuse"), input: z.object({}) }),
]);
export type ShopAction = z.infer<typeof actionSchema>;
export const selectionInstruction = `Select one tool for the LAST customer question. Return only one JSON object using exactly one of these shapes:
- Products: {"tool":"searchProducts","input":{"query":"customer product request","maxPrice":25}}. Query is in English without invented intent. maxPrice is optional, in EUR. For approximate budgets use targetPrice instead. Preserve category and exclude already shown IDs for alternatives. Translate semantic query into English for the English encoder. Do not refuse language requests or greetings.
- Greetings, language changes or a clarification (never product facts): {"tool":"respond","input":{"message":"A helpful short reply in the customer language, with a relevant next question"}}.
- Categories: {"tool":"getCategories","input":{}}.
- Known product ID: {"tool":"getProductDetails","input":{"productId":"mugs"}}.
- Delivery/returns/payments: {"tool":"getPolicy","input":{"topic":"delivery"}}. The topic field is REQUIRED, not query.
- Anything unrelated to this store, including programming: {"tool":"refuse","input":{}}.
When the customer expresses a clear product need, searchProducts MUST run now and show two options before any clarifying question. Never use respond to suggest unverified products or merely ask mug vs coffee maker. Do not answer yet or invent products. Do not reuse an earlier question when the customer has changed the topic.`;
// Reasoning-capable servers may leave examples or prose in the content channel.
// Only complete, valid JSON is considered; tool-specific validation remains mandatory.
function jsonObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  for (
    let start = text.indexOf("{");
    start >= 0;
    start = text.indexOf("{", start + 1)
  ) {
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try {
          objects.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* Skip malformed examples. */
        }
        break;
      }
    }
  }
  return objects;
}
export function parseJsonObject(text: string): unknown {
  const objects = jsonObjects(text);
  if (!objects.length)
    throw new Error("The model did not return a complete JSON object.");
  return objects[0];
}
export function parseToolAction(text: string): ShopAction {
  for (const object of jsonObjects(text)) {
    const result = actionSchema.safeParse(object);
    if (result.success) return result.data;
  }
  // Bielik's configured template can emit legacy tool_call dictionaries with single quotes.
  // JSON5 is a data parser, never eval; map only known tool names and validate arguments again.
  for (const match of text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)) {
    try {
      const legacy: unknown = JSON5.parse(match[1]);
      if (
        typeof legacy !== "object" ||
        legacy === null ||
        !("name" in legacy) ||
        !("arguments" in legacy)
      )
        continue;
      const result = actionSchema.safeParse({
        tool: legacy.name,
        input: legacy.arguments,
      });
      if (result.success) return result.data;
    } catch {
      /* Not a supported tool envelope. */
    }
  }
  throw new Error("The model did not return a valid shopping action.");
}
