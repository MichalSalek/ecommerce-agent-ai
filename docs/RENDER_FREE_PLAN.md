# Render Free deployment

The approved launch was executed on 2026-11-15. This record supersedes the account/secret gates in the earlier launch plan.

## Previous release before shopping-v2

- URL: https://ecommerce-agent.michalsalek.com
- Service: `srv-dbsr8pnf3r2c73b5ki30`, dedicated demo workspace.
- Previous accepted deploy: `dep-dbssd4jl550s739bnkd0`.
- Previous application revision: `332997d356e7cbdbb0f3beb1732f938cff48879b`, verified through live `/api/health`.
- Later documentation-only commits do not change this application artifact. Auto-deploy remains off.
- Docker, Free, Frankfurt, one instance, no paid disk/database/GPU.
- Direct Groq `openai/gpt-oss-120b`, MiniLM q8 local CPU embeddings, genuine embedded LanceDB.
- Two concurrent chat requests, 120 valid chat POSTs per rolling hour across the instance. These in-memory limits reset on restart and are not a provider billing cap.
- `render.yaml` remains the configuration source. The API creation payload was derived from it; effective provider settings and runtime secret mapping were read back.

## Acceptance

The unchanged source revision passed GitHub CI: unit/native integration, types, build, browser regressions and constrained Docker smoke. Production `verify:deployment` passed health/revision/profile, all main routes, two actual vector recommendations, a real model-selected delivery-policy tool and category discovery.

Headless Chromium against the public origin passed: main assistant CTA, real recommendations, Shift+Enter, product navigation and Back, reload with preserved draft/history, cart quantity/reload, conversation reset preserving cart, Polish request, and 390px geometry without horizontal overflow. No page errors were observed. Evidence images were saved locally as `/tmp/aurelle-mobile.png` and `/tmp/aurelle-chat.png`.

Provider memory samples after initial retrieval were approximately 375 and 421 MiB. These samples are not peak or concurrency guarantees. A controlled provider restart was requested after the initial acceptance; its result is recorded in VERIFICATION.md.

## Monitoring and operation

Better Stack monitor `5239952`, named `Aurelle web service`, uses the existing BV account. It checks GET `/api/health` every 180 seconds for HTTP success and `"service":"aurelle"`, with TLS validation and email alerts. Existing monitors remain unchanged. There is no separate status page. The monitor is included in the founder cockpit's canonical monitoring inventory.

The service reads the shop credential from the protected Render runtime variable `GROQ_API_KEY`. Use a dedicated Groq organization to isolate its quota from other applications. Keep credentials and provider account identifiers private.

For updates: select a green release, deploy that commit explicitly through Render, then run `npm run verify:deployment -- URL FULL_SHA` and browser checks for affected behavior. Roll back to the previous successful deployment if runtime acceptance fails. Do not clear build caches or rebuild unchanged images without a reason.

Free services may restart, suspend or exhaust included resources. A liveness monitor does not establish model availability. Payment, account verification or paid upgrades require the owner if the provider asks for them.

## Follow-up: first visitor and custom domain

The custom domain has a verified Render certificate and a proxied Cloudflare CNAME. Scoped rules cache public HTML, immutable/static assets and static RSC payloads with their complete validated query hash. API calls always bypass cache. Prefix purging this hostname was verified; URL-only purges did not reliably remove the old HTML object. Purge only `ecommerce-agent.michalsalek.com`, then run `node scripts/warm-deployment.mjs https://ecommerce-agent.michalsalek.com`. No other hostname needs a purge.

The image path now serves already-encoded WebP without runtime AVIF work.23generated product photographs replaced the flat SVG references. A new browser loaded all49images in1223ms; after cache warming, three samples during a controlled origin restart were523/337/336ms. These observations are not a universal latency guarantee. The exact reported coffee-grinder conversation passed, including its typo-bearing follow-up, plus real product-card/cart persistence.

The chat fills the remaining viewport; all examples remain in a compact disclosure. The current source revision passed21unit/native tests and all8browser cases in GitHub CI, including the actual Docker container check. Local Docker Desktop was unavailable; GitHub's container result supplies that packaging evidence.


## Shopping-v2 release

