# Verification evidence

## Final local scope

Environment: Linux x64 / WSL, Node 24.15, Next.js 16.4.6, TypeScript strict. The source and `.env.example` target Node 22+. No application, domain, DNS record or service was deployed externally. GitHub source publication is separate from hosting.

## Retrieval and budget regression

Before the fix, a real BGE/LanceDB call for `What can I buy under EUR 25?` returned an empty list despite affordable catalog products. Generic shopping words were incorrectly treated as a semantic product intent.

The application now separates structured browsing from semantic retrieval. A price-only request bypasses the LLM decision and semantic cutoff, filters real LanceDB records, sorts by price/ID and returns up to 12 options. The browser test clicked the exact suggestion, rendered Steel cutlery and showed no empty-catalog response. A test verifies that this path does not call the model or semantic-search method. Semantic coffee queries still use real 384-dimensional BGE vectors and a price filter.

## Providers

| Provider | Evidence | Limit |
| --- | --- | --- |
| Groq balancer, openai/gpt-oss-120b | Live coffee request selected searchProducts and returned dripper/mugs under EUR 25; browser refused a Python request | Not a claim about arbitrary prompts or upstream quota availability |
| Groq direct API configuration | HTTP adapter contract uses the same compatible provider; missing key is rejected | No separate live direct-key acceptance run |
| llama.cpp / Bielik PL 11B v3.0 Q8 | Real model responses exercised the JSON/legacy tool-call compatibility parser and actual search execution | Server template/reasoning configuration affects output format; strict validation rejects unsupported responses |

The optional Windows transport reaches the owner's existing loopback-only balancer from WSL. Requests use its background endpoint, preserve quota accounting and identify the demo client. No credential or balancer policy was changed. Fixture tests inspect the HTTP body/route/headers, JSON mode and 3000-token allowance. Pure budget and explicit product-ID requests are structured paths, not evidence that an LLM reasoned correctly.

## Shopping and UI

- Home renders 48 products, with working search/category controls and real product links.
- All products have generated detail routes; unknown IDs return a 404.
- Browser checked product -> add to cart -> cart, quantity 3, full reload and preserved quantity.
- Cart rules cover versioned/malformed storage, unknown and duplicate IDs, bounded quantities, stock and canonical integer-cent totals. No checkout/order is implied.
- Product -> assistant deep link prefilled the explicit ID; the detail tool returned the actual mugs and the browser rendered its card.
- Desktop and 390 px mobile screenshots cover home, product, cart and chat. Independent image review accepted the direction; its clipped-placeholder and development-overlay findings were fixed.
- The design is light-only. Native phone behavior, production concurrency and public-service access controls are outside these local browser checks.

## Commands

`npm test`, `npm run typecheck` and `npm run build` are the final acceptance gates. Tests use actual BGE weights and a temporary persistent LanceDB database; no cloud key is required. They cover ranking, structured budgets, irrelevant queries, persistence, catalog refresh, cart invariants, JSON/legacy parsing and provider transport contracts. Build generates all 48 detail pages. `npm audit` reports dependency findings separately.

Previous intermediate screenshots and model failures were diagnostic evidence, not accepted behavior. At that checkpoint, the unrestricted second model summary was removed. The later conversation revision below reintroduces only bounded optional conversational wording, while numeric facts and result status remain controlled by the application.

Final gate output: 6 tests passed, 0 failed; strict type checking and the optimized Next build passed; npm audit reported 0 vulnerabilities. The final real Bielik run selected searchProducts, executed the real embedding/database search and completed successfully. Groq returned the canonical delivery policy. Explicit product-ID requests exercised getProductDetails and rendered its card. Unknown product IDs returned 404, malformed chat requests returned 400. A browser test synchronized quantity between two tabs, removed the item and confirmed the empty cart after reload.

A separate local production server (`npm start`) passed the final browser flow: 48-product catalog, Electronics filter, product detail, add/cart/reload, exact EUR 25 suggestion with real cutlery results, and a 390 px viewport without horizontal overflow. This was a local build check, not an external deployment. The temporary QA server was stopped afterwards; the normal development server remains available.

## 2026-11-13 conversation regression and UI direction

Replayed the reported test -> Polish language request -> broad home request -> alternatives -> around USD 30 -> categories conversation through both a regression test using real LanceDB and a browser session using the configured Groq provider. No error alert appeared. Broad home requests returned two examples with a category question. Alternatives excluded the already displayed IDs. Approximate home price ranking returned the EUR 32 ceramic vase and EUR 34 baskets rather than a EUR 14 candle. Foreign currency was explicitly described as a comparative EUR reference, not an exchange-rate conversion, followed by a euro-budget confirmation question.

Category discovery now has a real tool. Unsupported model action output asks for clarification. Failed transport retains the user question and offers Try again. Optional narrative wording is bounded to openings/questions; tests reject invented numeric facts and contradictory empty-inventory claims. The narration deadline is eight seconds and grounded fallback replies remain available. A real Spanish coffee-search turn returned Spanish narration and actual product cards; Polish and English are the deterministic fallback locales.

Browser computed body background was exactly rgb(243, 240, 244), matching #f3f0f4. The primary hero CTA now opens the assistant, collection browsing is secondary, and assistant navigation uses bold text and a robot icon. Mobile conversation capture had no horizontal overflow. A fresh screenshot reader accepted the CTA hierarchy (SHIP).

Local production memory measurements and the non-deployed Render strategy are recorded in RENDER_FREE_PLAN.md. Read-only provider checks confirmed an existing external project's free Render plan and health-check path; external health/database monitors run every 180 seconds, and its separate scheduler clock runs every 1800 seconds. This is not evidence of a fourteen-minute ping and no monitoring configuration was changed.

Final gates for this revision: 9 tests passed, strict TypeScript and production build passed, dependency audit reported zero vulnerabilities. The local cold-index production probe rebuilt all 48 rows, executed real semantic retrieval and narration, and reached a process high-water RSS of 349.1 MiB. This is not an actual Render deployment or a load test. No external service/account/monitor was created or modified.
