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

## Final integration checkpoint — 2026-11-16

The effective thinking-disabled Qwen run exposed an actual Polish comparison failure, its downstream cheapest-cart error and a generic collection-query failure. The integrated fix requires the requested comparison to complete, grounds distinct canonical product nouns without adding an interpreting model, preserves retained groups after details, and treats generic store wording as structural browsing. Cart operands are checked before quantity clarification; unknown labels cannot authorize a known item. Harmless trailing predicates do not change selection or units.

Source `c86d672` passed 207 tests, typecheck and production build. Its browser run passed 32/33; the remaining assertion expected the former ungrammatical `1 products` text. The corrected assertion passed independently in `cd476a2`; the full same-SHA CI is running. Source files and model inputs are frozen during real-model acceptance.

The final Qwen artifact is `/tmp/aurelle-engine-contract.json`. Reviewed resume verifies the original source and runner hashes, unchanged ordinary inference controls, current search parsing and every reused nonfinal history summary. Only six unaffected batches are reused; all comparisons, carts, actions, changed Polish histories, counts and twenty turns run again. The earlier garden fixture was revalidated against the closed canonical furniture/seating taxonomy, preserving its original error and the four actual application failures. Neither revalidation nor resume accepts those application failures.

That run finished at 32/33: counts, comparison sizes, original flow and both cart languages passed. The twentieth-turn family stopped at turn eight because the model twice chose an overview with stale furniture filters instead of resolving the two named products. The fix targets that specific tool boundary: an explicit comparison with distinct grounded subjects redirects the erroneous overview to a fresh product lookup. Category/policy overviews, quoted examples and negated subjects keep their ordinary path. A captured failing-tool regression fails before this guard and passes after it. Real-model correction and the full twenty-turn rerun remain required before publication.

The real correction pilot showed the model still copying recommendation filters into its requested lookup. The flagged recovery now uses only the translated CURRENT query, then the existing facet resolver reapplies constraints actually present in CURRENT. A pilot with the captured initial wrong tool and real Qwen continuation completed the correct mugs/carafe comparison and Polish advice. Its initial fixture additionally expected the opposite display order; independent semantic validation confirms the correct pair, EUR 3 difference and carafe minimum. Final integrated gates passed: 210 tests, types, build and 33 browser tests. `/tmp/aurelle-engine-overview.json` is the pending final model run. Its exact-delta/attributed-provider-trace proof reuses 26 unaffected batches and reruns the six inherited batches plus the entire failed twenty-turn family. Generic test fixtures require no Git history, so shallow CI checkouts remain supported.

## Environment notes

Local development uses the existing Qwen endpoint. Production retains the existing Render service and Groq primary/fallback route. No database, tunnel, payment service or additional infrastructure is introduced. Evidence records will distinguish deterministic, local-model and production-provider acceptance.

Earlier HTTP diagnostics on the generic local gateway timed out under its forced xhigh profile. A warmed native inference generated 353 tokens in 58.5 seconds (about 6 tokens/second); a complete diagnostic turn with advice took 124.4 seconds. The application retains its 30-second deadline. The isolated suite passed its initial catalog turn but timed out on the next free-form request. This is not a completed bilingual/twenty-turn acceptance. The diagnostic used a longer test signal and does not pass the HTTP deadline gate.

All four starters, ten examples, requested counts 4/5/10/20/all and comparisons 2/5/10 passed actual catalog-only API checks with zero inferences. Fresh 390px browser checks verified two unavailable model routes, one advice message/countdown, usable catalog controls during cooldown, Polish cart save and unchanged cart/receipt after reload.

The final plain-advice Groq canary passed on `3531993`: 233 input and 72 output tokens, with the complete qualitative response manually checked against the canonical records. The unchanged first free-message path reuses its verified `68407fb` result. All attempts, including rejected intermediate advice, total 6,270 uncached input/output tokens in one root-release ledger; 1,730 remain for public runtime acceptance. An intermediate response that passed numeric-reference validation was rejected by human review for an unsupported size comparison; that case now has a regression guard.

ABSORBED: the real local garden cases reproduced a pre-existing query-language false positive. The English vocabulary omitted canonical taxonomy/category labels, so `garden furniture` was misclassified as Polish. Regression tests fail before the fix and pass after it; Polish queries still require translation. Five already successful batches retain verified unchanged behavior: their saved queries were only `morning coffee` or empty. Reviewed resume checks the old source/runner hashes, permits only this one changed source file and revalidates every reused query.

The same live cases then exposed a missing hard-kind projection: a model query for `garden furniture` without a kind filter returned a hand trowel. The existing facet resolver now recovers a unique, positive canonical kind named in both CURRENT and the semantic query. Quotes, negation, hypothetical/relational requests and mixed kinds/types do not silently narrow the result. A separate reviewed resume proof confirms that earlier coffee/category batches contain no affected kind terms.

The garden rerun also exposed an omitted EUR 150 cap. The same resolver now preserves explicit bilingual EUR caps, known requested result counts and only-in-stock requirements from CURRENT. Currency conversion and conflicting caps require clarification. A count phrase such as `up to 10 products` is removed from the semantic query before the existing budget parser can mistake it for EUR 10. Reuse now additionally replays every successful saved search transition and requires the identical resolved transition.

A subsequent real response duplicated `garden` in requiredFeatures while already applying outdoor scope, incorrectly producing an unconfirmed-feature empty result. Canonical structural constraints are now removed from duplicate feature requirements only when the applied scope already guarantees them; substantive features such as waterproof remain untouched. Engine-QA provider calls share the existing 600-second functional-test boundary; the production HTTP deadline remains thirty seconds.

## Acceptance boundaries

The full local conversation suite also runs directly against the real engine through `scripts/agent-local-core.ts`, using a longer functional-test boundary. The production API retains its thirty-second timeout; its wire protocol, cancellation, browser storage and real Groq latency are separate acceptance evidence. Engine artifacts explicitly identify their mode and cannot reuse HTTP-mode batches. No functional conversation family is waived by this separation.

The shared local router was verified to overwrite `chat_template_kwargs.enable_thinking=false` with thinking=true/xhigh. This explained thought-only length-limited responses. The local QA runner now uses the existing router's documented `/upstream/qwen38-uncensored/v1` passthrough, preserving the same GGUF and per-request thinking=false without changing shared configuration. A separate profile probe requires actual nonempty content with no reasoning before the native warm-up. Earlier high-thinking runs remain historical and are not reused for the fresh correct-profile suite.
