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
- [x] Real Groq canary: free message and explicit advice, at most 8,000 uncached input/output tokens for this release.
- [ ] Same-SHA green source and constrained-container CI.
- [ ] Exact-SHA Render publication, host-only purge and warming.
- [ ] Fresh public cart/reload/model acceptance and ten minutes of metrics/events/monitor evidence.

## Environment notes

Local development uses the existing Qwen endpoint. Production retains the existing Render service and Groq primary/fallback route. No database, tunnel, payment service or additional infrastructure is introduced. Evidence records will distinguish deterministic, local-model and production-provider acceptance.

The broad local HTTP acceptance is blocked by measured local-model throughput. A warmed native inference generated 353 tokens in 58.5 seconds (about 6 tokens/second); a complete diagnostic turn with advice took 124.4 seconds. The application retains its 30-second deadline. The isolated suite passed its initial catalog turn but timed out on the next free-form request. This is not a completed bilingual/twenty-turn acceptance. The diagnostic used a longer test signal and does not pass the HTTP deadline gate.

All four starters, ten examples, requested counts 4/5/10/20/all and comparisons 2/5/10 passed actual catalog-only API checks with zero inferences. Fresh 390px browser checks verified two unavailable model routes, one advice message/countdown, usable catalog controls during cooldown, Polish cart save and unchanged cart/receipt after reload.

The final plain-advice Groq canary passed on `3531993`: 233 input and 72 output tokens, with the complete qualitative response manually checked against the canonical records. The unchanged first free-message path reuses its verified `68407fb` result. All attempts, including rejected intermediate advice, total 6,270 uncached input/output tokens in one root-release ledger; 1,730 remain for public runtime acceptance. An intermediate response that passed numeric-reference validation was rejected by human review for an unsupported size comparison; that case now has a regression guard.

ABSORBED: the real local garden cases reproduced a pre-existing query-language false positive. The English vocabulary omitted canonical taxonomy/category labels, so `garden furniture` was misclassified as Polish. Regression tests fail before the fix and pass after it; Polish queries still require translation. Five already successful batches retain verified unchanged behavior: their saved queries were only `morning coffee` or empty. Reviewed resume checks the old source/runner hashes, permits only this one changed source file and revalidates every reused query.

The same live cases then exposed a missing hard-kind projection: a model query for `garden furniture` without a kind filter returned a hand trowel. The existing facet resolver now recovers a unique, positive canonical kind named in both CURRENT and the semantic query. Quotes, negation, hypothetical/relational requests and mixed kinds/types do not silently narrow the result. A separate reviewed resume proof confirms that earlier coffee/category batches contain no affected kind terms.

The garden rerun also exposed an omitted EUR 150 cap. The same resolver now preserves explicit bilingual EUR caps, known requested result counts and only-in-stock requirements from CURRENT. Currency conversion and conflicting caps require clarification. A count phrase such as `up to 10 products` is removed from the semantic query before the existing budget parser can mistake it for EUR 10. Reuse now additionally replays every successful saved search transition and requires the identical resolved transition.

## Acceptance boundaries

The full local conversation suite also runs directly against the real engine through `scripts/agent-local-core.ts`, using a longer functional-test boundary. The production API retains its thirty-second timeout; its wire protocol, cancellation, browser storage and real Groq latency are separate acceptance evidence. Engine artifacts explicitly identify their mode and cannot reuse HTTP-mode batches. No functional conversation family is waived by this separation.
