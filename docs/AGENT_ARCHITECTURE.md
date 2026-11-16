# Aurelle agent architecture

Aurelle is a shopping assistant for a demo catalog. A configured language model interprets customer requests and uses native tool calls; application code owns tool execution, catalog facts, selection checks and cart rules. The 86 products, prices, stock, specifications and store policies are authored demo data.

## A conversation turn

The chat endpoint validates the message history, optional device-cart snapshot and request limits. It restores the latest validated shopping checkpoint and passes a compact state, recent text and the current request to the model. The state contains language, scope, criteria, preferences, requested count, shown and rejected IDs, recent selections and comparison IDs. It is a preference and conversation hint, not a source of product facts. The optional cart snapshot contains device-local IDs and quantities; it does not create a server-side cart.

The model can call search, catalog overview, categories, product details, comparison, policy and cart-proposal tools. Each tool has a schema and is executed by the application. The model finishes by calling `presentAnswer` with an answer, view and evidence IDs. The server validates the citations, referenced products and supported absence claims and resolves supported price and count references against recorded evidence. A model may answer a greeting or ask a clarification without searching. A confirmation can keep its natural text without repeating cards. When recommendations are presented, the application restores the complete verified page if the model omitted presentation IDs. The model cannot execute arbitrary code or write browser storage.

A turn is limited to four model inferences, including presentation, with a maximum of 1,024 output tokens per inference and one correction path for invalid calls or presentation. The Groq adapter requests low reasoning effort and disables parallel tool calls. Provider support for these options and the quality of interpretation remain model-dependent. A partial turn or provider failure is reported rather than presented as an empty inventory result.

## Search and evidence

Search transitions distinguish a new search, refinement, change, alternatives and browsing. Functional needs use canonical seating, coffee or music groups whose full type membership is expanded by application code. Explicit kind, subtype, department and type exclusions need evidence from the current request or an unchanged established constraint; an arbitrary subset cannot silently remove previously shown types. The model proposes the transition; application code validates it and merges or resets typed criteria. Shown IDs support alternatives. A rejection requires a quoted fragment of the current request referring to that product or group; merely showing a product does not reject it. Explicitly rejected IDs are kept separately. A new topic can reset unrelated search conditions while explicitly persistent preferences remain. The model can still misunderstand a request, so these mechanisms are boundaries rather than guarantees of interpretation.

Search has separate recommendation and lookup modes. A recommendation resolves the active criteria once per user turn; independent lookups can resolve named products before a comparison without changing those criteria or advancing a result page. The model can choose subsequent reads within the inference budget.

LanceDB filters category, kind, type, environment, price, stock, excluded types and required recorded features before semantic ranking. The Garden category is a merchandising grouping; outdoor furniture uses the furniture kind and outdoor or both-environment records across categories. `maxPrice` is a hard EUR ceiling. `targetPrice` uses a tolerance of the greater of EUR 5 or 20% and sorts by distance from the target. The application has no exchange-rate service.

Required features use exact normalized properties and reviewed material-composition mappings. Glazed ceramic satisfies ceramic and amber glass satisfies glass; brass-finish metal does not establish solid brass. Known Polish catalog terms are rejected before entering the English encoder so the model can translate its query once. A substring in a description or limitation is not proof of a feature. Unsupported certification, waterproofing or other unrecorded facts cannot be inferred from a product's absence of limitations.

A search normally requests five products and returns at most ten per page. `SearchEvidence` records the applied criteria, outcome, requested count, scope total, total matches, unseen matches before the page and remaining matches after it. Counts allow a short page, no match or exhausted result to be described from actual evidence. Category cards contain a name, count and canonical example ID for each of the ten categories. Comparisons accept two to ten distinct catalog IDs and calculate cheapest IDs and price differences in cents from canonical prices.

## Stream, history and compatibility

The storefront opts into `shopping-v3`. The stream carries text plus typed `data-products`, `data-categories`, `data-comparison`, `data-shoppingState` and `data-turnStatus` parts as appropriate. A checkpoint includes the before and after state and the user-message ID; a client can restore it after navigation or reload. Card details are resolved from the current catalog. Status can report complete, partial, provider limit or connection error, with usage and retry information when available.

