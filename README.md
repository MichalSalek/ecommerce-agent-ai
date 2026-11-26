**[Try the live demo](https://ecommerce-agent.michalsalek.com)** -> https://ecommerce-agent.michalsalek.com/

# Aurelle: an AI shopping assistant

Aurelle is a portfolio shopping demo that combines a conversational assistant with a browsable catalog and a device-local cart. Ask in Polish or English, refine a search, compare real catalog records and add a choice from the conversation. The UI and catalog are in English, with prices in EUR.

The catalog contains 86 demo products across 10 categories, including 38 new products with individual prepared WebP photographs. Product specifications, availability, prices and policies are authored demo data. The original visual starting point and some photographs come from [dilums/kimi-k3-ecommerce-storefront](https://github.com/dilums/kimi-k3-ecommerce-storefront). The demo has no checkout, payments, accounts or order fulfillment.

## Try the assistant

Open the chat and type `w czym możesz mi pomóc` or `What can you help me with?` to meet the assistant. Four shortcuts in the welcome message start a conversation. Ten examples under **Explore with the assistant** sit below **Browse products** in the left column. On a phone, expand the same list above the conversation. Each example uses the catalog services and validated state transitions available to the agent. Refinements keep the current search criteria. A request to add the cheaper option uses the displayed selection and asks for clarification if the choice is ambiguous.

| Capability | Example prompt |
| --- | --- |
| Outdoor furniture with a budget | `Show me garden furniture up to €150` |
| Refine a search | `I need something to sit on` |
| Ask for alternatives | `Show me different options` |
| Correct a classification | `Show me outdoor furniture, not planters` |
| Compare catalog products | `Compare mugs and carafe` |
| Add a selected quantity | `Add two of the cheaper option to my cart` |
| Search by purpose | `I need something for my morning coffee` |
| Filter for availability | `Show only in-stock products` |
| Find a candle or diffuser within a budget | `Find a candle or diffuser under €25` |
| Ask about a policy | `How much is delivery?` |

Try these multi-turn paths in a fresh conversation:

1. **Garden and exhaustion:** ask `Show me garden furniture under EUR 150`, then `I need something to sit on`. Ask `Show me different options` repeatedly; the assistant keeps the active constraints, avoids cards already shown and reports when there are no more matching options. You can also correct a result with `A plant pot is not furniture. Show me outdoor furniture`.
2. **Compare:** ask `Compare mugs and carafe`, then ask `Tell me more about the first product` to inspect its recorded construction and limitations. The first answer includes both cards and the calculated price difference. The comparison is limited to catalog facts; an unrecorded quality claim is not a measured advantage.
3. **Select and add:** ask `Compare mugs and carafe`, then `Add two of the cheaper option to my cart`. The assistant resolves the cheaper item from the actual prices and the browser confirms after saving. Open the cart to inspect or change the quantity.

The ten examples remain visible on the chat page. Starters offer common entry points; suggestions after a result depend on what the shopper can do next. A request for a product or feature absent from the catalog should not become an invented offer.

## How it works

The server validates the conversation. Free-form questions use a model with native tool calls; catalog buttons and known cart selections execute their declared actions without a model request. The application executes the allowed catalog and cart tools, checks their inputs and uses their results as evidence for the final response. The model interprets the request; it cannot execute arbitrary code or change the device cart. Its interpretation and wording can still be wrong.

The model receives one shared description of the storefront, its visitor, the catalog behind the product pages, the shop policies, the current conversation and the device-local cart. A search reads store records before presenting them. For a comparison the model receives both products and their recorded uses in the shopper’s language, along with the current request and recent preferences. It can recommend one product and explain the other using individually attributable facts. Product questions keep the supporting passage in its source language while answering the customer in Polish or English.

Search combines category, product kind and type, environment, price, availability and recorded features. Furniture is a product kind, independent of the Garden merchandising category. Functional groups expand to every relevant catalog type; explicit subtype restrictions require words from the current request, so shown products do not become implicit rejections. Search starts with five products by default and can show up to ten in one response. Counts distinguish products in scope, matches, matches not previously shown and those remaining after the current response. The assistant can show all ten categories with counts and an example product, and compare two to ten products using catalog facts and application-calculated price differences.

A typed checkpoint records language, criteria, preferences, shown products and selections across turns. The `shopping-v3` stream carries the checkpoint, result evidence, category cards, comparisons, an operation outcome and an independent advice outcome. Canonical summaries and data remain successful when optional advice is unavailable. Help me choose and Explain differences request advice for the existing result; retrying advice does not search, paginate or repeat a cart action. Older clients have adapters for the earlier result format. An explicit cart request can produce a proposal for one or more items; the browser validates and saves it before reporting success.

The engine allows up to four model calls per turn, with up to 1,024 output tokens for interpretation and 384 for optional advice, including reasoning tokens. Advice is buffered, limited to 400 characters and checked for completeness, language and grounded numeric references before display. The endpoint has a 30-second deadline, and invalid optional advice is omitted without automatic regeneration. The public demo sends every model request directly to Groq GPT-OSS 120B, with low reasoning effort. An unperformed operation has its own failure and retry; unavailable advice has an advice-only retry. These limits do not make model output infallible.

The catalog's short purpose text and fuller product specifications are embedded separately, then their vectors are averaged with equal weight and normalized. Two CPU profiles are supported: pinned BGE small and MiniLM. The Docker/Render profile uses MiniLM. Each has a calibrated cutoff; a result must be within both its profile cutoff and 0.2 cosine distance of the best eligible neighbor. These are demo relevance rules, not a guarantee of accuracy.

The content-addressed table fingerprint includes the full catalog, encoder identity, both actual embedding texts and the vector representation version. Changes create a new table rather than mixing embedding spaces or replacing an active index. See [agent architecture](docs/AGENT_ARCHITECTURE.md) for the execution paths and boundaries.

### Cart, history and limits

The cart stores IDs and quantities, while names, prices and stock come from the catalog. An action ID derived from the conversation and user-message IDs makes retries idempotent. The cart, operation ledger and receipts are saved in one local storage write; existing cart data remains readable. Only an active live stream can execute an action, so restoring history or receiving a cancelled response does not repeat it. A line is limited to 99 units, and unavailable products cannot be added. If saving fails, the action is not confirmed as added and a local retry reuses the same operation without a model. Cart clarification stores only a nonce in the checkpoint; the process retains one intention per conversation for ten minutes, with at most 300 entries. A short confirmation resolves only a live, fixed proposal. Expired or missing intentions require a new selection or quantity.

The cart persists on the device. The transcript and draft live in sessionStorage for the current tab. Reloading resumes that chat. A fresh session starts empty, and upgrading removes the former localStorage transcript without importing it. New conversation starts a fresh model history and keeps the cart. The server sends bounded conversation context to the model when answering a question. A conversation is limited to 20 customer messages or 24,000 textual characters. The interface retains the draft and settled messages, supports retry and reset, and keeps the cart when a conversation ends. Provider errors are shown rather than represented as an empty catalog. Model decisions and generated wording can still be wrong; recorded product details and typed tool results provide the source of demo facts.

`maxPrice` is a hard EUR ceiling. `targetPrice` uses a tolerance of the greater of EUR 5 or 20% and ranks by distance from the target. Foreign amounts are not silently converted: there is no live exchange-rate service.

## Run locally

Use Node.js 22 or later on a supported Linux, macOS or Windows native architecture. LanceDB and ONNX require compatible native binaries. The first catalog preparation downloads the selected pinned model and tokenizer files. Later runs can use the populated cache offline.

```bash
git clone https://github.com/MichalSalek/ecommerce-agent-ai.git
cd ecommerce-agent-ai
npm ci
cp .env.example .env.local
# Configure the shop Groq credential in .env.local.
npm run catalog:prepare
npm run dev
```

Open http://localhost:3000, `/chat` or `/cart`. Product pages use `/products/<id>`. If port 3000 is occupied, Next.js reports the chosen port. `EMBEDDING_MODEL=bge` is the local default; set `EMBEDDING_MODEL=minilm` for the smaller Docker profile. `LANCEDB_DIR` and `EMBEDDING_CACHE_DIR` control the local index and model cache. The index can also be prepared lazily.

### Chat provider

The public demo and the default local server call Groq directly with `openai/gpt-oss-120b`. Set the server secret `GROQ_API_KEY` in the hosting environment or in an ignored local file. A local developer with a separate private file containing `API_KEY` can set `AURELLE_GROQ_KEY_FILE` to its absolute path. Render reads only its runtime secret. Groq is the inference provider.

Retry keeps the same conversation and message IDs and uses the same model. A quota refusal preserves the transcript and any completed catalog result. The assistant displays the retry time when it is available. The application sends no shop traffic to a background scanner or model balancer. Rate limits apply across a Groq organization, so production isolation depends on assigning the shop to an organization separate from the scanner. [Groq rate limits](https://console.groq.com/docs/rate-limits)

For a local QA run, bind the server to `127.0.0.1`, set `AURELLE_LOCAL_QA=llama`, and specify `LLAMA_BASE_URL` (an explicit HTTP loopback origin, port and API path) and `LLAMA_MODEL`. Use a tool-capable Qwen model or a controlled fixture for repeatable tests. Render rejects QA modes. See [.env.example](.env.example) for normal startup.

A coding agent can also use [STARTER_PROMPT.md](STARTER_PROMPT.md) to inspect the project and guide setup. The [initial brief](docs/INITIAL_BRIEF.md) records the original assignment.

## Checks

The isolated local runner explicitly selects llama/Qwen, scrubs Groq credentials, verifies that thinking is actually disabled and warms a full native request before measured calls. A router that forces thinking needs a dedicated passthrough endpoint; the runner records its effective local URL and never changes shared model settings. Its `--engine` mode uses the real engine and index with a longer functional-test boundary; this is separate from the thirty-second production HTTP deadline. It covers six bilingual families, starters/examples, counts, comparisons, the original reported flow and twenty turns. Private artifacts support reuse only for identical source/build and runner inputs.

```bash
EMBEDDING_MODEL=minilm npm run test:agent:local -- --engine --artifact /tmp/aurelle-local.json
npm run test:agent:canary -- --release <full-HEAD-SHA>
```

For real browsing against a locally configured QA model, run `node scripts/agent-browser.mjs http://127.0.0.1:3000 /tmp/aurelle-chat-run.json all` with a fresh output path. It records visible answers, operation IDs and catalog evidence for shopping conversations, source and access questions, two-product recommendations, missing facts and returning to an earlier choice. On a limited QA provider set `AGENT_BROWSER_INTERVAL_MS` to pace messages. For an approved public acceptance, set `AURELLE_PUBLIC_QA_REVISION` to the deployed 40-character commit and pass `https://ecommerce-agent.michalsalek.com` as the origin. The browser checks that revision before sending a message, paces turns at 45 seconds by default, and records the HTTP attempt IDs for matching the provider logs.

The Groq canary uses caller-supplied credentials, a tokenizer-based conservative reservation and a persistent per-release ledger. It measures provider-reported uncached input plus output against an 8,000-token total, retains unknown usage and makes only a free-text call and explicit advice call. Include additional public probes in the same release accounting. By default, run the broad matrix in local QA. For a separately approved public run, record the scope and actual provider usage in the release report. A local Qwen result is separate evidence from Groq acceptance.


```bash
EMBEDDING_MODEL=bge npm run catalog:prepare
EMBEDDING_MODEL=minilm npm run catalog:prepare
npm test
npm run test:agent:dry
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
# Docker is required for these commands.
docker build -t aurelle-demo:render-ready .
npm run container:smoke
# Explicit live acceptance against a running built app configured with Groq.
npm run test:agent:live -- http://127.0.0.1:3000
# Check a deployed revision and one v3 response.
npm run verify:deployment -- https://your-service.example <expected-commit>
```

The dry agent test scripts model responses while using the real MiniLM encoder and LanceDB; prepare the MiniLM cache first. Browser E2E uses mocked responses for its covered scenarios. The Docker smoke uses a local native tool-call fixture while exercising the built container, concurrent requests, index rebuild and cgroup peak memory. None of these establishes that a real model follows the shopping instructions.

The live runner sends real requests to the supplied app, covers Polish and English conversations and writes a transcript under `/tmp` by default. `AGENT_LIVE_ARTIFACT` selects the output path; `AGENT_LIVE_TPM`, `AGENT_LIVE_TURN_RESERVE` and `AGENT_LIVE_INTERVAL_MS` configure pacing. It simulates successful browser cart writes so later API turns can receive a cart snapshot; it does not prove browser storage. Verify the target's provider and exact model from its runtime configuration and logs. Run browser acceptance separately, and record actual results and the deployed revision in [verification evidence](docs/VERIFICATION.md). `npm start` serves a completed standalone build; `/api/health` reports liveness, revision and embedding profile without invoking the model.

## Hosting

The intended deployment uses Render Free, direct Groq, MiniLM and embedded LanceDB, with ready WebP assets and a rebuildable index. Browser data remains local. Render Free can suspend or restart and has resource limits; there is no availability guarantee. The health monitor checks the web service, not every model request or provider quota. Per-instance chat admission controls are configurable and reset on restart; they are not authentication or a distributed billing limit.

See [hosting](docs/HOSTING.md) and the [deployment procedure](docs/RENDER_FREE_PLAN.md). Public pages and static assets can be cached at the edge; API responses are not cached. After a release, the cache-warming script checks the relevant public documents and assets.
