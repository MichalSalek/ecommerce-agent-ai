import type { Metadata } from "next";
import Link from "next/link";
import { ChatProvider } from "@/components/chat/ChatProvider";
import { CartProvider } from "@/components/CartProvider";
import { CartLink } from "@/components/CartLink";
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
        <CartProvider>
          <ChatProvider>
            <div className="demo-bar">
              A small collection. A thoughtful way to shop.
            </div>
            <header>
              <Link className="brand" href="/">
                Aurelle<span>Considered everyday goods</span>
              </Link>
              <nav aria-label="Main navigation">
                <Link href="/">Products</Link>
                <Link className="assistant-link" href="/chat">
                  <svg
                    aria-hidden="true"
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    <path d="M12 3v3M4 11H2m20 0h-2" />
                    <rect x="4" y="6" width="16" height="14" rx="3" />
                    <circle cx="9" cy="12" r="1" />
                    <circle cx="15" cy="12" r="1" />
                    <path d="M9 16h6" />
                  </svg>
                  Shopping assistant
                </Link>
                <CartLink />
              </nav>
            </header>
            <main>{children}</main>
            <footer className="site-footer">
              <span>Demo store / Prices in EUR / No real orders</span>
              <a
                href="https://github.com/MichalSalek/ecommerce-agent-ai"
                target="_blank"
                rel="noopener noreferrer"
              >
                Source & architecture ↗
              </a>
            </footer>
          </ChatProvider>
        </CartProvider>
      </body>
    </html>
  );
}
