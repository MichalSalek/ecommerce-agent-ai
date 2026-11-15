import { z } from "zod";

export const cartActionSchema = z.object({
  operationId: z.string().min(1).max(200),
  userMessageId: z.string().min(1).max(150),
  productId: z.string().min(1).max(150),
  quantity: z.number().int().min(1).max(99),
});
export type CartAction = z.infer<typeof cartActionSchema>;
