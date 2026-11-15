**[Try the live demo](https://ecommerce-agent.michalsalek.com)**

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

The application separates model decisions from catalog facts and cart operations:

1. The server validates the message history. Deterministic paths handle clear requests; a language model returns a validated action for more complex intent. It cannot execute arbitrary tools or supply an inventory claim through a free-text action.
2. Search criteria include product kind and type, environment, price, availability, required features and exclusions. Product kinds are independent of store categories: furniture includes tables, chairs and benches; a planter is gardening equipment. The indoor oak side table is not outdoor furniture.
3. LanceDB applies structural constraints before ranking eligible rows by cosine similarity. The active shopping state is reconstructed from validated history and tool results, including shown and rejected products. Refinements retain relevant constraints; a new topic resets unrelated ones. The catalog overview tool calculates actual category and type counts.
4. Search results carry the total matching count, the unseen count and the number remaining after the current page. The response is grounded in the returned products and their recorded features. A follow-up question is used when helpful, rather than required on every turn.
5. With the `shopping-v2` contract, an explicit add request produces a typed action. The browser checks stock and quantity, saves the cart and reports the result. Older clients retain product-array results and manual card buttons.

The catalog's short purpose text and fuller product specifications are embedded separately, then their vectors are averaged with equal weight and normalized. Two CPU profiles are supported: pinned BGE small and MiniLM. The Docker/Render profile uses MiniLM. Each has a calibrated cutoff; a result must be within both its profile cutoff and 0.2 cosine distance of the best eligible neighbor. These are demo relevance rules, not a guarantee of accuracy.

The content-addressed table fingerprint includes the full catalog, encoder identity, both actual embedding texts and the vector representation version. Changes create a new table rather than mixing embedding spaces or replacing an active index. See [agent architecture](docs/AGENT_ARCHITECTURE.md) for the execution paths and boundaries.

### Cart, history and limits

The cart stores IDs and quantities, while names, prices and stock come from the catalog. An action ID derived from the conversation and user-message IDs makes retries idempotent. The cart, operation ledger and receipts are saved in one local storage write; existing cart data remains readable. Only an active live stream can execute an action, so restoring history or receiving a cancelled response does not repeat it. A line is limited to 99 units, and unavailable products cannot be added. If saving fails, the action is not confirmed as added.

Conversation and cart stay on the device; neither is an authenticated or cross-device order. A conversation is limited to 20 customer messages or 24,000 textual characters. The interface retains the draft and settled messages, supports retry and reset, and keeps the cart when a conversation ends. Provider errors are shown rather than represented as an empty catalog. Model decisions and generated wording can still be wrong; recorded product details and typed tool results provide the source of demo facts.

`maxPrice` is a hard EUR ceiling. `targetPrice` uses a tolerance of the greater of EUR 5 or 20% and ranks by distance from the target. Foreign amounts are not silently converted: there is no live exchange-rate service.

## Run locally

Use Node.js 22 or later on a supported Linux, macOS or Windows native architecture. LanceDB and ONNX require compatible native binaries. The first catalog preparation downloads the selected pinned model; subsequent runs can use the local cache.

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

`LLAMA_MODEL` is optional if the endpoint exposes a model list. The adapter requests JSON object mode and validates tool actions; its Bielik compatibility parser also handles legacy tool-call dictionaries without evaluating code. A remote deployment cannot reach a local machine's loopback address.

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
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
# Docker is required for these commands.
docker build -t aurelle-demo:render-ready .
npm run container:smoke
```

The test suite covers real CPU encoders and LanceDB retrieval, structural filtering, conversation state, cart recovery and idempotency, provider contracts and browser behavior. Browser fixtures and live provider checks answer different questions; test results and deployment evidence are recorded separately in [verification evidence](docs/VERIFICATION.md). `npm start` serves a completed standalone build. `/api/health` reports liveness, revision and embedding profile without invoking the model.

## Hosting

The intended deployment uses Render Free, direct Groq, MiniLM and embedded LanceDB, with ready WebP assets and a rebuildable index. Browser data remains local. Render Free can suspend or restart and has resource limits; there is no availability guarantee. The health monitor checks the web service, not every model request or provider quota. Per-instance chat admission controls are configurable and reset on restart; they are not authentication or a distributed billing limit.

See [hosting](docs/HOSTING.md) and the [deployment procedure](docs/RENDER_FREE_PLAN.md). Public pages and static assets can be cached at the edge; API responses are not cached. After a release, the cache-warming script checks the relevant public documents and assets.
