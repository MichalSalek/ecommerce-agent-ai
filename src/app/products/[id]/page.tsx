import { StoreImage } from "@/components/StoreImage";
import Link from "next/link";
import { notFound } from "next/navigation";
import { catalogById, products } from "@/data/products";
import { AddToCart } from "@/components/AddToCart";
import { ProductCard } from "@/components/ProductCard";
import { storePolicy } from "@/domain/catalog/policies";
import { formatPrice } from "@/lib/money";
export function generateStaticParams() {
  return products.map((p) => ({ id: p.id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return {
    title: `${catalogById.get(id)?.name ?? "Product not found"} - Aurelle`,
  };
}
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = catalogById.get(id);
  if (!product) notFound();
  const related = products
    .filter((p) => p.category === product.category && p.id !== id)
    .slice(0, 3);
  return (
    <>
      <Link className="back-link" href="/">
        ← All products
      </Link>
      <section className="product-detail">
        <StoreImage
          className="detail-image"
          src={product.imageUrl}
          alt={product.name}
          width={800}
          height={800}
          priority
          sizes="(max-width:700px) 100vw, 55vw"
        />
        <div className="detail-copy">
          <small>{product.category}</small>
          <h1>{product.name}</h1>
          <p className="lead">{product.fullDescription}</p>
          <p className="detail-price">{formatPrice(product.price)}</p>
          <p className="availability">
            {product.inStock ? "In stock" : "Currently out of stock"}
          </p>
          <AddToCart product={product} />
          <p className="detail-policy">
            Delivery {formatPrice(storePolicy.deliveryPriceEUR)}. Returns within {storePolicy.returnDays} days.
          </p>
          <dl className="product-specifications">
            <div>
              <dt>Type</dt>
              <dd>{product.productType}</dd>
            </div>
            <div>
              <dt>Kind</dt>
              <dd>{product.productKind}</dd>
            </div>
            <div>
              <dt>Use</dt>
              <dd>
                {product.useEnvironment === "both"
                  ? "Indoors and outdoors"
                  : product.useEnvironment === "outdoor"
                    ? "Outdoors"
                    : "Indoors"}
              </dd>
            </div>
            <div>
              <dt>Material</dt>
              <dd>{product.material}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{product.dimensions}</dd>
            </div>
          </dl>
          <h2>Features</h2>
          <ul>
            {product.features.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h2>Things to consider</h2>
          <ul>
            {product.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Link href={`/chat?product=${product.id}`}>
            Ask the assistant about this product ↗
          </Link>
          <p className="muted">
            This is a demo. Adding items does not place an order.
          </p>
        </div>
      </section>
      <section className="related">
        <h2>More for your everyday</h2>
        <div className="grid">
          {related.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
    </>
  );
}
