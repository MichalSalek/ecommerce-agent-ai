import Link from "next/link";
import Image from "next/image";
import { Catalog } from "@/components/Catalog";
export default function Home() {
  return (
    <>
      <section className="intro">
        <div className="intro-copy">
          <small>THE AURELLE EDIT</small>
          <h1>
            Less searching.
            <br />
            More finding.
          </h1>
          <p>
            Good things for your home, your desk
            <br className="desktop-break" /> and the rituals in between.
          </p>
          <div className="hero-actions">
            <Link className="button" href="#collection">
              Explore the collection
            </Link>
            <Link href="/chat">Find it with the assistant ↗</Link>
          </div>
        </div>
        <Link className="hero-image" href="/products/mugs">
          <Image
            src="/images/products/mugs.webp"
            alt="Ceramic mugs for slow mornings"
            width={720}
            height={640}
            priority
            sizes="(max-width:700px) 100vw, 50vw"
          />
          <span>
            Made for a slower morning <span>Shop ceramic mugs ↗</span>
          </span>
        </Link>
      </section>
      <Catalog />
    </>
  );
}
