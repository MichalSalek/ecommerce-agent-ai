# Verification

## Current scope

The project now uses an English catalog, EUR demo prices, a CPU BGE embedding adapter and persistent LanceDB search. Previous Polish/PLN checks describe the earlier implementation and have been superseded.

Automated integration tests use real downloaded BGE weights and temporary LanceDB tables. They cover semantic ranking, price filtering, unrelated queries, opening persisted tables in a new repository instance, catalog price refresh and malformed JSON actions.

The local chat backend is Windows llama-swap reached from WSL, model ID `bielik-pl`. Native tool support is not assumed; the JSON adapter validates the chosen tool before execution. The embedding encoder is independent of Bielik and does not use its GPU.

## Final acceptance (2026-11-12)

- Prepared a real local LanceDB table using BGE q8 CPU vectors (384 dimensions). Model weights are pinned to revision `ea104dacec62c0de699686887e3f920caeb4f3e3`.
- Expanded the catalog from 18 to 48 products. The home page rendered all 48 cards; the 390 px mobile viewport had no horizontal overflow.
- Checked live Bielik search in the browser, budget filtering and EUR product cards, plus refusal of a Python programming request.
- Checked the live getPolicy endpoint: delivery costs EUR 4 and takes 2-3 business days.
- Corrected the provider namespace so JSON mode reaches llama.cpp. Schema-constrained decoding conflicts with the installed reasoning template, so the adapter requests JSON objects and validates tool-specific shapes with Zod. The model's reasoning remains enabled.
- Added a transport test that inspects the actual request body and verifies tool execution and streamed output. Integration tests use real embeddings and a temporary persistent database, covering persistence and catalog refresh as well as retrieval.
- Product prose containing invented dollar prices or external URLs falls back to a short grounded message; cards remain authoritative.

Semantic results depend on wording and are capped at two candidates with a cosine-distance cutoff of 0.45. This is a compact demonstration, not a relevance benchmark or a guarantee that every model output is grounded. Native tool mode is optional and was not accepted against this Bielik configuration.

After expanding to 48 products, the browser test with the real Bielik model and persisted LanceDB returned the new Portable Bluetooth speaker for `I want to listen to music without cables, under EUR 50`. All four automated tests, strict type checking and the production build passed; npm audit reported zero vulnerabilities.
