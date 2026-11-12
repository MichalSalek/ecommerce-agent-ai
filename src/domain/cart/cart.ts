import { z } from "zod";
import type { Product } from "@/domain/catalog/product";
export const cartSchema = z.object({
  version: z.literal(1),
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
export const emptyCart = (): Cart => ({ version: 1, lines: [] });
export function restoreCart(
  raw: string | null,
  catalog: readonly Product[],
): Cart {
  try {
    const parsed = cartSchema.parse(JSON.parse(raw ?? "null"));
    const seen = new Set<string>();
    return {
      version: 1,
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
    version: 1,
    lines: cart.lines.some((l) => l.productId === id)
      ? cart.lines.map((l) => (l.productId === id ? next : l))
      : [...cart.lines, next],
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
