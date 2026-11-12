import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = {
  title: "Aurelle - shop and assistant",
  description: "Shopping demo with a local AI assistant",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link className="brand" href="/">
            Aurelle<span>Considered everyday goods</span>
          </Link>
          <nav aria-label="Main navigation">
            <Link href="/">Products</Link>
            <Link href="/chat">Shopping assistant</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer>Demo store / Prices in EUR / No real orders</footer>
      </body>
    </html>
  );
}
