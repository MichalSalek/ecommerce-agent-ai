import { z } from "zod";
import type { Product } from "@/domain/catalog/product";
import { cartActionSchema } from "@/application/chat/cart-action";
export const cartSchema = z.object({
  version: z.literal(1),
  executedOperations: z.array(z.string().min(1).max(200)).default([]),
  receipts: z
    .array(
      cartActionSchema.extend({ conversationId: z.string().min(1).max(150) }),
    )
    .default([]),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .max(100),
});
export type Cart = z.infer<typeof cartSchema>;
export const emptyCart = (): Cart => ({
  version: 1,
  lines: [],
  executedOperations: [],
  receipts: [],
});
export function restoreCart(
  raw: string | null,
  catalog: readonly Product[],
): Cart {
  try {
    const parsed = cartSchema.parse(JSON.parse(raw ?? "null"));
    const seen = new Set<string>();
    return {
      version: 1,
      executedOperations: [...new Set(parsed.executedOperations)],
      receipts: parsed.receipts.filter((receipt) =>
        parsed.executedOperations.includes(receipt.operationId),
      ),
      lines: parsed.lines.filter((line) => {
        if (
          seen.has(line.productId) ||
          !catalog.some((p) => p.id === line.productId)
        )
          return false;
        seen.add(line.productId);
        return true;
      }),
    };
  } catch {
    return emptyCart();
  }
}
export function setQuantity(
  cart: Cart,
  id: string,
  quantity: number,
  catalog: readonly Product[],
): Cart {
  const product = catalog.find((p) => p.id === id);
  if (!product || !Number.isInteger(quantity)) return cart;
  if (quantity <= 0)
    return { ...cart, lines: cart.lines.filter((l) => l.productId !== id) };
  if (!product.inStock) return cart;
  const next = { productId: id, quantity: Math.min(quantity, 99) };
  return {
    ...cart,
    lines: cart.lines.some((l) => l.productId === id)
      ? cart.lines.map((l) => (l.productId === id ? next : l))
      : [...cart.lines, next],
  };
}
export type CartAddResult =
  | { status: "added"; cart: Cart }
  | { status: "duplicate" | "unavailable" | "limit"; cart: Cart };

export function addToCart(
  cart: Cart,
  id: string,
  quantity: number,
  catalog: readonly Product[],
  operationId?: string,
): CartAddResult {
  if (operationId && cart.executedOperations.includes(operationId))
    return { status: "duplicate", cart };
  const product = catalog.find((p) => p.id === id);
  if (!product?.inStock) return { status: "unavailable", cart };
  const current =
    cart.lines.find((line) => line.productId === id)?.quantity ?? 0;
  if (!Number.isInteger(quantity) || quantity < 1 || current + quantity > 99)
    return { status: "limit", cart };
  const next = setQuantity(cart, id, current + quantity, catalog);
  return {
    status: "added",
    cart: operationId
      ? {
          ...next,
          executedOperations: [...next.executedOperations, operationId],
        }
      : next,
  };
}
export function cartTotalCents(
  cart: Cart,
  catalog: readonly Product[],
): number {
  return cart.lines.reduce(
    (sum, line) =>
      sum +
      Math.round(
        (catalog.find((p) => p.id === line.productId)?.price ?? 0) * 100,
      ) *
        line.quantity,
    0,
  );
}
