# Initial assignment and evolution

This is an English record of the original assignment, not a claim that its older SDK snippets are current APIs.

The initial request was to clone `dilums/kimi-k3-ecommerce-storefront` into a new directory and build a small working Next.js 16 App Router / React 19 / TypeScript strict / Tailwind storefront. Keep a home page with all mock products and a shopping chat at `/chat`; remove backend-dependent checkout, account and other unused routes. Seed 15-20 varied products with ID, name, description, numeric price, image URL, product URL, category and availability.

Use the Vercel AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`) and Zod. Prefer a local llama.cpp server at `http://127.0.0.1:8080/v1`; discover the actual model ID through `/v1/models`. A cloud fallback was optional. Support models with limited native function calling through a validated JSON tool loop. The request preferred ToolLoopAgent or streamText with a maximum of five steps.

Provide three tools: `searchProducts(query, maxPrice?)`, `getProductDetails(productId)` and `getPolicy(topic)`. The initial search could be a simple text filter with no vector database. All tools needed descriptions and Zod inputs. The assistant should stay within the store's offer, refuse unrelated requests such as code generation, avoid medical/legal/financial advice, and answer concisely. Initially the prompt/UI language was Polish.

Serve UI message streams from `/api/chat`, render tool search results as actual product cards, and provide an add-to-cart button that could initially only log an event. Log important events with `[AGENT]`, `[TOOL]`, `[LLM]` and `[CART]` prefixes. Avoid verbose loops and hanging requests when the model server is absent. Verify the listing, chat route, a coffee-shopping request and a Python-code refusal in a browser. Finish with run instructions and a file inventory.

Subsequent owner decisions superseded parts of that brief: English throughout the project, EUR prices, Bielik integration, real LanceDB and a dedicated local embedding encoder, 48 products, product detail pages, a persistent localStorage cart, a Groq balancer adapter, visual refinement and recruiter-oriented architecture documentation. The first bounded JSON planner used at most one model call. The later conversation revision optionally adds a validated opening/question call, while tools still own numeric facts; pure budget requests do not need an LLM decision. See README.md for the current contract and STARTER_PROMPT.md for agent-assisted setup.
