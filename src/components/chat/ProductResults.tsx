"use client";
import { catalogById } from "@/data/products";
import { ProductCard } from "@/components/ProductCard";
import type { SearchEvidence } from "@/application/chat/shopping-v3";
import { emptySearchSummary } from "@/application/chat/operation-summary";
import type { Language } from "@/application/chat/assistant-text";

export function ProductResults({
  output,
  evidence,
  language = "en",
  summaryVisible = false,
}: {
  output: unknown;
  evidence?: SearchEvidence;
  language?: Language;
  summaryVisible?: boolean;
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
    const current = id ? catalogById.get(id) : undefined;
    return current ? [current] : [];
  });
  if (!found.length) {
    if (summaryVisible || !evidence || evidence.evidenceKind === "selection") return null;
    return <p className="result-explanation">{emptySearchSummary(evidence.outcome, language)}</p>;
  }
  const searchEvidence =
    evidence?.evidenceKind === "selection" ? undefined : evidence;
  const explanation =
    searchEvidence &&
    (found.length < searchEvidence.requestedCount
      ? `${searchEvidence.requestedCount >= 1000 ? "Showing a batch from the matching collection." : `You requested ${searchEvidence.requestedCount} products.`} ${searchEvidence.remainingMatches > 0 ? "More matching products remain to be shown." : "There are no more matching products available to show."}`
      : "");
  return (
    <div className="product-results">
      <div className="result-heading">
        <span>From the collection</span>
        <span>
          Showing {found.length} {found.length === 1 ? "product" : "products"}
        </span>
      </div>
      {searchEvidence && (
        <div className="result-counts" aria-label="Search counts">
          <span>In scope: {searchEvidence.scopeTotal}</span>
          <span>Matching: {searchEvidence.totalMatches}</span>
          <span>
            Not yet shown before this result: {searchEvidence.unseenMatches}
          </span>
          <span>
            Remaining after this result: {searchEvidence.remainingMatches}
          </span>
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
