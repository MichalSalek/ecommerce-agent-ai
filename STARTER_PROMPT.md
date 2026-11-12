# Starter prompt for a coding agent

Copy the following prompt into your coding agent after cloning this repository.

---

You are setting up Aurelle, a TypeScript strict Next.js shopping-agent demo. Work in this repository and follow its AGENTS.md. Keep code, comments, UI and documentation in English and prices in EUR; assistant replies should follow the customer language. Do not deploy, publish, change DNS, create accounts, rotate credentials or purchase services unless the user explicitly asks.

1. Read README.md, package.json, .env.example, docs/VERIFICATION.md and the domain/application/composition contracts before changing anything. Preserve unrelated work. Use the actual scripts, not guessed commands. Check Node (22+) and platform support; native LanceDB/ONNX require a supported Linux/macOS/Windows architecture. Explain FreeBSD limitations instead of claiming a working install.
2. Run npm ci. Inspect whether `.env.local` already exists without printing secrets; never overwrite it. If it is missing, copy `.env.example` and preserve its defaults.
3. Detect chat providers without spending tokens: honor configured CHAT_PROVIDER first; inspect local llama.cpp `/v1/models` on the configured address or localhost:8080. Only inspect localhost:8090 for llama-swap if it is present. In WSL, distinguish Linux localhost from Windows localhost. Never assume the author's gateway address, Windows files, balancer or credentials exists.
4. If no provider is configured or reachable, offer the user a clear choice:
   - Local llama.cpp/llama-swap with an already available GGUF model. Explain the expected JSON tool protocol. Bielik PL 11B v3.0 Q8 was tested, but is not a universal hardware recommendation. Ask about RAM/VRAM and model files before recommending a download. A smaller instruction model is possible but needs the same acceptance checks.
   - Groq with an existing user-supplied API key and model ID (the tested balancer model is openai/gpt-oss-120b). Ask the user to place the key in `.env.local` or their secret store, not chat, logs, Git or client code. Do not create keys or accounts yourself.
   - An existing compatible Groq background balancer, only if the user owns one. Preserve its quota policy. The Windows transport is optional and only for WSL reaching Windows loopback.
   Continue useful setup while waiting, but do not pretend a missing provider is configured.
5. Run npm run catalog:prepare. This downloads the pinned BGE small q8 embedding encoder (about 34 MB) and builds real LanceDB records. This CPU encoder is separate from the chat model and needs no GPU. Keep the cache and DB out of Git; no keyword-only substitute.
6. Run npm test, npm run typecheck and npm run build for the final inputs. Start npm run dev, confirm its actual port and inspect the application in a browser.
7. Verify the complete flow: home has 48 products; category/search controls work; product pages and unknown IDs behave correctly; add to cart from both a product page and a chat card; update quantities, reload, remove; test unavailable products and malformed local storage without damaging user data.
8. With the chosen real provider, verify budget-only browsing under EUR 25, semantic coffee search with a price bound, product details, delivery policy and refusal of a Python programming request. Replay the Polish language-change -> broad home request -> alternatives -> around USD 30 -> categories sequence from tests/conversation.test.ts. Verify exclusions, category clarification, approximate-price ranking and the explicit foreign-currency confirmation. Check cards, EUR prices and product links. A successful models endpoint is not end-to-end evidence. Do not describe a fixture test as a real provider test.
9. Check desktop and 390 px mobile views, keyboard focus, overflow, empty/loading/error states and readable feedback. Make corrections within the authorized scope. Keep the visual style documented in DESIGN.md.
10. Finish with a concise report: actual URL, commands and outcomes, selected provider/model, tested vs untested paths, changed files and any specific user-only step remaining. Do not claim universal model reliability. Link any local setup changes in README/verification notes if they alter the supported workflow.
