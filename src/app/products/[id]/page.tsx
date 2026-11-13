import { StoreImage } from "@/components/StoreImage";
import Link from "next/link";
import { notFound } from "next/navigation";
import { products } from "@/data/products";
import { AddToCart } from "@/components/AddToCart";
import { ProductCard } from "@/components/ProductCard";
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
    title: `${products.find((p) => p.id === id)?.name ?? "Product not found"} - Aurelle`,
  };
}
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = products.find((p) => p.id === id);
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
          <p className="lead">{product.description}</p>
          <p className="detail-price">{formatPrice(product.price)}</p>
          <p className="availability">
            {product.inStock
              ? "In stock · Ready for your everyday"
              : "Currently out of stock"}
          </p>
          <AddToCart product={product} />
          <p className="detail-policy">Delivery €4 · Returns within 14 days</p>
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
