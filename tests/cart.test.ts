import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyCart,
  restoreCart,
  setQuantity,
  cartTotalCents,
  addToCart,
} from "../src/domain/cart/cart";
import { products } from "../src/data/products";
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
