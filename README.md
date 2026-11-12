# Aurelle: local shopping assistant

An English storefront with EUR prices, a Bielik shopping assistant, and persistent semantic product search in LanceDB. Built with Next.js 16 App Router, React 19, TypeScript strict and Vercel AI SDK 7. Based on [dilums/kimi-k3-ecommerce-storefront](https://github.com/dilums/kimi-k3-ecommerce-storefront); product photography is retained from the template.

## Run

Requires Node.js 22 or later and an OpenAI-compatible llama.cpp or llama-swap server for chat.

```bash
npm install
npm run catalog:prepare
npm run dev
```

Open http://localhost:3000 and http://localhost:3000/chat. `catalog:prepare` downloads the embedding model on first use and indexes all 48 products. First preparation needs internet access; subsequent retrieval uses the local cache. No embedding API key, separate database process or GPU is required. Preparation is also lazy on the first search, but running it explicitly avoids a download during a conversation.

Configure chat in `.env.local`:

```dotenv
LLAMA_BASE_URL=http://127.0.0.1:8080/v1
LLAMA_MODEL=bielik-pl
LLAMA_TOOL_MODE=json
# Optional, relative to the project working directory:
EMBEDDING_CACHE_DIR=.data/models
LANCEDB_DIR=.data/lancedb
```

This installation already uses `http://172.20.0.1:8090/v1` to reach Windows llama-swap from WSL. The model ID is `bielik-pl`; the Windows UI is http://localhost:8090/ui/#/models. If the WSL gateway changes, update the address using `ip route show default`. Local configuration and generated data are excluded from Git.

The JSON compatibility adapter requests JSON object mode (without schema-constrained decoding, which conflicts with this Bielik reasoning template), validates the result with Zod, and asks Bielik to select a validated tool or refusal, runs the tool, and then requests an English answer using its output. It makes at most two model calls per turn. `LLAMA_TOOL_MODE=native` uses ToolLoopAgent with a maximum of five steps; it requires a model/server with native tool support. The request deadline is 90 seconds and model discovery has a four-second timeout. No automatic retries or cloud fallback are used. Server reasoning settings are preserved.

## Retrieval and model choice

Bielik generates answers; it does not generate the search vectors. [BGE small English v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) is a dedicated embedding encoder suited to this short English catalog. The adapter uses the [Xenova ONNX distribution](https://huggingface.co/Xenova/bge-small-en-v1.5), quantized to q8, on CPU (about 34 MB of cached weights), with CLS pooling, normalization and 384-dimensional vectors. Query text uses BGE's retrieval instruction prefix. The application removes explicit budget phrases from the semantic query and applies the amount as a structured price filter. This is a practical small baseline, not a claim that it is the best model for every catalog.

LanceDB stores product records and vectors on disk. Searches use cosine distance, return at most two records and apply an optional EUR price filter before selecting neighbors. A demo cutoff of 0.45 removes distant results; it is calibrated on the included examples, not a universal relevance guarantee. Small catalogs use exact vector search, without an approximate index. This is real vector retrieval, not keyword matching.

The table name fingerprints the catalog and embedding configuration. Catalog, price or model changes create a new table, preventing stale vectors or mixed embedding spaces. Old versions remain on disk; removing `.data/lancedb` while the app is stopped rebuilds the derived database without changing the source catalog. The embedding cache can be retained.

Prices are deliberately chosen demo EUR prices, not a live currency conversion. Shipping is EUR 4, returns are within 14 days; these are mock policies. The cart button logs an event and shows feedback without placing orders.

## Structure

```text
src/domain/catalog/          Product contract, repository port, store policies
src/application/catalog/     Catalog use cases and embedding port
src/application/chat/        Tool contracts and assistant instructions
src/infrastructure/catalog/  LanceDB repository adapter
src/infrastructure/embeddings/ BGE CPU embedding adapter
src/infrastructure/chat/     llama.cpp model and JSON/UI-stream adapters
src/composition/shop.ts      Adapter wiring and environment configuration
src/data/products.ts         Canonical English demo catalog
src/app/                     Next.js pages and thin HTTP route
src/components/              Shared product presentation
scripts/prepare-catalog.ts   Model download and catalog preparation
```

The domain has no imports from Next.js, LanceDB or the AI SDK. Adapters implement application/domain ports; only the composition root selects concrete infrastructure. Product validation is shared by stored results and UI rendering. Tool input schemas are reused for native and JSON execution.

## Verify

```bash
npm test
npm run typecheck
npm run build
npm audit
```

Tests use real BGE vectors and a temporary LanceDB database, covering semantic ranking without shared keywords, budget limits, unrelated results, persistence, catalog refresh and JSON protocol validation. They use the local model cache and may download BGE if missing. They do not require Bielik.

Manual chat examples:

- `I need something for my morning coffee under EUR 25`
- `Something to keep me warm on the sofa`
- `How much is delivery?`
- `Write a Python loop` (should be refused)

See [verification notes](docs/VERIFICATION.md) for the scope of live checks. Logs use `[AGENT]`, `[LLM]`, `[TOOL]`, `[VECTOR]`, `[EMBEDDING]` and `[CART]`. The demo has no authentication, payments or production commerce backend.

## Demo catalog and images

The catalog contains 48 mock products across kitchen, home, furniture, storage, bathroom, garden, wellness, electronics, lighting and accessories. Of these, 30 were added beyond the initial catalog. Products with no template photograph use local SVG illustrations explicitly marked as illustrations; all images work without external image services. EUR amounts are demo prices, not conversions from another currency. The product count on the home page is derived from the catalog.

Model weights, LanceDB files, environment overrides and dependency folders are not committed. The repository includes `.env.example`; never commit personal API keys or local database/model caches when publishing a fork.
