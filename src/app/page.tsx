import Link from "next/link";
import { products } from "@/data/products";
import { ProductCard } from "@/components/ProductCard";
export default function Home() {
  return (
    <>
      <section className="intro">
        <div>
          <small>KOLEKCJA AURELLE / 18 PRODUKTÓW</small>
          <h1>
            Dobre rzeczy.
            <br />
            Na każdy dzień.
          </h1>
          <p>Do domu, do pracy i do małych codziennych rytuałów.</p>
        </div>
        <aside>
          <p>Nie wiesz, co wybrać?</p>
          <Link className="button" href="/chat">
            Porozmawiaj z asystentem ↗
          </Link>
        </aside>
      </section>
      <section aria-label="Wszystkie produkty" className="grid">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </section>
    </>
  );
}
