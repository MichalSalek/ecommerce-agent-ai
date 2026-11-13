"use client";
import { StoreImage } from "@/components/StoreImage";
import Link from "next/link";
import { useCart } from "@/components/CartProvider";
import { products } from "@/data/products";
import { cartTotalCents } from "@/domain/cart/cart";
import { formatPrice } from "@/lib/money";
export default function CartPage() {
  const { cart, ready, storageError, update } = useCart();
  const total = cartTotalCents(cart, products) / 100;
  return (
    <>
      <div className="page-heading">
        <small>YOUR SELECTION</small>
        <h1>The everyday, collected.</h1>
        <p>Your cart is saved on this device.</p>
      </div>
      {storageError && (
        <p role="alert" className="error">
          Browser storage is unavailable. Your cart will last for this visit
          only.
        </p>
      )}
      {!ready ? (
        <p role="status">Loading your cart…</p>
      ) : !cart.lines.length ? (
        <div className="empty-cart">
          <h2>A little room for good things.</h2>
          <p>Your cart is empty.</p>
          <Link className="button" href="/">
            Explore the collection
          </Link>
        </div>
      ) : (
        <div className="cart-layout">
          <div className="cart-lines">
            {cart.lines.map((line) => {
              const product = products.find((p) => p.id === line.productId);
              if (!product) return null;
              return (
                <article className="cart-line" key={line.productId}>
                  <Link href={product.productUrl}>
                    <StoreImage
                      src={product.imageUrl}
                      alt={product.name}
                      width={140}
                      height={140}
                    />
                  </Link>
                  <div>
                    <small>{product.category}</small>
                    <h2>
                      <Link href={product.productUrl}>{product.name}</Link>
                    </h2>
                    <p>{formatPrice(product.price)} each</p>
                    {!product.inStock && (
                      <p className="error">Currently out of stock</p>
                    )}
                    <label className="quantity-label">
                      Quantity
                      <input
                        aria-label={`Quantity for ${product.name}`}
                        type="number"
                        min="1"
                        max="99"
                        value={line.quantity}
                        disabled={!product.inStock}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (n >= 1 && n <= 99) update(product.id, n);
                        }}
                      />
                    </label>
                    <button
                      className="text-button"
                      onClick={() => update(product.id, 0)}
                    >
                      Remove {product.name}
                    </button>
                  </div>
                  <strong>{formatPrice(product.price * line.quantity)}</strong>
                </article>
              );
            })}
          </div>
          <aside className="cart-summary">
            <small>YOUR CART</small>
            <h2>Order summary</h2>
            <p className="summary-row">
              <span>Items</span>
              <strong>{formatPrice(total)}</strong>
            </p>
            <p className="summary-row">
              <span>Demo delivery</span>
              <strong>{formatPrice(4)}</strong>
            </p>
            <p className="summary-row total">
              <span>Total</span>
              <strong>{formatPrice(total + 4)}</strong>
            </p>
            <p>This is a demo cart. Checkout and payments are not available.</p>
            <Link className="button" href="/">
              Continue shopping
            </Link>
          </aside>
        </div>
      )}
    </>
  );
}
