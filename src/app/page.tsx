import Link from "next/link";
import { StoreImage } from "@/components/StoreImage";
import { Catalog } from "@/components/Catalog";
export default function Home() {
  return (
    <>
      <section className="intro">
        <div className="intro-copy">
          <small>AI SHOPPING ASSISTANT</small>
          <h1>Find and compare products with an AI assistant.</h1>
          <p>
            Tell the assistant what you have in mind. It searches the catalog,
            compares your options and helps you add a choice to your cart.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/chat">
              Open shopping assistant ↗
            </Link>
            <Link href="#collection">Browse the collection</Link>
          </div>
        </div>
        <Link
          className="hero-image"
          href="/chat"
          aria-label="Explore the shopping assistant"
        >
          <StoreImage
            src="/images/hero-shopping-assistant.webp"
            alt="A laptop showing the shopping assistant and outdoor furniture"
            width={1280}
            height={960}
            priority
            sizes="(max-width:700px) 100vw, 50vw"
          />
          <span>Explore the shopping assistant ↗</span>
        </Link>
      </section>
      <Catalog />
    </>
  );
}
