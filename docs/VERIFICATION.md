# Current verification evidence

Last checked: 2026-11-13. Older intermediate behavior and failures are preserved in Git history; this file describes the accepted refinement.

## Environment and gates

- Development: Linux x64 / WSL, Node 24.15; production container: Linux x64, Node 22.
- `npm test`: **15 passed, 0 failed**. Includes actual BGE/MiniLM embeddings and temporary LanceDB tables, persistence/refresh, budgets/currency/context, tool protocol/provider fixtures, cart rules and admission controls.
- `npm run typecheck`: passed (`next typegen` and strict TypeScript).
- `npm run build`: passed, including all 48 product pages and dynamic chat/health routes.
- `npm run test:e2e`: **5 passed** on the actual standalone production launcher.
- `npm audit`: zero reported dependency vulnerabilities at this checkpoint.
- CI has separate source/browser and constrained-container jobs. Cloud services were not created by these checks.

## Reported UX regressions

The browser suite uses an intercepted AI SDK UI stream to isolate UI behavior without spending model quota. It proves:

1. Enter submits; Shift+Enter inserts a line without a request.
2. Product navigation -> browser Back and full reload retain messages, product cards and draft.
3. New conversation during generation stops the old response, clears the old topic, restores the welcome state and prevents a late old reply from leaking into the new chat.
4. Mobile at 390 x 844 has no horizontal overflow and keeps the composer reachable.
5. Incoming replies do not pull a reader away from older messages; jump-to-latest works.
6. Failed product photos show a meaningful fallback while product actions remain usable.

The five tests combine those cases. IME composition is guarded in code but was not accepted on a real IME/mobile keyboard. The normal welcome message is local, not a model request. Root ownership retains an active conversation across route transitions; localStorage retains settled messages/draft across reloads. Restored cards use canonical current prices, not values from browser storage.

## Agent and retrieval behavior

A regression fixture returns the original question-only coffee response (`respond`), while the engine must still perform search and show two actual options. The clear purchase route uses real retrieval before a narrowing question. Product IDs are not hardcoded into its answer.

The Polish test -> language request -> broad home request -> alternatives -> around USD 30 -> categories sequence passed against real LanceDB and in a real-provider browser session. Broad home queries return two examples and a category question; alternatives exclude shown IDs. Approximate home-price ranking includes the EUR 32 vase near EUR 30, rather than treating the target as a maximum and returning a EUR 14 candle. Foreign currency examples explicitly request EUR-budget confirmation and are not represented as exchange-rate conversions.

Category discovery has its own actual-data tool. Invalid model action output asks for clarification. Optional narration supplies only an opening/question, has an eight-second deadline and rejects numeric price/currency/URL contradictions. Its absence does not discard successful tool results. Model context is compacted separately from visible history. Retained explicit language choice wins over generated English starter wording.

Live checks used **Groq / openai/gpt-oss-120b through the existing owner balancer**, including actual coffee retrieval/narration, an LLM-selected delivery-policy tool and category discovery. One Spanish coffee-search turn also produced Spanish narration. Polish/English are the grounded fallback locales. A separately supplied direct cloud key on Render has not been accepted yet. The local llama.cpp/Bielik adapter and its validated legacy envelope parser remain supported; this UI refinement does not claim a fresh complete Bielik conversation acceptance matrix.

## CPU profiles and container

- BGE q8: pinned revision `ea104dacec62c0de699686887e3f920caeb4f3e3`, CLS pooling, normalized 384 dimensions, retrieval prefix, cutoff 0.45.
- Smaller MiniLM q8: pinned revision `751bff37182d3f1213fa05d7196b954e230abad9`, mean pooling, normalized 384 dimensions, no prefix, cutoff 0.74.
- Both have distinct model identities/table fingerprints. MiniLM required its own cutoff; applying BGE's cutoff produced false negatives. Native tests cover coffee, music, irrelevant intent and price filtering.

A real image passed with `--memory=512m --memory-swap=512m --cpus=0.1`, including homepage/product routes, production image optimization and real MiniLM/LanceDB retrieval. The smoke deliberately uses an offline LLM URL: it proves retrieval/packaging and safe narration fallback, **not cloud LLM availability**.

Latest preflight samples:

| Scenario | Elapsed | Observed working memory |
| --- | --- | --- |
| Baked index -> query | 6.4 s | 134.2 MiB |
| Remove index -> restart -> recreate all 48 records -> query | 9.1 s | 166.7 MiB |

