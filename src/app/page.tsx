import Link from "next/link";
import { products } from "@/data/products";
import { ProductCard } from "@/components/ProductCard";
export default function Home() {
  return (
    <>
      <section className="intro">
        <div>
          <small>THE AURELLE COLLECTION / {products.length} PRODUCTS</small>
          <h1>
            Considered goods.
            <br />
            For every day.
          </h1>
          <p>For your home, your desk and your daily rituals.</p>
        </div>
        <aside>
          <p>Need a little inspiration?</p>
          <Link className="button" href="/chat">
            Ask the assistant
          </Link>
        </aside>
      </section>
      <section aria-label="All products" className="grid">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </section>
    </>
  );
}
