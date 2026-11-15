"use client";
import { useState } from "react";
import { products } from "@/data/products";
import { ProductCard } from "@/components/ProductCard";
export function ProductResults({ output }: { output: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const envelope =
    typeof output === "object" &&
    output !== null &&
    "products" in output &&
    Array.isArray(output.products)
      ? output
      : null;
  const values: unknown[] =
    envelope && Array.isArray(envelope.products)
      ? envelope.products
      : Array.isArray(output)
        ? output
        : [output];
  const found = values.flatMap((value) => {
    const id =
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      typeof value.id === "string"
        ? value.id
        : undefined;
    const current = products.find((p) => p.id === id);
    return current ? [current] : [];
  });
  if (!found.length) return null;
  return (
    <div className="product-results">
      <div className="result-heading">
        <span>From the collection</span>
        <span>
          Showing {found.length} {found.length === 1 ? "product" : "products"}
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
