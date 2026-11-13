# Render Free launch plan

Status: implementation and local acceptance prepared; no external deployment or monitor exists. Continue this plan in the next session after the owner completes the account/secret gates. Use the repository's AGENTS.md and preserve unrelated projects.

## Fixed decisions

- Application: this repository, branch `main`, one Render **Free** Docker web service in a dedicated workspace with an available 750-hour monthly allowance.
- Chat: direct **Groq / openai/gpt-oss-120b**, server-only key. The private Windows balancer remains a local development adapter and is not exposed to the internet.
- Embeddings: **Xenova/all-MiniLM-L6-v2**, q8, CPU, mean pooling, normalized 384-dimensional vectors. Pinned revision: `751bff37182d3f1213fa05d7196b954e230abad9`. The downloaded model directory is about 23 MiB. This is a small practical encoder verified on the demo, not a claim that it is the smallest model in existence.
- Storage: genuine embedded LanceDB, derived from the 48 mock products. The baseline index and model cache are baked into the image. Runtime database changes may be lost; there are no server-side orders or user accounts to preserve.
- Monitoring/status: **Better Stack Free**, HTTP check every three minutes, public status page. Check `/api/health`, never a paid/model chat request.
- No paid plan, GPU, extra database service or persistent Render disk is part of this plan. Do not change Nailfolio or its monitors.

## Files already prepared

| File | Purpose |
| --- | --- |
| `Dockerfile` | Node 22 multi-stage build, prepared model/index, standalone runtime, non-root user, CPU-only native dependencies |
| `render.yaml` | One free Docker service, `/api/health`, direct Groq 120B, MiniLM profile, required secret prompt, auto-deploy initially off |
| `scripts/prune-runtime.mjs` | Removes unused platforms and GPU providers only from generated standalone output |
| `scripts/container-smoke.mjs` | Tests the actual container under 512 MiB and 0.1 CPU; checks routes, photos, real retrieval and index reconstruction |
| `scripts/verify-deployment.mjs` | Checks a target service/revision plus real retrieval, a real LLM policy-tool call and categories |
| `.github/workflows/ci.yml` | Unit/native integration, strict types, production build, browser regression suite and Docker smoke jobs |

Render CLI v2.20 accepted the Blueprint as valid, including its free plan/region fields. This was validation only, against an existing authorized workspace; the actual launch must explicitly target the new demo workspace. No service was created.

## Gate A - owner actions

- [ ] Create/sign into the intended Render account and workspace. Confirm that its free-hour budget is not already consumed by another always-active service. One 31-day service uses up to 744 hours; two share up to 1488 hours, exceeding 750.
- [ ] Connect the GitHub repository or provide scoped Render CLI/API access for the **new demo workspace**. An account API key must be created by the owner and kept in the private credential store, never committed or pasted into a public issue.
- [ ] Select a Groq quota pool for this public demo and create/provide its key privately. Limits apply at the organization level: a new key in the same organization does **not** create a separate quota. Do not silently bypass the dictation balancer's reserve by attaching an unbudgeted public demo to its shared pool.
- [ ] Create/sign into the Better Stack account intended for this demo. If automation uses its API, the owner creates the scoped uptime API credential. Manual access through an already authorized browser is another option.
- [ ] Complete any identity/payment-method verification required by a provider yourself. Do not upgrade to a paid plan as a workaround without a new owner decision.

**Stop here if access or the Groq secret is missing. Do not create accounts, rotate secrets, change paid plans, or reuse another project's credentials by guessing.** All remaining work is agent-owned once these gates are satisfied.

## Agent phase 1 - select the release

1. Read this plan, README.md and the current repository state. Use the green CI results for the exact unchanged release; do not rebuild completed work simply because a new session started.
2. If source inputs change, batch the final checks:

   ```bash
   npm ci
   npm run catalog:prepare
   npm test
   npm run typecheck
   npm run build
   npx playwright install chromium
   npm run test:e2e
   docker build -t aurelle-demo:render-ready .
   npm run container:smoke
   ```

3. Record the full intended commit SHA. Preserve local/parallel work; stage explicit paths and publish verified changes to main if necessary.
4. Validate against the intended demo workspace, explicitly:

   ```bash
   render blueprints validate render.yaml --workspace DEMO_WORKSPACE_ID --output json --confirm
   ```

   Never rely on a global CLI default that might point at Nailfolio's workspace.

## Agent phase 2 - deploy only the new service

1. Import this public repository's Blueprint through the authorized Render account/API, or use the dashboard's Blueprint flow. Select the confirmed demo workspace. The committed `render.yaml` is the source of truth; do not invent a second hand-configured service.
2. Supply `GROQ_API_KEY` through Render's secret/environment interface. Do not add it as a Docker build argument, GitHub file, screenshot or log. The Dockerfile declares only the non-secret embedding-profile build argument.
3. Check the effective settings before creating/deploying:
   - plan `free`, one instance;
   - Dockerfile `./Dockerfile`, repository root context;
   - `CHAT_PROVIDER=groq`, `GROQ_MODEL=openai/gpt-oss-120b`;
   - `GROQ_BASE_URL=https://api.groq.com/openai/v1`, `GROQ_BALANCER=false`, no Windows transport;
   - `EMBEDDING_MODEL=minilm` in both build and runtime;
   - liveness `/api/health`, port from `PORT`, binding `0.0.0.0`;
   - `CHAT_MAX_CONCURRENT=2`, `CHAT_REQUESTS_PER_HOUR=120` initially;
   - no paid disk, database, GPU or extra worker.
4. Deploy the selected commit, inspect build/runtime logs and collect provider deployment ID, commit and status `live`. The app/image uses a non-root user and a 256 MiB JavaScript old-space limit; native memory is separate.
5. Keep auto-deploy off during the first acceptance. Afterwards enable CI-gated automatic deploys only if the owner wants that release workflow.