The container was not OOM-killed. These are sequential local working-memory samples, not peak/concurrent Render measurements or an uptime guarantee. Earlier runs were around 129-166 MiB. CPU-only pruning and standalone tracing reduced the initial 3.63 GB image to roughly 820 MB. Explicit dynamic ONNX tracing is retained and exercised. Every temporary smoke container is removed.

## Hosting boundary

Render CLI v2.20 returned `valid: true` for `render.yaml`; validation did not provision the planned service. No account, application, DNS record, monitor or status page was created. The executable handoff is [RENDER_FREE_PLAN.md](RENDER_FREE_PLAN.md).

Read-only checks of an existing project previously confirmed Render Free, HTTP liveness, external health/database checks every 180 seconds and a separate scheduler clock every 1800 seconds. No existing project's monitoring or quota policy was changed. Liveness does not prove model availability; the deployment verifier includes a real LLM tool-call scenario for that reason.

## 2026-11-13 stability, conversation lifetime and traceability

The existing owned Turbopack dev process failed an HTTP `/chat` timeout and was observed near 3.8 GiB RSS. It was stopped and replaced with Webpack development, isolated under `.next-development`; production still builds under `.next`. Actual `/chat` and `/` requests then returned 200, and the browser replayed shopping successfully. This is evidence of the old process's failure and the new path's recovery, not a proven upstream memory-leak diagnosis.

The real 29-dollar home request returned vase cards, explicit EUR confirmation, and a trace with zero LLM calls / 96 ms stream execution / responseCache false. The whole development POST logged about 579 ms. Existing table/weights/inference-session reuse is distinct from answer caching, which is not implemented.

A 20-user-turn or 24000-text-character conversation policy closes the composer, warns near the turn boundary and requires a new topic while preserving the cart. The API independently rejects excessive input before runtime/model execution. Browser acceptance restores a full saved transcript, verifies the locked input/send state, and starts a new conversation successfully. This is a heuristic lifetime cap, not exact tokenizer accounting or secure identity tracking.

The reported vase/material-durability scenario was inspected with real Groq: the earlier connection failure did not reproduce, so its historical cause remains unproven. Added a grounded handler stating the missing durability evidence rather than inventing resistance. A deterministic fixture verifies no LLM dependency for that specific evidence question. Manual retry is covered by an HTTP-503-then-success browser test: same request context, one user message, successful second response. No automatic provider switching/retry loop was introduced.

Final source acceptance: 17 unit/native integration tests, 7 Playwright production-browser tests, strict type generation/check and production build passed. The model-context compaction limits remain independent from the new visible conversation lifetime. Technical interview guidance is in AGENT_ARCHITECTURE.md. Separate NEXT_PROJECTS.md contains proposals only; the home-site source was inspected read-only and was not changed.

## Discovery extensions and recruiter walkthrough

Added compareProducts with two/three distinct IDs, canonical record resolution, missing-ID reporting and deterministic pairwise price difference. Actual mugs/carafe comparison produced a EUR 3 difference and both product cards. Comparison parts survive a reload via the same schema/canonical-product restoration as search. A browser regression clicks the advertised comparison scenario from the demo guide and verifies the resulting cards plus reload persistence.

Added inStockOnly as a real LanceDB boolean filter, independent of vector relevance. Stock-aware follow-ups retain earlier criteria. Gift browsing returns two available records within budget and asks for recipient/preferences; it does not claim that a generic gift is personalized already.

Manual browser checks on the actual development server exercised comparison, gift budget and stock follow-up with no error alerts. The public chat page now states that all catalog records/prices/stock/policies are mock data, that no orders/payments occur, and provides eight clickable capability scenarios plus persistence/retry/context boundaries. The guide was inspected at desktop and 390 px mobile; there was no horizontal overflow. Source code and UI do not represent structured routing as an LLM call on every turn.

Acceptance for the discovery extension: 18 unit/native integration tests passed, 8 Playwright tests passed, strict types and the production build passed, dependency audit reported zero vulnerabilities. The capability-guide screenshot reader returned SHIP; this was a visual/comprehension verdict only. Actual scenario buttons and tool results were exercised separately in manual and automated browser checks. The guide's stock example can run either after a search or on its own, and comparisons retain canonical product cards after reload.
