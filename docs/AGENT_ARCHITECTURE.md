# Aurelle agent architecture

Aurelle is a bounded shopping assistant. Application code owns product facts, filtering, cart rules and tool execution. A language model interprets requests that are not handled by a clear structured path; its proposed action is validated before execution. The catalog, prices, stock and policies are demo data, not a real merchant feed.

## From a request to a result

1. The chat endpoint validates the incoming messages and applies conversation and request limits. Language and the current shopping state are reconstructed from the validated history and tool results.
2. Recognized requests can use deterministic paths for language, categories, known products, comparison, cart selection and shopping constraints. More complex intent is sent to the configured model as a bounded planning request. Zod validates the returned action; arbitrary tools, SQL and executable code are not accepted.
3. Search criteria combine the active constraints and the new request. Product type and kind are separate from store category, and environment is `indoor`, `outdoor` or `both`. Corrections and negative types can narrow a search, while a genuine topic change resets unrelated constraints. Shown IDs are retained to support alternatives without repeats.
4. LanceDB applies price, stock, category, kind, type, environment, excluded type and recorded-feature filters before vector ranking. A product with no supporting catalog fact does not meet a required feature. For pagination, previously shown IDs are removed from the ranked matches before selecting the page, so the response can retain the total match count.
5. An envelope returns the products, total matches, unseen matches and remaining matches after the page. The catalog overview tool calculates actual category and type counts. Product replies and comparisons use canonical product records; prices and differences are application calculations. Responses need not end in a question, and narration is not required on every turn.

A request for garden furniture therefore searches the furniture kind with outdoor or both-environment use, independent of the Garden merchandising category. An indoor planter and the indoor oak side table cannot pass that filter. If a requested category and kind conflict, the reply can explain the conflict instead of quietly changing the request. An unknown product type produces no catalog matches.

The model can still misunderstand a request or choose an imperfect action. Schema validation and factual data boundaries reduce the effect; they do not guarantee model accuracy. The model does not execute a checkout or change browser storage.

## Embeddings and the index

The catalog has 86 products across 10 categories. Each record contains a short description, fuller demo-authored specifications, a canonical type and kind, environment, material, dimensions, features and limitations. English and Polish names and aliases for types and kinds live in the taxonomy. The 38 added products have individual static WebP images.

A product has two embedding texts: a concise purpose document based on name and short description, and a detailed document containing its fuller description, type, kind, use and relevant recorded facts. Both are encoded independently, combined with equal weight and normalized. This preserves the purpose alongside the longer specifications. Queries are embedded separately; structured browsing can run without a query embedding.

| CPU profile | Model | Pooling and query prefix | Profile cosine-distance cutoff |
| --- | --- | --- | --- |
| `bge` | `Xenova/bge-small-en-v1.5` | CLS; retrieval instruction prefix | 0.45 |
| `minilm` | `Xenova/all-MiniLM-L6-v2` | Mean; no prefix | 0.74 |

Both use pinned q8 models and normalized 384-dimensional embeddings. The Render/Docker profile selects MiniLM. Equal dimensions do not make the two spaces interchangeable. After structural filtering, the maximum accepted distance is the smaller of the profile cutoff and the best eligible neighbor's distance plus 0.2. This further limits distant neighbors; it does not establish universal relevance.

Each derived LanceDB table is named from a fingerprint of the full catalog, encoder identity, both actual indexing texts and the representation version. A catalog, encoder, document or representation change therefore creates a different table. Existing tables are retained, keeping active indices separate. Local model files and tables are caches of weights and catalog vectors, not cached customer responses.

## Conversation and tool boundaries

The shared client provider keeps the active conversation during route navigation. Device-local storage retains settled messages and a draft across reloads; restored product cards use the current catalog rather than stored prices. Incomplete tool parts are not replayed. Retry resends the same customer turn instead of appending another; it still counts toward request limits. Stopping or starting a new conversation isolates late responses.

The visible conversation has a limit of 20 customer messages or 24,000 textual characters. The server independently validates requests and rejects oversized histories. Model context is compacted separately to fit the provider budget. These are application limits, not exact tokenizer accounting or an identity boundary.

The planner's allowed tools include search, catalog overview, product details, comparison, categories and policy. A free response is not a source of catalog inventory. Search inputs include structural constraints and exclusions; comparison resolves canonical IDs and calculates price differences from records. A foreign-currency amount is not converted: the application asks for a EUR budget rather than claiming an exchange rate.

## Cart action contract

A client opts in by sending `shopping-v2` and a conversation ID. The server identifies the selected product and quantity from the explicit request and the latest relevant products. An ambiguous selection or price tie requires clarification. Stock, integer quantities and the 99-unit line limit are checked; a request alone does not imply that a browser cart changed.

For an accepted request, the server emits a typed action with an operation ID derived from the conversation ID, user-message ID and action kind. The browser accepts it only for the active live stream and matching user message. One local storage write saves the cart, executed-operation ledger and receipt together; a receipt is shown as added only after the write succeeds. Retry and duplicate delivery use the same operation ID, while history restoration and a cancelled or superseded stream do not execute it again. Existing cart documents remain readable. Manual add buttons use the same cart rules.

A legacy client receives the original search result arrays and uses product-card buttons for manual cart addition. The cart is local to a device and is not a server-authoritative order, payment or checkout.

## Operations and failure handling

- The configured provider is explicit; there is no silent switch to another provider. A provider error remains an error with a retry path, not an empty catalog.
- The endpoint has a request deadline; planner calls also have a shorter timeout. Cancellation propagates to the stream.
- Per-instance request limits count valid chat requests and retries. They reset on restart and are not durable distributed rate limiting, authentication or a provider billing cap.
- `/api/health` reports service liveness and revision without running the model or an embedding query. It cannot prove that every provider request will succeed.
- Product facts and specs are demonstration data. Neither the model nor the application has evidence for an unrecorded certification, durability rating or real-world product performance.

For setup, executable examples and local checks, see the [README](../README.md). For deployment configuration and caching, see [hosting](HOSTING.md).
