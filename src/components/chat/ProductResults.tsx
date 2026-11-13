"use client";
import { useState } from "react";
import { productSchema } from "@/domain/catalog/product";
import { products } from "@/data/products";
import { ProductCard } from "@/components/ProductCard";
export function ProductResults({ output }: { output: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const values = Array.isArray(output) ? output : [output];
  const found = values.flatMap((value) => {
    const parsed = productSchema.safeParse(value);
    const current = parsed.success
      ? products.find((p) => p.id === parsed.data.id)
      : undefined;
    return current ? [current] : [];
  });
  if (!found.length) return null;
  return (
    <div className="product-results">
      <div className="result-heading">
        <span>From the collection</span>
        <span>
          {found.length} {found.length === 1 ? "match" : "matches"}
        </span>
      </div>
      <div className="chat-products">
        {(expanded ? found : found.slice(0, 4)).map((product) => (
          <ProductCard compact key={product.id} product={product} />
        ))}
      </div>
      {found.length > 4 && (
        <button
          className="result-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Show fewer products"
            : `Show all ${found.length} products`}
        </button>
      )}
    </div>
  );
}
