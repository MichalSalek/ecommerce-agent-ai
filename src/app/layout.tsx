import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = {
  title: "Aurelle — sklep i asystent",
  description: "Demo zakupów z lokalnym asystentem AI",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>
        <header>
          <Link className="brand" href="/">
            Aurelle<span>Przedmioty na co dzień</span>
          </Link>
          <nav aria-label="Nawigacja główna">
            <Link href="/">Produkty</Link>
            <Link href="/chat">Asystent zakupowy ↗</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          Sklep demonstracyjny · Ceny w PLN · Bez prawdziwych zamówień
        </footer>
      </body>
    </html>
  );
}
