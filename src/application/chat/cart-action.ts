import { z } from "zod";

export const cartActionSchema = z.object({
  operationId: z.string().min(1).max(200),
  userMessageId: z.string().min(1).max(150),
  productId: z.string().min(1).max(150),
  quantity: z.number().int().min(1).max(99),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(150),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(10)
    .optional(),
});
export type CartAction = z.infer<typeof cartActionSchema>;
