"use client";
import { useState } from "react";
import type { Product } from "@/domain/catalog/product";
import { useCart } from "./CartProvider";
export function AddToCart({ product }: { product: Product }) {
  const { add, ready } = useCart();
  const [added, setAdded] = useState(false);
  return (
    <div className="add-control">
      <button
        disabled={!ready || !product.inStock}
        onClick={() => {
          add(product.id);
          setAdded(true);
        }}
      >
        {product.inStock ? "Add to cart" : "Out of stock"}
      </button>
      <span className="notice" role="status">
        {added ? "Added to your cart." : ""}
      </span>
    </div>
  );
}
