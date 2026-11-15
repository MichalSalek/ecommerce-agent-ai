# Hosting

The [live portfolio demo](https://ecommerce-agent.michalsalek.com) runs as one Render Free Docker web service in Frankfurt. [Deployment evidence and operating procedure](RENDER_FREE_PLAN.md) record its configuration and acceptance.

Next.js, ONNX CPU inference and LanceDB require a supported Linux/Node runtime. The mock catalog index and MiniLM weights are baked into the image. Runtime filesystem changes can disappear after restart; there are no server-side orders or customer accounts to preserve. Browser storage retains the cart and conversation.

The existing MyDevil account runs FreeBSD, which lacks the required native LanceDB/ONNX binaries. It was not used for this deployment. The private local Windows balancer is not exposed to the internet; production calls Groq directly.

Render Free has 512 MiB memory, ephemeral storage and availability/usage limits. No paid plan or persistent disk is configured. A persistent disk and suitable capacity would be needed if this demo gained durable server-side user data. Better Stack checks lightweight liveness every three minutes without calling the model.

The custom hostname is a proxied Cloudflare CNAME with a verified Render certificate. Scoped cache rules cache public HTML and static files while preserving origin TTLs; API and RSC responses are not cached. HTML uses a one-hour edge TTL with stale revalidation/error allowance. Images use static WebP, with no runtime transcoding. Public documents and assets are checked/warmed explicitly after release.

Release invalidation uses a hostname-prefix purge, not a zone-wide purge. URL-only purges did not remove an older cached HTML response during acceptance. The prefix purge was verified by fetching the new Try examples UI and matching the live revision.
