"use client";
import { useState } from "react";
import type { Product } from "@/domain/catalog/product";
import { useCart, type ActionResult } from "./CartProvider";
export function AddToCart({ product }: { product: Product }) {
  const { add, ready } = useCart();
  const [result, setResult] = useState<ActionResult>();
  return (
    <div className="add-control">
      <button
        disabled={!ready || !product.inStock}
        onClick={() => {
          setResult(add(product.id));
        }}
      >
        {product.inStock ? "Add to cart" : "Out of stock"}
      </button>
      <span className="notice" role="status">
        {result === "added"
          ? "Added to your cart."
          : result === "limit"
            ? "The cart cannot hold more than 99 of this item."
            : result === "storage-error"
              ? "The cart could not be saved. Please try again."
              : result === "unavailable"
                ? "This item is unavailable."
                : ""}
      </span>
    </div>
  );
}
