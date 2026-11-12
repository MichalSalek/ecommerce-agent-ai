"use client";
import { useState } from "react";
import Image from "next/image";
import type { Product } from "@/types/shop";
export function ProductCard({ product }: { product: Product }) {
  const [added, setAdded] = useState(false);
  return (
    <article className="product" id={product.id}>
      <a href={product.productUrl} aria-label={product.name}>
        <Image
          src={product.imageUrl}
          alt={product.name}
          width={480}
          height={480}
        />
      </a>
      <div className="product-info">
        <small>{product.category}</small>
        <h3>{product.name}</h3>
        <p>{product.description}</p>
        <div className="product-bottom">
          <strong>
            {new Intl.NumberFormat("en-IE", {
              style: "currency",
              currency: product.currency,
            }).format(product.price)}
          </strong>
          <button
            disabled={!product.inStock}
            onClick={() => {
              console.log("[CART] added product:", product.id);
              setAdded(true);
            }}
          >
            {product.inStock ? "Add to cart" : "Out of stock"}
          </button>
        </div>
        <span className="notice" role="status">
          {added ? "Added in demo - no order placed." : ""}
        </span>
      </div>
    </article>
  );
}
