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
            {new Intl.NumberFormat("pl-PL", {
              style: "currency",
              currency: "PLN",
            }).format(product.price)}
          </strong>
          <button
            disabled={!product.inStock}
            onClick={() => {
              console.log("[CART] dodano produkt:", product.id);
              setAdded(true);
            }}
          >
            {product.inStock ? "Dodaj do koszyka" : "Niedostępny"}
          </button>
        </div>
        <span className="notice" role="status">
          {added ? "Dodano w demo — bez zamówienia." : ""}
        </span>
      </div>
    </article>
  );
}