The current release procedure verifies both 86-product encoder profiles locally and uses a green GitHub source and container run for the exact commit to publish. Trigger that SHA explicitly on the existing service, retain the Free plan and existing Groq credential, and compare live `/api/health` revision, catalog count, expected index fingerprint and prepared-index manifest. Public cache invalidation is limited to the prefix `ecommerce-agent.michalsalek.com` before warming the deployment.

Run `npm run verify:deployment -- URL FULL_SHA`, `node scripts/verify-shopping.mjs URL` and a fresh browser conversation that actually saves the chosen quantity to the local cart. The UI now has always-visible examples. Its mobile chat header is compact; the conversation still owns the remaining measured viewport height. The existing monitor remains a liveness check, not a claim of model availability or Render Free continuity.

[Source and container checks](https://github.com/MichalSalek/ecommerce-agent-ai/actions/workflows/ci.yml), the live revision endpoint and the release report identify the published artifact. [Verification](VERIFICATION.md) distinguishes local evidence from historical release measurements.

## Shopping-v3 release procedure

The native engine replaces the earlier planner. Release the integrated source only after the dry suite, real-provider transcript, types, build and browser acceptance. The source and constrained-container jobs must both pass for the same commit. The container fixture speaks native tools and measures cgroup peak memory during concurrent structural/semantic requests and a missing-index rebuild; it does not verify Groq behavior.

Deploy that exact commit to the existing service with auto-deploy off. Verify `live`, revision, 86 records, MiniLM and the prepared fingerprint; purge only the demo hostname prefix and run the warming script. Run `npm run verify:deployment -- URL FULL_SHA`, a fresh semantic conversation and a real browser cart save/reload. Observe provider memory, CPU and events for at least ten minutes and confirm the existing liveness monitor. Roll back only this deployment if acceptance fails; retain device storage. Earlier v1 cart and conversation formats remain compatible with the previous artifact.

`npm run test:agent:live -- URL` records bilingual conversation evidence and actual usage. Set its pacing to the current provider quota, shared with other users of that organization. Successful Groq headers also pace subsequent inferences inside a request; provider cooldowns remain visible; the same 120B model handles a retry, and completed catalog operations retain their results. The live runner's simulated cart is separate from the required browser-storage acceptance.

### Publication for owner evaluation - 2026-11-16

The owner explicitly requested publication of the current shopping-v3 implementation to the existing production service for manual testing before completion of the full real-provider suite. This authorization supersedes that suite's pre-publication gate for this release. Source/container CI, exact-revision deployment, scoped cache invalidation, browser/runtime checks and provider observation still apply. The incomplete bilingual/twenty-turn acceptance and shared Groq daily quota remain recorded limitations. The provider, model, credentials and service plan stay unchanged.

### Historical availability repair - 2026-11-16

Application `8c8d7d3d61769b596a3447adc439b54f87587383` is published in Render deployment `dep-dbtd14rm8hqs73aieprg`. The owner authorized 120B-primary / Qwen-3.8-27B fallback using an existing second Groq profile. That release used `GROQ_FALLBACK_MODEL` and `GROQ_FALLBACK_API_KEY` in the protected environment. Keep the local Windows balancer loopback-only and preserve its configuration. The fallback state is in process memory; restart permits a new primary attempt. Daily quota failures use at least ten minutes, minute/transient failures at least one minute, and longer provider Retry-After deadlines are preserved. No database or background polling is needed.

The real four-turn public coffee/details/comparison/cart check and scoped failure/cooldown tests are recorded in VERIFICATION.md. Extended bilingual/twenty-turn acceptance remains distinct from this incident repair; avoid spending the remaining production quota on another mass acceptance run while the demo is being evaluated.

## Current chat configuration, 2026-11-25

Deploy with the shop-only `GROQ_API_KEY`. The model and direct endpoint are fixed in source. Every public retry uses `openai/gpt-oss-120b`. Remove legacy fallback credentials and provider overrides from the Render service. The 27B route is available only for local QA. See [release verification](VERIFICATION.md) for the incident trace and acceptance.

The owner authorized the complete live conversation matrix on this release using the dedicated shop allowance, with no reserve for another application. The original small canary ledger remains the record of the first probes. Additional acceptance calls are accounted for from the provider's response metadata. Any balancer-assisted QA stays outside the deployed storefront.
