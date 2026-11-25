import { tool } from "ai";
import { z } from "zod";
export { agentInstructions, adviceInstructions, detailAnswerInstructions } from "./assistant-instructions";
import { modelCriteriaSchema, modelTransitionSchema, omitNullModelFields } from "./model-search-criteria";
import { explicitFacetNames } from "./explicit-facets";
const explicitFacetSchema = z.object({
  facet: z.enum(explicitFacetNames),
  value: z.string().min(1).max(80),
  userQuote: z.string().max(300).nullish(),
}).transform(omitNullModelFields);
export const answerSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe("Concise advice; cards already show product facts and prices."),
  language: z.enum(["en", "pl"]),
  evidenceIds: z.array(z.string()).max(8),
  productIds: z.array(z.string()).max(10),
  view: z.enum(["none", "products", "categories", "comparison"]),
  claim: z
    .enum([
      "none",
      "no-match",
      "exhausted",
      "no-assortment",
      "unavailable",
      "unconfirmed-feature",
    ])
    .optional(),
});
export type PresentedAnswer = z.infer<typeof answerSchema>;
export const cartProposalSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(10),
  selection: z.enum([
    "named",
    "first",
    "second",
    "cheapest",
    "both",
    "all",
    "selected",
  ]),
});
export const detailAnswerSchema = z.object({
  status: z.enum(["supported", "missing"]),
  answer: z.string().max(400),
  source: z.enum(["description", "dimensions", "material", "features", "limitations", "productType", "useEnvironment"]).optional(),
  quote: z.string().max(500).optional(),
});
export const nativeTools = {
  answerProductQuestion: tool({
    description: "Answer a product question using the supplied canonical record and an exact supporting excerpt, or report that the record does not establish an answer.",
    inputSchema: detailAnswerSchema,
  }),
  getShoppingCapabilities: tool({
    description: "Answer the shopper's question about your role, data access, or ability to perform an action. Address their exact request in the first person. For a general introduction, name a few supported actions. Specific catalog searches use searchProducts.",
    inputSchema: z.object({
      answer: z.string().max(2000).optional().describe("Write one or two short sentences, normally 20–35 words total. Answer this exact question as the store assistant in the shopper's language. Omit unrelated operations and limits."),
    }),
  }),
  searchProducts: tool({
    description:
      "Search and update one shopping transition, or perform an independent lookup.",
    inputSchema: modelTransitionSchema.extend({
      mode: z
        .enum(["recommend", "lookup"])
        .describe(
          "recommend updates active search; lookup reads independent criteria without changing it.",
        ),
      explicitFilters: z
        .array(explicitFacetSchema)
        .max(12)
        .nullish()
        .describe(
          "Use the catalog ID in value and the shopper’s exact words in userQuote. Required material (e.g. ceramic) is a material facet. Category must be an explicitly named department.",
        ),
      rejections: z
        .array(
          z.object({
            productId: z.string(),
            userQuote: z.string().min(1).max(300),
          }),
        )
        .max(10)
        .nullish()
        .describe(
          "Only explicitly rejected products with an exact CURRENT quote.",
        ),
      continueWith: z
        .enum(["presentAnswer", "compareProducts", "getProductDetails"])
        .describe(
          "Next step: present recommendations, compare, or inspect details.",
        ),
    }).transform(omitNullModelFields),
  }),
  getCatalogOverview: tool({
    description:
      "Count the matching assortment without excluding shown products.",
    inputSchema: z.object({
      criteria: modelCriteriaSchema,
      explicitFilters: z.array(explicitFacetSchema).max(12).nullish(),
      useActive: z.boolean().nullish(),
    }).transform(omitNullModelFields),
  }),
  getCategories: tool({
    description: "Read category counts and examples.",
    inputSchema: z.object({}),
  }),
  getProductDetails: tool({
    description: "Read verified details for one product ID.",
    inputSchema: z.object({
      productId: z.string(),
      continueWith: z
        .enum(["presentAnswer", "readMore"])
        .optional()
        .describe(
          "Default: finish after this read. Use readMore only when another distinct read is needed for CURRENT.",
        ),
    }),
  }),
  compareProducts: tool({
    description:
      "Compare 2–10 requested or recently shown product IDs or exact English names; never add extra products.",
    inputSchema: z.object({
      productIds: z.array(z.string()).min(2).max(10),
      continueWith: z
        .enum(["presentAnswer", "readMore"])
        .optional()
        .describe(
          "Default: finish after this comparison. Use readMore only for another distinct requested read.",
        ),
    }),
  }),
  getPolicy: tool({
    description: "Read delivery, returns or payment policy.",
    inputSchema: z.object({ topic: z.string().max(200) }),
  }),
  proposeCart: tool({
    description:
      "Propose adding explicitly requested products using known IDs and units; the device confirms storage.",
    inputSchema: cartProposalSchema,
  }),
  presentAnswer: tool({
    description:
      "Finish with advice, evidence IDs, product IDs and a view. Use [[price:PRODUCT_ID]], [[difference:PRODUCT_ID]], [[dimensions:PRODUCT_ID]], [[amount:cart:totalEUR]] and [[count:EVIDENCE_ID:FIELD]] for numeric facts; claim must match evidence.",
    inputSchema: answerSchema,
  }),
};
