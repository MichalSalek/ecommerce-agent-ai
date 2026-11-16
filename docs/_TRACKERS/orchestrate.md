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
- [x] Final integrated tests, types, build, desktop and 390px browser evidence.
- [ ] Real Groq canary: free message and explicit advice, at most 8,000 uncached input/output tokens for this release.
- [ ] Same-SHA green source and constrained-container CI.
- [ ] Exact-SHA Render publication, host-only purge and warming.
- [ ] Fresh public cart/reload/model acceptance and ten minutes of metrics/events/monitor evidence.

## Environment notes

Local development uses the existing Qwen endpoint. Production retains the existing Render service and Groq primary/fallback route. No database, tunnel, payment service or additional infrastructure is introduced. Evidence records will distinguish deterministic, local-model and production-provider acceptance.

The broad local HTTP acceptance is blocked by measured local-model throughput. A warmed native inference generated 353 tokens in 58.5 seconds (about 6 tokens/second); a complete diagnostic turn with advice took 124.4 seconds. The application retains its 30-second deadline. The isolated suite passed its initial catalog turn but timed out on the next free-form request. This is not a completed bilingual/twenty-turn acceptance. The diagnostic used a longer test signal and does not pass the HTTP deadline gate.

All four starters, ten examples, requested counts 4/5/10/20/all and comparisons 2/5/10 passed actual catalog-only API checks with zero inferences. Fresh 390px browser checks verified two unavailable model routes, one advice message/countdown, usable catalog controls during cooldown, Polish cart save and unchanged cart/receipt after reload.

## Owner decision if local latency remains unchanged

The approved plan requires full local Qwen acceptance before production publication. Any release while that gate remains open needs an explicit exception from the owner. A green unit/browser/CI result or a successful Groq canary does not silently waive it.
