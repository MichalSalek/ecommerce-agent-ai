"use client";
import { products } from "@/data/products";
import { ProductCard } from "@/components/ProductCard";
import type { SearchEvidence } from "@/application/chat/shopping-v3";

const outcomeText: Record<SearchEvidence["outcome"], string> = {
  matches: "",
  "no-match": "No products match these criteria.",
  exhausted: "There are no more matching products to show.",
  unavailable: "Matching products are currently unavailable.",
  "unconfirmed-feature":
    "The requested feature could not be confirmed for these products.",
  "no-assortment": "There are no products in this part of the collection.",
  "invalid-criteria": "These search criteria could not be used.",
};

export function ProductResults({
  output,
  evidence,
}: {
  output: unknown;
  evidence?: SearchEvidence;
}) {
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
  if (!found.length && !evidence) return null;
  const explanation =
    evidence &&
    (outcomeText[evidence.outcome] ||
      (found.length < evidence.requestedCount
        ? `You requested ${evidence.requestedCount} products. ${evidence.remainingMatches > 0 ? "More matching products remain to be shown." : "There are no more matching products available to show."}`
        : ""));
  return (
    <div className="product-results">
      <div className="result-heading">
        <span>From the collection</span>
        <span>
          Showing {found.length} {found.length === 1 ? "product" : "products"}
        </span>
      </div>
      {evidence && (
        <div className="result-counts" aria-label="Search counts">
          <span>In scope: {evidence.scopeTotal}</span>
          <span>Matching: {evidence.totalMatches}</span>
          <span>
            Not yet shown before this result: {evidence.unseenMatches}
          </span>
          <span>Remaining after this result: {evidence.remainingMatches}</span>
        </div>
      )}
      {explanation && <p className="result-explanation">{explanation}</p>}
      <div className="chat-products">
        {found.map((product) => (
          <ProductCard compact key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
