# Render Free demo plan - not deployed

Checked 2026-11-13. This is a proposal and local compatibility evidence, not a created service or a guarantee of free-tier performance.

## Roles

| Component | Responsibility | Proposed location |
| --- | --- | --- |
| Groq GPT-OSS 120B | Chat intent/tool planning and optional natural wording | Groq API |
| BGE small English v1.5 q8 | Encode catalog descriptions and English search queries into 384-dimensional vectors | Render CPU, local ONNX runtime |
| LanceDB | Store product records/vectors; execute semantic and structured queries | Render instance filesystem |
| Application services | Language/context, price mode, currency transparency, exclusions and ranking | Next Node process |

The Groq chat models (120B, 27B and 20B) are not interchangeable with an embedding encoder. The current [Groq API reference](https://console.groq.com/docs/api-reference) does not expose an embeddings endpoint for them. Asking a chat model to invent numeric arrays is not a substitute for a consistent semantic embedding space. Query and catalog vectors must use the same encoder/model revision/pooling.

## Local production memory probe

On Linux x64 / WSL with Node 24.15, a built Next server, all 48 products, q8 BGE and single-threaded ONNX:

| Scenario | Observed process RSS / high-water mark |
| --- | --- |
| Cold server, before model/database work | about 97 MiB |
| Prepared database -> semantic query -> real Groq planning/narration | 314.9 MiB |
| Empty database -> embed/index all 48 products -> semantic query -> narration | 349.1 MiB |

Both requests returned real results without a stream error; the measured elapsed time was about 2.5 seconds per scenario on this local machine. These are process-level observations for a small number of sequential requests, not a container-limit, load or Render CPU benchmark. OS memory accounting and overhead differ. Multiple concurrent ONNX sessions, longer requests or a much larger catalog could exceed the available memory.

[Render Free](https://render.com/docs/free) currently provides 750 active instance-hours per workspace per month, spins down after 15 idle minutes and loses runtime filesystem changes on restarts. The [Free compute plan](https://render.com/pricing) provides 512 MB RAM and fractional CPU. The local measurements make a small demo plausible, but the actual instance still needs acceptance testing.

## Rebuildable data is acceptable here

There is no order database, user account store or source catalog edited at runtime. The 48 canonical records live in TypeScript; cart contents live in the visitor's browser. The LanceDB index and BGE cache are derived data.

Preferred deployment preparation:

1. Build a supported Linux Node image/artifact.
2. Run `npm ci`, `npm run catalog:prepare` and `npm run build` during the build. Include the model cache and prepared LanceDB directory in the resulting image/artifact.
3. Start the Node server on Render's `PORT`, binding to `0.0.0.0`.
4. Point the application to direct Groq using server-only environment variables and an owner-provided key. The local Windows balancer is not reachable from a cloud service; do not expose it publicly.
5. Provide a cheap HTTP liveness endpoint that does not call the LLM or run indexing. Separately verify a real search after deploy; liveness alone does not prove the chat works.

If Render resets the writable layer, the baked baseline index/cache can be reopened from the deployment artifact. If only the canonical source remains, lazy preparation can recreate LanceDB, but downloading model weights during a request adds cold-start delay and should be avoided. No paid persistent disk is necessary for this deliberately rebuildable mock catalog. A future mutable order/user database would need a different durability decision.

## Hours and monitoring

A continuously active service uses 720 hours in a 30-day month or 744 hours in a 31-day month. Two continuously active services share 1440/1488 hours, exceeding a workspace's 750-hour allowance. Count running instances, not the number of pings.

[Render health checks](https://render.com/docs/health-checks) verify running-service readiness every few seconds. External uptime monitoring is a separate mechanism. Existing monitoring on another project was inspected read-only; nothing was changed or added. An uptime ping is not a guarantee against provider restarts, quota exhaustion or cold starts, and this demo has no new keep-alive job.

Before deployment, choose the workspace/free-hour budget, provide a cloud-reachable Groq credential, define public request/cost limits and then measure cold start, warmed RSS and simultaneous requests on the actual instance. New account creation and secret creation remain owner actions. No account, service, monitor or DNS record was created here.
