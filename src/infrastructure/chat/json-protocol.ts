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
  z.object({ tool: z.literal("refuse"), input: z.object({}) }),
]);
export const answerSchema = z.object({ text: z.string().min(1) });
export const selectionInstruction = `Select one tool for the LAST customer question. Return only one JSON object using exactly one of these shapes:
- Products: {"tool":"searchProducts","input":{"query":"customer product request","maxPrice":25}}. Query is in English without invented intent. maxPrice is optional, in EUR.
- Known product ID: {"tool":"getProductDetails","input":{"productId":"mugs"}}.
- Delivery/returns/payments: {"tool":"getPolicy","input":{"topic":"delivery"}}. The topic field is REQUIRED, not query.
- Anything unrelated to this store, including programming: {"tool":"refuse","input":{}}.
Do not answer yet or invent products. Do not reuse an earlier question when the customer has changed the topic.`;
export const answerInstruction =
  "Answer the customer question in ENGLISH using only the tool result above. Use ONLY the supplied products and EUR prices, never invent products. If there are no results, say so and ask the customer to refine their request. Return JSON with a text field. Keep it brief and plain text, with no markdown, URLs or price list; the product cards already show prices.";
// Local models may append another object or prose after a valid action.
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; start >= 0 && i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0)
      return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("The model did not return a complete JSON object.");
}