The same engine has adapters for `shopping-v2` and earlier consumers. The v2 adapter emits legacy tool-result shapes and supports single-item cart actions. Earlier clients receive legacy result arrays and use product-card controls. The current UI can render validated legacy history alongside the newer data parts. Incomplete tool calls are not replayed from stored history.

The conversation is limited to 20 customer messages or 24,000 textual characters. The API validates history independently and limits incoming request size. Model context is compacted separately; these are application limits, not authentication or an exact provider-token budget. Retry resends the same user turn, while a stopped or replaced stream is isolated from later cart effects.

## Cart actions

The model may propose up to ten items only in response to an explicit add request. Application checks authorize the referenced selection and requested quantities against the request and shopping state. Ambiguous selections and ties require clarification; an unavailable item prevents the proposal. The typed action retains the legacy first `productId` and `quantity` and may include an `items` array.

An operation ID derives from the conversation and user-message IDs. The browser accepts a proposal only from the matching active stream, checks stock and line limits, and saves the cart, operation ledger and receipt in one local storage write. It reports an addition only after that write succeeds. A repeated operation is idempotent, and a multi-item operation is applied atomically. The cart remains on the device and is not an order, payment or checkout.

A failed local save offers a manual retry of that same action without another model request. Restoring history never executes it automatically. After reload, a failed action requires a fresh user request; successful receipts remain readable and the ledger prevents duplicate additions.

## Embeddings and index

The catalog has 86 products across ten categories. Each record contains a short description, fuller specifications, canonical type and kind, environment, material, dimensions, features and limitations. Purpose and detailed documents are embedded independently, averaged with equal weight and normalized. Structured browsing does not require a query embedding.

| CPU profile | Model | Pooling and query prefix | Cosine-distance cutoff |
| --- | --- | --- | --- |
| `bge` | `Xenova/bge-small-en-v1.5` | CLS; retrieval instruction prefix | 0.45 |
| `minilm` | `Xenova/all-MiniLM-L6-v2` | Mean; no prefix | 0.74 |

Both profiles use pinned q8 models and normalized 384-dimensional vectors. After structural filtering, the accepted distance is the smaller of the profile cutoff and the best eligible neighbor's distance plus 0.2. The Docker profile uses MiniLM.

A content-addressed LanceDB table fingerprint includes the full catalog, encoder identity, actual indexing documents and representation version. The explicit tokenizer loading fix does not change these fingerprint inputs, encoder revisions or vector representation. The tokenizer JSON and configuration are fetched directly at the pinned revision into the model cache when missing, then loaded with the pinned model. A populated cache can therefore support offline startup; an absent tokenizer file fails when remote model access is disabled. Local model files and tables are caches, not customer responses.

## Operations and verification

The configured provider is explicit and has no silent fallback. Per-instance admission limits count requests and retries, reset on restart and do not replace provider quota controls. Successful Groq token-limit headers inform an estimated reservation before the next inference, including simultaneous requests. Waiting is cancellable and stays within the endpoint deadline. External traffic or estimation differences can still cause a 429; `Retry-After` establishes a shared cooldown without an automatic retry. `/api/health` reports liveness, revision, embedding profile and prepared-index metadata without calling the model.

`npm run test:agent:dry` scripts native model responses while using the actual MiniLM encoder and LanceDB. The Docker smoke uses a native tool fixture and checks the container and index. `npm run test:agent:live -- <url>` exercises the configured running provider; its cart writes are simulated. Browser acceptance must separately verify the real device-storage flow. These checks establish different evidence and none guarantees future provider behavior. See the [README](../README.md) and [hosting](HOSTING.md) for commands and configuration.

A recommendation declares its planned continuation. A completed ordinary recommendation moves directly to the typed presentation tool; lookup mode remains adaptive for independent reads and comparisons. Rejected native calls and SDK tool-choice violations share the bounded correction path and finish as partial when the budget is exhausted. Captured successful HTTP response usage includes billed responses that the SDK later rejects for protocol violations, with SDK usage as a fallback. A virtual preferences citation can recall the user's typed budget without treating it as a product price.
