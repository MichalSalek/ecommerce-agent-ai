"use client";
import { useState } from "react";
import { products } from "@/data/products";
import { ProductCard } from "./ProductCard";
export function Catalog() {
  const [category, setCategory] = useState("All products");
  const [query, setQuery] = useState("");
  const visible = products.filter(
    (p) =>
      (category === "All products" || p.category === category) &&
      `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section id="collection" aria-label="Product collection">
      <div className="catalog-toolbar">
        <div>
          <h2>The collection</h2>
          <p className="muted">{visible.length} considered essentials</p>
        </div>
        <div className="catalog-filters">
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {[
                "All products",
                ...new Set(products.map((p) => p.category)),
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Search
            <input
              type="search"
              placeholder="Search products"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="grid">
        {visible.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
      {!visible.length && (
        <p>No products match. Try another search or category.</p>
      )}
    </section>
  );
}
