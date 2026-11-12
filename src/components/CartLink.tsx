"use client";
import Link from "next/link";
import { useCart } from "./CartProvider";
export function CartLink() {
  const { cart, ready } = useCart();
  const count = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <Link href="/cart">
      Cart <span className="cart-count">{ready ? count : 0}</span>
    </Link>
  );
}