## Agent phase 3 - prove the actual service

Replace placeholders with the actual service URL and full commit; do not publish a guessed URL:

```bash
npm run verify:deployment -- https://ACTUAL-SERVICE.onrender.com FULL_COMMIT_SHA
```

This performs three chat POSTs. Unlike liveness, the delivery-policy case must reach the real LLM and execute its tool, so a missing key or unsupported model cannot masquerade as a working deployment.

Browser acceptance on the deployed origin:

- [ ] Primary AI CTA opens the assistant with a welcome message.
- [ ] Coffee starter/Enter produces two real product cards on the first answer, followed by useful guidance.
- [ ] Shift+Enter inserts a line; IME composition is not treated as submission. Only the keyboard cases actually tested may be called verified.
- [ ] Product link -> browser Back and a full reload retain the conversation and draft.
- [ ] Add to cart, update quantity, reload; starting a new conversation does not clear the cart.
- [ ] New conversation stops an active response, clears the previous topic and returns to the welcome state without a late old reply reappearing.
- [ ] Polish language request, broad home request, alternatives, around-price/EUR confirmation and category listing behave correctly.
- [ ] 390 px mobile: composer stays usable, no horizontal overflow; the thread can scroll independently and incoming messages do not pull a reader away from older content.
- [ ] Test warm retrieval and one controlled restart. Record actual Render memory, cold-start duration and any OOM/restarts. The local Docker probe is not a Render SLA or concurrency benchmark.
- [ ] Inspect 429/503 handling. Do not weaken controls or silently switch models to conceal a failed acceptance.

## Agent phase 4 - monitor and publish the status page

Only after the real service passes acceptance:

1. Create one Better Stack HTTP/keyword monitor named `Aurelle web service`, URL `https://ACTUAL-SERVICE.onrender.com/api/health`, method GET, interval three minutes, expected status 200 and keyword `"service":"aurelle"`.
2. Use the real email/notification preference from the owner account; do not add recipients or send messages to others without authorization.
3. Create the free public status page and connect that monitor as the web-service component. Keep the label accurate: this checks Node availability, not every Groq request or remaining model quota.
4. Record and verify the actual status-page URL. Read the monitor settings back and observe a successful check. Do not create duplicate pings/cron jobs or copy Nailfolio's scheduler/database probes.
5. An external check normally prevents idle spin-down, but Free services may still restart/suspend. Do not promise uninterrupted uptime. One continuously active service consumes its running hours regardless of how few customers visit it.

## Agent phase 5 - publication and handoff

- [ ] Set the GitHub repository homepage to the actual verified demo URL.
- [ ] Update README with the real demo/status links and measured hosting behavior. If a code/docs commit is published after acceptance, account for the deployed SHA explicitly and re-verify after any required redeploy.
- [ ] Report the application SHA, Render deployment ID, URLs, monitor cadence, provider/model, current memory and tested/untested paths.
- [ ] Leave no temporary local test containers or duplicate monitoring jobs. Preserve the normal local development server if the owner is using it.

## Local evidence and resource limits

A real Linux Docker container, Node 22, MiniLM q8 and LanceDB passed with `--memory=512m --memory-swap=512m --cpus=0.1`. Observed working memory was about 129 MiB with the baked index and 166 MiB after removing/rebuilding all 48 rows. Requests took about 7.7 and 9 seconds in that constrained local probe. The LLM endpoint was deliberately offline in this smoke test; this proves CPU retrieval, packaging and safe narration fallback, not real Groq availability. A separate local production check using the real configured Groq balancer passed the LLM policy-tool scenario.

The runtime image was reduced from an initial 3.63 GB to roughly 820 MB by standalone tracing and CPU-only native-file pruning. Explicit ONNX tracing is needed because the transformer package loads that dependency dynamically. The container test exercises it; do not remove the tracing/pruning contract without rerunning the actual container.

The production admission guard allows two in-flight chat requests and 120 valid chat POSTs per rolling hour **across the instance**, including retries and structured turns. It releases capacity on completion/error/cancellation. The window is in memory and resets on restart; it is not a distributed abuse barrier or a billing guarantee. These app controls protect a small demo; upstream Groq quotas remain independent. Local development is not subject to this production guard. Liveness GETs do not consume chat admission or model tokens.

## Current provider references

Checked 2026-11-13: [Render Free](https://render.com/docs/free), [Render pricing](https://render.com/pricing), [Blueprint specification](https://render.com/docs/blueprint-spec), [health checks](https://render.com/docs/health-checks), [Better Stack Free uptime/status](https://betterstack.com/uptime), [Groq organization-level rate limits](https://console.groq.com/docs/rate-limits), [MiniLM model](https://huggingface.co/Xenova/all-MiniLM-L6-v2). Recheck exact account entitlements before provision. No paid capacity is authorized by this plan.

## Final preparation checkpoint

- Local source gates: 15 unit/native integration tests and 5 browser regressions passed; strict types/build passed; dependency audit had zero findings.
- The browser suite uses the same standalone launcher as `npm start`, with static/public assets and environment handling prepared automatically.
- Latest completed constrained-container samples were 132.9 MiB after baked-index retrieval and 159.5 MiB after index recreation, at 6.4 / 8.8 seconds; production image optimization was included. These are working-memory samples, not a promise about peak/concurrent Render usage.
- CI stamps the container with the release revision and verifies it through `/api/health`; the actual Render environment's Git commit takes precedence over that local stamp.
- Local real-provider acceptance passed through the configured Groq balancer. Direct Groq on the new Render account remains an explicit go-live check after the owner supplies the chosen cloud secret.
