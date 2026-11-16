**[Try the live demo](https://ecommerce-agent.michalsalek.com)** -> https://ecommerce-agent.michalsalek.com/

# Aurelle: an AI shopping assistant

Aurelle is a portfolio shopping demo that combines a conversational assistant with a browsable catalog and a device-local cart. Ask in Polish or English, refine a search, compare real catalog records and add a choice from the conversation. The UI and catalog are in English, with prices in EUR.

The catalog contains 86 demo products across 10 categories, including 38 new products with individual prepared WebP photographs. Product specifications, availability, prices and policies are authored demo data. The original visual starting point and some photographs come from [dilums/kimi-k3-ecommerce-storefront](https://github.com/dilums/kimi-k3-ecommerce-storefront). The demo has no checkout, payments, accounts or order fulfillment.

## Try the assistant

The chat page offers these ten clickable examples. They use the ordinary assistant flow; refinement, alternatives and adding a cheaper item work in the context of preceding results.

| Capability | Example prompt |
| --- | --- |
| Outdoor furniture with a budget | `Show me garden furniture under EUR 150` |
| Refine a search | `I need something to sit on` |
| Ask for alternatives | `Show me different options` |
| Correct a classification | `A plant pot is not furniture. Show me outdoor furniture` |
| Compare catalog products | `Compare mugs and carafe` |
| Add a selected quantity | `Add two of the cheaper option to my cart` |
| Search by purpose | `I need something for my morning coffee` |
| Filter for availability | `Show only in-stock products` |
| Find a gift within a budget | `Find a gift under EUR 25` |
| Ask about a policy | `How much is delivery?` |

Try these multi-turn paths in a fresh conversation:

1. **Garden and exhaustion:** ask `Show me garden furniture under EUR 150`, then `I need something to sit on`. Ask `Show me different options` repeatedly; the assistant keeps the active constraints, avoids cards already shown and reports when there are no more matching options. You can also correct a result with `A plant pot is not furniture. Show me outdoor furniture`.
2. **Compare:** ask `Compare mugs and carafe`, then ask `Tell me more about the first product` to inspect its recorded construction and limitations. The first answer includes both cards and the calculated price difference. The comparison is limited to catalog facts; an unrecorded quality claim is not a measured advantage.
3. **Select and add:** ask `Compare mugs and carafe`, then `Add two of the cheaper option to my cart`. The assistant resolves the cheaper item from the actual prices and the browser confirms after saving. Open the cart to inspect or change the quantity.

The ten examples remain visible on the chat page. Starters offer common entry points; suggestions after a result depend on what the shopper can do next. A request for a product or feature absent from the catalog should not become an invented offer.

## How it works

The server validates the conversation and sends the current request to a model that uses native tool calls. The application executes the allowed catalog and cart tools, checks their inputs and uses their results as evidence for the final response. The model interprets the request; it cannot execute arbitrary code or change the device cart. Its interpretation and wording can still be wrong.

Search combines category, product kind and type, environment, price, availability and recorded features. Furniture is a product kind, independent of the Garden merchandising category. Functional groups expand to every relevant catalog type; explicit subtype restrictions require words from the current request, so shown products do not become implicit rejections. Search starts with five products by default and can show up to ten in one response. Counts distinguish products in scope, matches, matches not previously shown and those remaining after the current response. The assistant can show all ten categories with counts and an example product, and compare two to ten products using catalog facts and application-calculated price differences.

A typed checkpoint records language, criteria, preferences, shown products and selections across turns. The `shopping-v3` stream carries the checkpoint, result evidence, category cards, comparisons and turn status. Older clients have adapters for the earlier result format. An explicit cart request can produce a proposal for one or more items; the browser validates and saves it before reporting success.

The engine allows up to four model calls per turn, including presentation, with up to 1,024 output tokens per call. The Groq adapter requests low reasoning effort. Provider errors and incomplete responses remain visible as such. These limits do not make model output infallible.

The catalog's short purpose text and fuller product specifications are embedded separately, then their vectors are averaged with equal weight and normalized. Two CPU profiles are supported: pinned BGE small and MiniLM. The Docker/Render profile uses MiniLM. Each has a calibrated cutoff; a result must be within both its profile cutoff and 0.2 cosine distance of the best eligible neighbor. These are demo relevance rules, not a guarantee of accuracy.

The content-addressed table fingerprint includes the full catalog, encoder identity, both actual embedding texts and the vector representation version. Changes create a new table rather than mixing embedding spaces or replacing an active index. See [agent architecture](docs/AGENT_ARCHITECTURE.md) for the execution paths and boundaries.

### Cart, history and limits

The cart stores IDs and quantities, while names, prices and stock come from the catalog. An action ID derived from the conversation and user-message IDs makes retries idempotent. The cart, operation ledger and receipts are saved in one local storage write; existing cart data remains readable. Only an active live stream can execute an action, so restoring history or receiving a cancelled response does not repeat it. A line is limited to 99 units, and unavailable products cannot be added. If saving fails, the action is not confirmed as added.

Conversation and cart stay on the device; neither is an authenticated or cross-device order. A conversation is limited to 20 customer messages or 24,000 textual characters. The interface retains the draft and settled messages, supports retry and reset, and keeps the cart when a conversation ends. Provider errors are shown rather than represented as an empty catalog. Model decisions and generated wording can still be wrong; recorded product details and typed tool results provide the source of demo facts.

`maxPrice` is a hard EUR ceiling. `targetPrice` uses a tolerance of the greater of EUR 5 or 20% and ranks by distance from the target. Foreign amounts are not silently converted: there is no live exchange-rate service.

## Run locally

Use Node.js 22 or later on a supported Linux, macOS or Windows native architecture. LanceDB and ONNX require compatible native binaries. The first catalog preparation downloads the selected pinned model and tokenizer files. Later runs can use the populated cache offline.

```bash
git clone https://github.com/MichalSalek/ecommerce-agent-ai.git
cd ecommerce-agent-ai
npm ci
cp .env.example .env.local
# Configure one chat provider in .env.local.
npm run catalog:prepare
npm run dev
```

Open http://localhost:3000, `/chat` or `/cart`. Product pages use `/products/<id>`. If port 3000 is occupied, Next.js reports the chosen port. `EMBEDDING_MODEL=bge` is the local default; set `EMBEDDING_MODEL=minilm` for the smaller Docker profile. `LANCEDB_DIR` and `EMBEDDING_CACHE_DIR` control the local index and model cache. The index can also be prepared lazily.

### Chat provider

For a local llama.cpp-compatible server, choose your own GGUF model and obtain its model ID:

```bash
llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080 --jinja
curl http://127.0.0.1:8080/v1/models
```

```dotenv
CHAT_PROVIDER=llama
LLAMA_BASE_URL=http://127.0.0.1:8080/v1
LLAMA_MODEL=your-model-id
```

`LLAMA_MODEL` is optional if the endpoint exposes a model list. The selected model and server must support the native OpenAI-compatible tool-calling protocol. A models endpoint alone does not verify the complete shopping flow. A remote deployment cannot reach a local machine's loopback address.

For Groq:

```dotenv
CHAT_PROVIDER=groq
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=openai/gpt-oss-120b
GROQ_API_KEY=your-existing-key
```

Keep credentials in `.env.local` or the hosting secret store, never in source. An optional OpenAI-compatible balancer can be selected with `GROQ_BALANCER=true`; `GROQ_TRANSPORT=windows` enables the loopback-only Windows transport when applicable. See `.env.example` for settings. Groq is an inference provider, distinct from xAI Grok. There is no silent provider fallback.

A coding agent can also use [STARTER_PROMPT.md](STARTER_PROMPT.md) to inspect the project and guide setup. The [initial brief](docs/INITIAL_BRIEF.md) records the original assignment.

## Checks

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
