# Hosting

The [portfolio demo](https://ecommerce-agent.michalsalek.com) has been hosted as one Render Free Docker web service in Frankfurt. The current source may be ahead of the running release; check the served revision and [deployment evidence](VERIFICATION.md) before attributing a source change to the live service. [Deployment procedure](RENDER_FREE_PLAN.md) records the hosting setup.

Next.js, ONNX CPU inference and LanceDB require a supported Linux/Node runtime. The mock catalog index, pinned MiniLM weights and tokenizer files are prepared in the image. The tokenizer is loaded directly from the pinned revision cache; a missing file requires download unless remote model access is disabled. The loading change leaves the encoder identity and index fingerprint inputs unchanged. Runtime filesystem changes can disappear after restart; there are no server-side orders or customer accounts to preserve. Browser storage retains the cart and conversation.

The existing MyDevil account runs FreeBSD, which lacks the required native LanceDB/ONNX binaries. It was not used for this deployment. The private local Windows balancer is not exposed to the internet; production calls Groq directly.

Render Free has 512 MiB memory, ephemeral storage and availability/usage limits. No paid plan or persistent disk is configured. A persistent disk and suitable capacity would be needed if this demo gained durable server-side user data. Better Stack checks lightweight liveness every three minutes without calling the model.

The custom hostname is a proxied Cloudflare CNAME with a verified Render certificate. Scoped cache rules cache public HTML and static files while preserving origin TTLs; API responses are not cached. Public static RSC payloads use the full Next-validated `_rsc` query as their cache key, separate from HTML. HTML uses a one-hour edge TTL with stale revalidation/error allowance. Images use static WebP, with no runtime transcoding. Public documents and assets are checked/warmed explicitly after release.

Release invalidation uses a hostname-prefix purge, not a zone-wide purge. URL-only purges did not remove an older cached HTML response during acceptance. After invalidation, check the visible shopping examples and match the served revision to the intended release.


## Verification for a release

Build the intended revision and check it locally before publication. The Docker smoke runs with 512 MiB and 0.1 CPU, uses a local native tool-call fixture, exercises concurrent ten-product requests and a missing-index rebuild, and checks cgroup peak memory. It does not use a real model.

```bash
docker build --build-arg APP_REVISION=<commit> -t aurelle-demo:render-ready .
npm run container:smoke -- aurelle-demo:render-ready <commit>
npm run verify:deployment -- https://your-service.example <commit>
```

The deployment check reads health and the prepared-index fingerprint, checks public routes and requests one `shopping-v3` response. A healthy endpoint or one completed response does not prove the complete shopping flow. For real-model acceptance, run `npm run test:agent:live -- <built-app-url>` against the configured service and verify the provider and model from runtime configuration or logs. The live runner records transcripts and simulated cart writes; separately verify actual browser storage and user-facing flows. Keep these results and their revision distinct in [verification evidence](VERIFICATION.md).
