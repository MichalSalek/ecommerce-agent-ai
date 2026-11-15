# Render Free deployment

The approved launch was executed on 2026-11-15. This record supersedes the account/secret gates in the earlier launch plan.

## Release

- URL: https://ecommerce-agent-ai-bpah.onrender.com
- Service: `srv-dbsr8pnf3r2c73b5ki30`, dedicated demo workspace.
- Initial deploy: `dep-dbsr8qnf3r2c73b5klhg`.
- Application revision: `b4d408ee9096ad6b7a1fb71a471014a7fb0e4922`, verified through live `/api/health`.
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

The cloud credential belongs to an organization allocated to AI agents. It is supplied only as Render runtime `GROQ_API_KEY`. Additional agents using that credential share its upstream quota; creating another key in the same organization would not add quota. Secrets and operational credentials remain outside this public repository.

For updates: select a green release, deploy that commit explicitly through Render, then run `npm run verify:deployment -- URL FULL_SHA` and browser checks for affected behavior. Roll back to the previous successful deployment if runtime acceptance fails. Do not clear build caches or rebuild unchanged images without a reason.

Free services may restart, suspend or exhaust included resources. A liveness monitor does not establish model availability. Payment, account verification or paid upgrades require the owner if the provider asks for them.
