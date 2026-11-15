import Link from "next/link";
import { products } from "@/data/products";
import { formatPrice } from "@/lib/money";
import type { Comparison } from "@/application/chat/shopping-v3";

export function ComparisonResults({ comparison }: { comparison: Comparison }) {
  return (
    <div className="comparison-results" aria-label="Product comparison">
      {comparison.productIds.map((id) => {
        const product = products.find((item) => item.id === id);
        const difference = comparison.differencesCents.find(
          (item) => item.productId === id,
        );
        if (!product) return null;
        return (
          <article className="comparison-product" key={id}>
            <h3>
              <Link href={product.productUrl}>{product.name}</Link>
            </h3>
            <p>
              <strong>{formatPrice(product.price)}</strong>
              {comparison.cheapestIds.includes(id)
                ? " (lowest price)"
                : difference
                  ? ` (${formatPrice(difference.cents / 100)} more than the lowest price)`
                  : ""}
            </p>
            <dl>
              <div>
                <dt>Category</dt>
                <dd>{product.category}</dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd>{product.inStock ? "In stock" : "Out of stock"}</dd>
              </div>
              <div>
                <dt>Material</dt>
                <dd>{product.material}</dd>
              </div>
              <div>
                <dt>Dimensions</dt>
                <dd>{product.dimensions}</dd>
              </div>
              <div>
                <dt>Features</dt>
                <dd>{product.features.join(", ") || "Not specified"}</dd>
              </div>
              {product.limitations.length > 0 && (
                <div>
                  <dt>Limitations</dt>
                  <dd>{product.limitations.join(", ")}</dd>
                </div>
              )}
            </dl>
          </article>
        );
      })}
    </div>
  );
}
