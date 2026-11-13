import Link from "next/link";
import { StoreImage } from "@/components/StoreImage";
import type { Product } from "@/domain/catalog/product";
import { AddToCart } from "./AddToCart";
import { formatPrice } from "@/lib/money";
export function ProductCard({
  product,
  compact = false,
}: {
  product: Product;
  compact?: boolean;
}) {
  return (
    <article
      className={compact ? "product compact" : "product"}
      id={compact ? undefined : product.id}
    >
      <Link
        className="product-image"
        aria-label={`View ${product.name}`}
        href={product.productUrl}
      >
        <StoreImage
          src={product.imageUrl}
          alt={product.name}
          width={480}
          height={480}
          sizes={compact ? "112px" : "(max-width: 700px) 50vw, 30vw"}
          loading={compact ? "eager" : undefined}
        />
      </Link>
      <div className="product-info">
        <small>{product.category}</small>
        <h3>
          <Link href={product.productUrl}>{product.name}</Link>
        </h3>
        <p>{product.description}</p>
        <div className="product-bottom">
          <strong>{formatPrice(product.price)}</strong>
          <AddToCart product={product} />
        </div>
      </div>
    </article>
  );
}
