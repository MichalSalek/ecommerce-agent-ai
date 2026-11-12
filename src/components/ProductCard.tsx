import Link from "next/link";
import Image from "next/image";
import type { Product } from "@/domain/catalog/product";
import { AddToCart } from "./AddToCart";
import { formatPrice } from "@/lib/money";
export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="product" id={product.id}>
      <Link
        className="product-image"
        aria-label={`View ${product.name}`}
        href={product.productUrl}
      >
        <Image
          src={product.imageUrl}
          alt={product.name}
          width={480}
          height={480}
          sizes="(max-width: 700px) 50vw, 30vw"
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
