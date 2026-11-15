import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyCart,
  restoreCart,
  setQuantity,
  cartTotalCents,
  addToCart,
  addItemsToCart,
} from "../src/domain/cart/cart";
import { products } from "../src/data/products";
import { z } from "zod";
test("cart validates persisted data and uses canonical prices", () => {
  let cart = setQuantity(emptyCart(), "mugs", 2, products);
  cart = setQuantity(cart, "carafe", 1, products);
  assert.equal(cartTotalCents(cart, products), 6300);
  assert.deepEqual(restoreCart(JSON.stringify(cart), products), cart);
  assert.deepEqual(restoreCart("bad JSON", products), emptyCart());
  assert.deepEqual(
    restoreCart(JSON.stringify({ version: 2, lines: [] }), products),
    emptyCart(),
  );
  assert.deepEqual(
    restoreCart(
      JSON.stringify({
        version: 1,
        lines: [
          { productId: "mugs", quantity: 1 },
          { productId: "mugs", quantity: 5 },
          { productId: "missing", quantity: 1 },
        ],
      }),
      products,
    ).lines,
    [{ productId: "mugs", quantity: 1 }],
  );
  assert.equal(setQuantity(cart, "mugs", 1000, products).lines[0].quantity, 99);
  assert.equal(
    setQuantity(cart, "compact-keyboard", 1, products).lines.length,
    2,
  );
  assert.equal(setQuantity(cart, "mugs", 0, products).lines.length, 1);
  assert.equal(setQuantity(cart, "missing", 2, products), cart);
});
test("chat additions persist their operation and reject replay, unavailable stock and overflow", () => {
  const legacy = restoreCart(
    JSON.stringify({
      version: 1,
      lines: [{ productId: "mugs", quantity: 97 }],
    }),
    products,
  );
  assert.deepEqual(legacy.executedOperations, []);
  const added = addToCart(legacy, "mugs", 2, products, "conversation:user-1");
  assert.equal(added.status, "added");
  assert.equal(added.cart.lines[0].quantity, 99);
  const restored = restoreCart(JSON.stringify(added.cart), products);
  assert.equal(
    addToCart(restored, "mugs", 2, products, "conversation:user-1").status,
    "duplicate",
  );
  assert.equal(
    addToCart(restored, "mugs", 1, products, "conversation:user-2").status,
    "limit",
  );
  assert.equal(
    addToCart(restored, "compact-keyboard", 1, products, "conversation:user-3")
      .status,
    "unavailable",
  );
  assert.deepEqual(restored.executedOperations, ["conversation:user-1"]);
});

test("multi-item additions are atomic and persist their replay ledger and compatible receipt", () => {
  const cart = setQuantity(emptyCart(), "mugs", 97, products);
  const items = [
    { productId: "mugs", quantity: 2 },
    { productId: "carafe", quantity: 3 },
  ];
  const result = addItemsToCart(cart, items, products, "conversation:user-4");
  assert.equal(result.status, "added");
  assert.deepEqual(result.cart.lines, [
    { productId: "mugs", quantity: 99 },
    { productId: "carafe", quantity: 3 },
  ]);
  assert.deepEqual(cart.lines, [{ productId: "mugs", quantity: 97 }]);
  const receipt = {
    operationId: "conversation:user-4",
    userMessageId: "user-4",
    conversationId: "conversation",
    productId: "mugs",
    quantity: 2,
    items,
  };
  const stored = JSON.stringify({ ...result.cart, receipts: [receipt] });
  const restored = restoreCart(stored, products);
  assert.deepEqual(restored.receipts, [receipt]);
  assert.equal(
    addItemsToCart(restored, items, products, receipt.operationId).status,
    "duplicate",
  );
  const oldReceiptSchema = z.object({
    operationId: z.string(),
    userMessageId: z.string(),
    conversationId: z.string(),
    productId: z.string(),
    quantity: z.number(),
  });
  assert.deepEqual(oldReceiptSchema.parse(JSON.parse(stored).receipts[0]), {
    operationId: receipt.operationId,
    userMessageId: receipt.userMessageId,
    conversationId: receipt.conversationId,
    productId: receipt.productId,
    quantity: receipt.quantity,
  });
});

test("invalid multi-item additions never change cart or ledger", () => {
  const cart = setQuantity(emptyCart(), "mugs", 98, products);
  const valid = { productId: "carafe", quantity: 1 };
  for (const [items, status] of [
    [[valid, { productId: "mugs", quantity: 2 }], "limit"],
    [[valid, { productId: "compact-keyboard", quantity: 1 }], "unavailable"],
    [[valid, { productId: "missing", quantity: 1 }], "unavailable"],
    [[valid, { productId: "mugs", quantity: 0 }], "limit"],
    [[valid, { productId: "mugs", quantity: 1.5 }], "limit"],
    [[valid, valid], "limit"],
    [[], "limit"],
    [
      Array.from({ length: 11 }, (_, i) => ({
        productId: `id-${i}`,
        quantity: 1,
      })),
      "limit",
    ],
  ] as const) {
    const result = addItemsToCart(cart, items, products, "operation");
    assert.equal(result.status, status);
    assert.equal(result.cart, cart);
    assert.deepEqual(cart.executedOperations, []);
    assert.deepEqual(cart.lines, [{ productId: "mugs", quantity: 98 }]);
  }
});

test("malformed receipt extensions do not discard valid cart data or replay protection", () => {
  const legacyReceipt = {
    operationId: "op",
    userMessageId: "message",
    conversationId: "conversation",
    productId: "mugs",
    quantity: 1,
  };
  const restored = restoreCart(
    JSON.stringify({
      version: 1,
      lines: [{ productId: "mugs", quantity: 1 }],
      executedOperations: ["op"],
      receipts: [{ ...legacyReceipt, items: "future-format" }, { bad: true }],
    }),
    products,
  );
  assert.deepEqual(restored.lines, [{ productId: "mugs", quantity: 1 }]);
  assert.deepEqual(restored.executedOperations, ["op"]);
  assert.deepEqual(restored.receipts, [legacyReceipt]);
  assert.equal(
    addToCart(restored, "mugs", 1, products, "op").status,
    "duplicate",
  );
});
