# UI evidence

## Last Session
2026-11-15: viewport-height chat measured against actual header; concise sidebar and factual demo bar; eight scenarios retained in a collapsed Try examples guide. Desktop 1440x1080/900 and mobile 390x844 dev probes confirm composer stays inside viewport and no horizontal overflow. Final production checks owned by host.

2026-11-13: navy/coral palette, white conversation surface, compact cards, pinned composer and visible New conversation. Reader: SHIP, minor thumbnail issue resolved with correctly sized eager thumbnails and a tested fallback. Keyboard/history/reset/scroll/mobile paths have Playwright coverage.

## Key Findings
- Budget-only requests are structured catalog browsing, not semantic retrieval.
- Cart feedback must say items are saved; checkout remains explicitly unavailable.

## Patterns
- Shared ProductCard and AddToCart on catalog, related products and chat results.
- Product images link to real detail pages.

## Design ledger
- Owner-selected #f3f0f4 paper / navy / coral / serif display are systemic Aurelle brand elements.
- Home photographic split, product detail split, cart summary; no repeated decorative motifs.

## Health
Light-only desktop/mobile evidence. No screenshot score substituted for functional checks.

## Blockers
No local UI blocker; production evidence is recorded separately in deployment verification.
