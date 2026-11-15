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
    const rawCart = JSON.parse(raw ?? "null");
    const parsed = cartSchema
      .pick({ version: true, lines: true })
      .parse(rawCart);
    const operations: string[] = Array.isArray(rawCart.executedOperations)
      ? rawCart.executedOperations.filter(
          (id: unknown): id is string =>
            typeof id === "string" && id.length > 0 && id.length <= 200,
        )
      : [];
    const receiptSchema = cartActionSchema.extend({
      conversationId: z.string().min(1).max(150),
    });
    const legacyReceiptSchema = receiptSchema.omit({ items: true });
    const receipts: Cart["receipts"] = Array.isArray(rawCart.receipts)
      ? rawCart.receipts.flatMap((receipt: unknown) => {
          const result = receiptSchema.safeParse(receipt);
          if (result.success) return [result.data];
          const legacy = legacyReceiptSchema.safeParse(receipt);
          return legacy.success ? [legacy.data] : [];
        })
      : [];
    const seen = new Set<string>();
    return {
      version: 1,
      executedOperations: [...new Set(operations)],
      receipts: receipts.filter((receipt) =>
        operations.includes(receipt.operationId),
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

export type CartItem = { productId: string; quantity: number };

export function addItemsToCart(
  cart: Cart,
  items: readonly CartItem[],
  catalog: readonly Product[],
  operationId?: string,
): CartAddResult {
  if (operationId && cart.executedOperations.includes(operationId))
    return { status: "duplicate", cart };
  if (items.length < 1 || items.length > 10) return { status: "limit", cart };
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.productId)) return { status: "limit", cart };
    seen.add(item.productId);
    const product = catalog.find((p) => p.id === item.productId);
    if (!product?.inStock) return { status: "unavailable", cart };
    const current =
      cart.lines.find((line) => line.productId === item.productId)?.quantity ??
      0;
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 99 ||
      current + item.quantity > 99
    )
      return { status: "limit", cart };
  }
  const newLines = items.filter(
    (item) => !cart.lines.some((line) => line.productId === item.productId),
  ).length;
  if (cart.lines.length + newLines > 100) return { status: "limit", cart };
  const quantities = new Map(
    items.map((item) => [item.productId, item.quantity]),
  );
  const lines = cart.lines.map((line) => ({
    ...line,
    quantity: line.quantity + (quantities.get(line.productId) ?? 0),
  }));
  for (const item of items) {
    if (!cart.lines.some((line) => line.productId === item.productId))
      lines.push({ ...item });
  }
  return {
    status: "added",
    cart: {
      ...cart,
      lines,
      executedOperations: operationId
        ? [...cart.executedOperations, operationId]
        : cart.executedOperations,
    },
  };
}

export function addToCart(
  cart: Cart,
  id: string,
  quantity: number,
  catalog: readonly Product[],
  operationId?: string,
): CartAddResult {
  return addItemsToCart(
    cart,
    [{ productId: id, quantity }],
    catalog,
    operationId,
  );
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
