import JSON5 from "json5";
import { z } from "zod";
import {
  searchInput,
  detailsInput,
  policyInput,
  compareInput,
} from "@/application/chat/tools";
export const actionSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("searchProducts"), input: searchInput }),
  z.object({ tool: z.literal("getProductDetails"), input: detailsInput }),
  z.object({ tool: z.literal("getPolicy"), input: policyInput }),
  z.object({ tool: z.literal("compareProducts"), input: compareInput }),
  z.object({ tool: z.literal("getCategories"), input: z.object({}) }),
  z.object({
    tool: z.literal("getCatalogOverview"),
    input: searchInput.partial(),
  }),
  z.object({
    tool: z.literal("addToCart"),
    input: z.object({
      productId: z.string().max(100),
      quantity: z.number().int().min(1).max(99).default(1),
    }),
  }),
  z.object({
    tool: z.literal("respond"),
    input: z.object({ message: z.string().min(1).max(800) }),
  }),
  z.object({ tool: z.literal("refuse"), input: z.object({}) }),
]);
export type ShopAction = z.infer<typeof actionSchema>;
export const selectionInstruction = `Interpret the latest request and return ONE validated JSON action. Do not write an answer or inventory claims.
Product action shape: {"tool":"searchProducts","input":{"query":"outdoor seating","productKind":"furniture","useEnvironment":"outdoor","maxPrice":150,"limit":2}}.
searchProducts input: query (short positive English embedding query or empty to structurally browse), category, productKind, productType (one string), productTypes (list of allowed canonical types), useEnvironment indoor|outdoor|both, excludeTypes:string[], requiredFeatures:string[], maxPrice or targetPrice, inStockOnly, newSearch:boolean, limit:2. All optional except query.
Keep user constraints through refinements, preserving outdoor use when furniture is requested after garden. A true topic change (headphones after garden) sets newSearch:true and removes unrelated restrictions. "Garden" as a use context does not mean category Garden. Explicit category plus conflicting kind must remain conflicting. Furniture includes tables/chairs/benches/shelves, never planters. Put negated types in excludeTypes, never in positive vector query. Use an empty query only when structural filters cover the full need. For a purpose such as sitting, use productTypes:["chair","bench","lounger","sofa","stool"] together with productKind:furniture; a table is not seating. For other purposes combine only supported canonical types with positive semantic query if needed. Never drop a stated use or requirement. Clear product needs MUST search now, not ask a preliminary question. Use canonical names. Unavailable requested types such as grill get productType:"grill", never a loose semantic substitute. Exact required attributes not confirmed by catalog must produce no results; put explicit requirements in requiredFeatures using concise English terms. Never silently relax requirements.
Assortment overview: {"tool":"getCatalogOverview","input":{"useEnvironment":"outdoor"}}. This tool computes available types/counts. Categories: {"tool":"getCategories","input":{}}.
Compare: {"tool":"compareProducts","input":{"productIds":["mugs","carafe"]}}. Details: {"tool":"getProductDetails","input":{"productId":"mugs"}}. Use only known product IDs, and ask clarification if reference is ambiguous.
Policies: {"tool":"getPolicy","input":{"topic":"delivery"}}.
Unrelated request: {"tool":"refuse","input":{}}. Genuine unclear request: {"tool":"respond","input":{"message":"Clarification only"}}. Never use respond for product or assortment facts.
Cart: {"tool":"addToCart","input":{"productId":"mugs","quantity":2}} only after explicit add/take command with unambiguous canonical reference. No purchase, checkout, payment or order tool exists.
For complex wording, typos and negations interpret intent generally, translating Polish to English concepts. Do not imitate a canned example response. Return one JSON object only.`;
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
