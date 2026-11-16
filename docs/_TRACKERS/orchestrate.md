# Reliable shopping outcomes

Approved scope: independent operation/advice outcomes, complete buffered advice, structured UI actions, current-message language, server-owned pending cart intentions, provider reliability and bounded release acceptance.

## Implementation and evidence

- [x] Reproduce the three original failures before fixes in `tests/shopping-outcome.test.ts`.
- [x] Shared operation/advice contracts and compatibility status adapter.
- [x] Deterministic catalog controls, canonical summaries and advice-only retry.
- [x] Current-message language and bounded server-owned cart intentions.
- [x] Provider lower-limit retention, actual route diagnostics, llama thinking disabled.
- [x] UI/history compatibility and browser regression scenarios implemented.
- [ ] Local Qwen: six bilingual families, all starters/examples, counts/comparisons, twenty turns and original flow.
- [ ] Final integrated tests, types, build, desktop and 390px browser evidence.
- [ ] Real Groq canary: free message and explicit advice, at most 8,000 uncached input/output tokens for this release.
- [ ] Same-SHA green source and constrained-container CI.
- [ ] Exact-SHA Render publication, host-only purge and warming.
- [ ] Fresh public cart/reload/model acceptance and ten minutes of metrics/events/monitor evidence.

## Environment notes

Local development uses the existing Qwen endpoint. Production retains the existing Render service and Groq primary/fallback route. No database, tunnel, payment service or additional infrastructure is introduced. Evidence records will distinguish deterministic, local-model and production-provider acceptance.
