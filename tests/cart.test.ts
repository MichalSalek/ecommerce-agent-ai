import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyCart,
  restoreCart,
  setQuantity,
  cartTotalCents,
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
