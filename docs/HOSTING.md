# Hosting options - decision pending

No deployment, domain or service was created. The owner cancelled external hosting during this implementation. These are options to discuss, not provisioned infrastructure.

## Required runtime

A persistent Node.js service on a supported native platform, local disk for LanceDB and the model cache, and a reachable LLM endpoint. A Linux x64 service is the simplest fit. The BGE encoder uses CPU; a cloud Groq chat adapter avoids the cost of hosting Bielik and a GPU. Allocate and measure memory for Next, the ONNX session and indexing, rather than assuming a frontend-only footprint. Start evaluation around 2 GiB for this small application, then measure; this is a sizing hypothesis, not a tested hosting guarantee.

## Options

| Option | Fit | Trade-off |
| --- | --- | --- |
| Linux VPS / Docker with a persistent data volume | Most control and straightforward native LanceDB support | You own process supervision, updates, TLS and backups |
| Render paid web service with persistent disk | Managed Node/container service, suitable first managed option | Disk-backed service has lifecycle/scaling constraints and an ongoing cost |
| Railway service with volume | Managed service plus durable project data | Metered resource usage; inspect the selected plan and volume behavior |
| Fly.io Machine with volume | Linux VM-style runtime with colocated durable data | More infrastructure decisions and explicit volume/region management |

Official storage references: [Render disks](https://render.com/docs/disks), [Railway volumes](https://docs.railway.com/volumes/reference), [Fly volumes](https://fly.io/docs/volumes/overview/). Verify current pricing before purchasing. Ephemeral serverless filesystems are not a substitute for a durable LanceDB directory.

## Why not the current MyDevil account

SSH verified that the host runs FreeBSD amd64. Next.js itself can run there, as the owner's existing apps do. This project's native LanceDB and ONNX packages do not provide FreeBSD binaries. A remote Linux vector service would be a separate architecture; a snapshot/WASM projection would be another adapter requiring parity and memory validation. Neither was implemented because hosting was cancelled.

No demo process was started on the existing account.

## Before going public

Choose an actual target and persistent data path, decide whether chat uses a direct Groq account or an externally reachable owner-managed model service, and set server-only credentials. The Windows loopback balancer is a local integration, not an internet deployment dependency. Define public access/cost limits before exposing `/api/chat`; current local tests do not establish production concurrency, abuse resistance or uptime. Do not publish or expose the private balancer itself.
