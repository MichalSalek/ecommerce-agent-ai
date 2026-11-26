# Verification

## Quick messages in the shopping sidebar, November 26, 2026

Application revision `daae58c13e63ab94d1c7c373ff42202e3788ab47`. All ten examples are in the left column below Browse products. The mobile disclosure shows the same list above the conversation. On short screens, its last row and the composer are reachable by keyboard. Picking an example closes the list and keeps the shopper's draft. [Public shopping assistant](https://ecommerce-agent.michalsalek.com/chat)

### What the quick messages do

On the public release, Chromium clicked every welcome shortcut and sidebar example. In 28 requests across 21 scenarios, it checked rendered names, prices and stock against the 86-product catalog. Garden furniture under the inclusive EUR 150 cap narrowed from four items to three seats. Coffee alternatives introduced two items unseen in that thread. After comparing Ceramic mugs (EUR 22) with Glass carafe (EUR 19), the cheaper-option action saved two carafes once. Reload preserved the quantity. With no pair it asked which products to compare. A separate real-catalog test covered the equal-price case.

The old delivery-and-returns button sent a delivery-only question. The revised button returns the EUR 4 outward fee, 2–3 business days and the 14-day return window. The old gift example returned just a toothbrush cup. Its replacement explicitly asks for a candle or diffuser below EUR 25 and shows Cedar candle (EUR 14) and Reed diffuser (EUR 18). Product pages showed the same two prices and confirmed both items in stock. Three catalog items cost exactly EUR 25, so the general budget shortcut now says “up to €25”.

| Public quick message | Browser result |
| --- | --- |
| My morning coffee / I need something for my morning coffee | Both opened the seven matching coffee items, with five cards on the first page. |
| Garden furniture / Show me garden furniture up to €150 | Each displayed the four matching outdoor furniture records. The second carried a EUR 150 ceiling. |
| Finds up to €25 | The catalog had 43 items at or below the ceiling. |
| Delivery & returns / How much is delivery? | The first covered both subjects. The second supplied the outward fee and delivery time. |
| I need something to sit on | After the garden search it kept the chair, lounger and bench. On its own it opened the seating collection. |
| Show me different options | After coffee it showed the previously unseen grinder and kettle. In an empty thread it asked which products to look for. |
| Show me outdoor furniture, not planters | It removed the planter restriction and retained the shopper's budget. With a EUR 25 ceiling the catalog had no qualifying outdoor furniture. |
| Compare mugs and carafe | It compared the Ceramic mugs at EUR 22 with the Glass carafe at EUR 19. |
| Add two of the cheaper option to my cart | The browser saved exactly two carafes. In a new conversation the assistant asked for the two products first. |
| Show only in-stock products | It retained the current search and filtered by stock. In a fresh thread it asked for a product type. |
| Find a candle or diffuser under €25 | Both results were in stock. The card and detail-page prices agreed for each item. |

### Typed questions and the model

On a release candidate, typing both policy questions in one English message initially returned only the return window, after three successful 120B calls. Asking who paid for a return also produced the window alone. In a subsequent browser run with the real Groq service, each of six English and Polish questions took one call. The assistant supplied both published facts when requested, distinguished a delivery date from a delivery fee, and said “Sklep nie podaje kosztu odesłania produktu przy zwrocie ani tego, kto go ponosi.” A question about both return postage and the deadline received both parts.

On the first public sidebar release the shopper selected the two fragrances, changed to coffee within EUR 25, and received four catalog matches. They then asked to return to the earlier diffuser. Its record supplied the displayed price of EUR 18.00 (Groq request `req_01m8bpjv1we1fbvretn0w5a0h4`). In another thread the catalog record for Glass carafe described cold brew and gave no temperature rating. Asked “Czy w tej karafce mogę bezpiecznie podawać wrzątek?”, the assistant said “Na podstawie opisu produktu Glass carafe nie potrafię potwierdzić, jaką temperaturę wytrzymuje.” (`req_01m8bpd9s5ewjvw4wny79jwwqb`). [First sidebar release](https://github.com/MichalSalek/ecommerce-agent-ai/commit/918253543cb956d3d6734b50491e47361fda421b)

The final build also repeated the carafe and policy questions in a local shop browser on Groq 120B. For “Czy sklep podaje maksymalną temperaturę dla Glass carafe?” the model received one record with **narrow neck**, **serves cold brew** and **Glass can break if dropped**. It selected a missing specification and the shopper saw the same temperature answer (`req_01m8bsxqcxevkafbyyemm7r4qr`). Both Polish policy questions returned the expected fee, deadline or missing return-postage information.

A fresh-thread question about the shopper's project name then exposed a separate bug. The public agent tried to correct a required tool call and reached a provider cooldown. A local capture from the same revision reproduced Groq HTTP 400 with the required tool omitted. An intermediate prompt found the right project but the answer also mentioned an unrelated shopping budget. The final agent asks Groq to select a name and a supporting quote from shopper statements. It checks the name against those statements before showing it. [Project recall regressions](../tests/project-recall.test.ts)

On the final public release a shopper introduced their project as **Bursztynowy List**, then asked about it in a separate message. The answer was *Pamiętam nazwę „Bursztynowy List”.* (`req_01m8bsx68xerjrf3eej9zy0b2x`). After **New conversation**, the same question received “Nie znam jeszcze nazwy Twojego projektu.” (`req_01m8bsxrh9ek68g2dmerbf857g`). The public request contained one shopper message and no previous project name. A separate run of the same build captured the actual Groq input. Before reset it had the system instructions, the shopper's earlier message and the current question. After reset it had only the instructions and the new question. An English conversation about a colleague's project also returned unknown when the shopper asked about their own project. These last two local browser checks used a separately authorized QA credential on the same 120B provider after the store's credential reached its daily limit. The served demo kept its own credential.

In a six-turn Polish conversation on the preceding build, the assistant correctly explained its role, catalog, LanceDB search, account access and payments. For “A jaki jest mój zawód, pamiętasz?” Groq twice returned HTTP 400 because the required tool call was missing. The shopper saw an incomplete response. The final agent asks the model to select exact shopper statements that establish a name or occupation, and validates the quotes before displaying them. On the public demo the answer was *Pamiętam Twoje słowa „Jestem rekruterką techniczną”.* (`req_01m8bswkxdezp9phsf4mtz3p4k`). After reset the answer was *Nie znam jeszcze Twojego zawodu.* (`req_01m8bt5taxezja9zgxtzgbyd0n`). A six-turn Polish replay and a three-turn English conversation ran on the final build with a QA credential. When the English-speaking shopper changed from teacher to librarian, the assistant used the newer statement. [Shopper identity regressions](../tests/shopper-identity.test.ts)

On the final public build, the first completed answer in a new conversation to “w czym możesz mi pomóc” was “Jestem asystentem zakupowym Aurelle. Mogę przeszukiwać katalog, porównywać produkty, sprawdzać dostępność, ceny, materiały oraz zasady dostawy i zwrotu, a także dodawać wybrane artykuły do Twojego koszyka.” (`req_01m8btkfrnefxvxwwmx9xvwkq4`). After a simulated HTTP 429, the browser kept the thread and original message ID. Clicking **Retry** produced “Jako asystent Aurelle pomogę Ci znaleźć produkty, porównać je, sprawdzić dostępność, ceny i szczegóły, a także dodać wybrane pozycje do Twojego koszyka.” (`req_01m8btzn9ve1vsrrsj0jekh4ha`). The dedicated organization also reached its actual 200,000-token daily limit during this run. Chromium waited for each countdown and retried the original question. Each question appeared once in the thread. The same initial question on the preceding release had completed on its first attempt (`req_01m8bs0vsrew6tvmk17e7pp98p`). All seven sampled Groq inferences on the final public release reported `openai/gpt-oss-120b`. The explicit shortcuts used zero model calls. Reload preserved history in the same tab. A new tab started empty, and migration removed only the old local history entry.

**Verification.** Chromium made 28 public chat requests across 21 scenarios and passed 320 assertions. All 385 unit and integration tests, including 76 focused agent checks, and all 46 Chromium regressions passed. TypeScript, the production build and both CI jobs passed, including the 512 MiB container check. The public health endpoint reported 86 products and the prepared MiniLM index. After a legacy gift query loaded the semantic index, Render supplied 11 memory samples with a sampled high of 199.4 MiB during 633 seconds of observation. The monitor reported up. The credential scan found no matches in the public HTML and assets, Git objects or the 330 examined service log records. [Application CI](https://github.com/MichalSalek/ecommerce-agent-ai/actions/runs/45810387855)

## Shopping conversations on the public demo, November 25–26, 2026

The application release is `ff788b7ab355630fa0db39ce7e8544ed0719a7e9`. The browser sends the current conversation to `POST /api/chat`. The store agent obtains catalog or policy evidence through its tools and calls Groq directly at `api.groq.com` using a server-side credential. Every inference requests `openai/gpt-oss-120b` and checks the model ID returned by Groq. Explicit catalog buttons can read the catalog without inference. [Open the shop chat](https://ecommerce-agent.michalsalek.com/chat)

### What the agent knows

The role, visitor, tools and data boundaries have one instruction source. On the final build a visitor asked whether the assistant knew their name or profession. It replied “Nie znam Twojego imienia ani zawodu – nie podałeś ich w tej rozmowie.” The visitor then introduced themselves and asked about prices. The assistant distinguished the LanceDB search index from the catalog that supplies product pages. At the fourth turn it answered “Pamiętam, że powiedziałeś, iż jesteś rekruterem testującym demo.” Groq returned `req_01m8ak9qtvejf9n8hypfsd59sg` for that turn. [Shared instructions](../src/application/chat/assistant-instructions.ts)

### Conversation evidence

- In an independent browser replay before the fixes, the Polish capabilities question returned five of 86 products. In the owner’s incident the first request used 120B and called product search. Six seconds later, a minute-limit fallback took the retry to Qwen 27B. The customer saw “Możesz mi pomóc w szukaniu produktów”. The historic first attempt has no terminal failure record. The old primary credential was already separate, but the old fallback matched a scanner credential. Groq reported a different owning organization for the new store credential and for each of the five scanner credentials. Independent organization assignments establish separate Groq rate-limit pools. [Groq rate limits](https://console.groq.com/docs/rate-limits)
- In a browser conversation with 120B, the shopper changed plans from drinking hot coffee to serving cold brew. Interpretation received the prior customer and assistant messages as separate roles. Comparison received the earlier hot-coffee request and two records. The Ceramic mugs record lists handles for hot drinks. The Glass carafe record lists serving cold brew. Groq wrote “Polecam Glass carafe, bo służy do podawania kawy parzonej na zimno. Ceramic mugs mają uchwyty do gorących napojów.” The shop displayed the same wording. The Groq response on the published build was `req_01m8ak1qwhejsrjv32cm7gtg21`.
- On “Czy w tej karafce mogę bezpiecznie podawać wrzątek?” retrieval returned glass, 25 cm height, a narrow neck, cold-brew service and a breakage warning. The record contains no temperature rating. Groq classified the fact as missing and the shop displayed “Na podstawie opisu produktu Glass carafe nie potrafię potwierdzić, jaką temperaturę wytrzymuje.” The detail response was `req_01m8ak36n5eajswmk9nmvxj3jx`.
- A real 120B comparison once called the carafe a single piece without handles. Per-product validation now accepts only statements supported by the matching product record. Separately, after all matching garden seats had been shown, a model once said it had found none. An exhausted list now explains that all matches were already shown and offers to revisit them or change criteria. In a subsequent garden thread, the cap stayed at EUR 150 when the shopper narrowed four furniture choices to three seats, compared two, asked for alternatives and returned to an earlier chair. Its load limit remained unconfirmed.
- The shopper also asked whether adding mugs would charge a card. Early 120B replies falsely placed payment at a later checkout. After the change, the agent answered “Nie, dodanie kubków do koszyka nie obciąża Twojej karty” and explained that the cart is saved in the browser. Standard questions about delivery and returns each took one 120B call and read the published EUR 4 / 2–3 business days and 14-day policies.

- During the public Polish help thread, “Szukam ceramicznych kubków do kawy” initially failed before the catalog read. A replay of the same messages showed Groq rejecting its own `type` and `material` tool call. In a second observed attempt it passed the dictionary forms *kubek* and *ceramiczny* for the inflected shopper wording. The tool now accepts a catalog material, checks it against the actual request, and normalizes an unambiguous product type. In both languages, the corrected browser search returned **Ceramic mugs, EUR 22** as its sole match. The steel travel mug and ceramic coffee dripper each met only one condition. The later wording “Szukam ceramicznych kubków, najlepiej białych” initially let the steel mug back in. The material requirement now survives a separate colour preference, and the assistant can identify the missing colour in the record.
- A public description of Folding garden chair claimed that the slats ensured durability and good ventilation. Its record says *folding frame*, *slatted seat and back*, *powder-coated steel* and *sold individually*. For an open-ended single-product description the model now selects distinct statements from that product's facts. Specific questions still get the underlying product record and can identify a missing specification. An affirmative claim about ventilation needs evidence beyond the presence of slats. All 64 distinct recorded limitations are available to the model as customer-facing statements in Polish and English. A separate correction keeps the seating group when the model repeats the previous outdoor furniture filters and omits the shopper's new need. [Single-product regression](../tests/search-advice.test.ts)

- A first-time visitor asked “Gdzie po użyciu przechowywać poduszki z Patio sofa?”. On one 120B run the model searched for a cushion storage bag and showed five unrelated products. The final application reads the named sofa before requesting care advice. The model received its recorded limitation *Store cushions under cover when not in use*. The visitor saw “Produkt Patio sofa ma poduszki, które po użyciu należy przechowywać w osłoniętym miejscu.” When asked whether this protected the cushions from every downpour, the assistant said it could not confirm rain protection from the record.

### Browser state, catalog and limits

A persistent Chromium profile kept a distinctive EUR 43 budget and navy thermos reference across reload. A second tab in the same profile started empty despite a legacy `aurelle.conversation.v1` entry in local storage. Migration removed that old history only. Unrelated storage and the device cart survived. After **New conversation**, the first real provider request contained the `system` instructions and a single `user` message with the fresh budget question. The previous amount and product were absent. The live shop also retained a carafe through cart reload and chat reset.

In a production-build browser simulation the adapter received HTTP 429 and then HTTP 200 for both a new typed message and optional advice on an existing search. The UI showed the cooldown, allowed a manual retry when the wait ended and retained the original message ID, thread ID and all five catalog cards. A genuine public retry used Groq 120B after a single simulated browser-side admission refusal. The customer’s question appeared once. A controlled EUR 37.45, out-of-stock test record propagated through real LanceDB, model evidence, a rendered chat card and the product page. The public carafe appeared at EUR 19.00 in chat and on its product page. [Catalog source regression](../tests/catalog-source.test.ts)

### Release checks

The final application passed **329 unit and integration tests**, including 76 focused dry agent checks. Type checking, the production build, all **45 Chromium tests**, and the source and 512 MiB container jobs succeeded. Render marked deployment `dep-dc3nddei0phs73fvk9qg` live at 2026-11-26 00:02:23 UTC. Public health reported 86 products and the prepared MiniLM index. A ten-card catalog request completed without inference. [Release CI](https://github.com/MichalSalek/ecommerce-agent-ai/actions/runs/45725305368)

| Public Chromium action | Groq response ID | Customer-visible result |
| --- | --- | --- |
| First “w czym możesz mi pomóc” | `req_01m8ajk077edxbt3xmfvjqys40` | Jako asystent Aurelle pomagam znajdować produkty, porównywać je, sprawdzać dostępność, ceny i specyfikacje, a także dodawać wybrane pozycje do Twojego koszyka. |
| Retry of the same message after a simulated HTTP 429 | `req_01m8ajmhq9eqssskkdznmdnndr` | Jestem asystentem zakupowym Aurelle. Mogę przeszukiwać katalog, porównywać produkty, sprawdzać dostępność, podpowiadać ceny, dostawę i zasady zwrotu oraz dodawać wybrane artykuły do Twojego koszyka. |
| Explain differences for mugs and carafe | `req_01m8ak4jdme7ftdfgcgbe99494` | Ceramic mugs have handles for hot drinks. Glass carafe serves cold brew. |
| Where to store the Patio sofa cushions | `req_01m8akham6e6btvt0qe4rsz36q` | Produkt Patio sofa ma poduszki, które po użyciu należy przechowywać w osłoniętym miejscu. |
| Required ceramic mugs with an optional white colour | `req_01m8ams14te3evg198j3aw3jmq` | One matching card, Ceramic mugs at EUR 22.00. The optional explanation was unavailable. The catalog result stayed visible. |

The material search hit the actual Groq daily token limit. Chromium kept one public tab open through three provider refusals and clicked Retry when its countdown expired each time. The fourth attempt displayed one Ceramic mugs card at EUR 22.00. All four requests carried the same conversation and user-message IDs, and the shopper’s question appeared once. The browser attempt, server inference and Groq response agreed on `openai/gpt-oss-120b` for all five actions. Their successful calls used 6,896 uncached input plus output tokens on the dedicated credential. For this release the owner authorized live testing against the credential’s full rolling allowance. During verification the shop encountered its own 200,000-token daily limit and displayed the provider’s retry interval.

On revision `8e596f5`, seven real Chromium conversations completed **30 turns** and 278 assertions with 52 successful Groq 120B inferences. They exercised paraphrases, narrowing the selection, comparisons, a change of mind, earlier results, missing specifications, shop and account access, and payment questions. The final source changed a care-question path. A compatibility check confirmed that none of these 30 inputs activated a changed condition. The published application build received fresh 120B tests for both care phrasings, an unrecorded rain rating, a recruiter’s identity and the sources of prices, a four-turn change of coffee preference, a six-turn garden-furniture search, and model history after reset. These six fresh browser conversations covered 21 customer turns and 35 successful Groq 120B inferences. The local shop copies used separately authorized credentials. One of those organizations hit its daily limit during optional comparison advice. The repeated test retained the same model and used available authorized test organizations. A test-only Qwen 27B run covered four threads, 17 turns and 32 successful inferences. The public app used its own Groq credential.

After a public semantic search loaded MiniLM, Render returned 11 memory samples from 2026-11-26T00:02:45Z through 2026-11-26T00:12:45Z. Peak sampled memory was 158.7 MiB. Render recorded no service events in the observation window. The existing Better Stack monitor reported UP. The source, Git objects, browser bundles, served assets and inspected server logs contained zero matches for the store key.

## Shopping chat investigation, 2026-11-25

At 20:06:36 UTC the public chat handled the owner's Polish capabilities question with GPT-OSS 120B and called `searchProducts`. At 20:06:42 the same operation took the minute-limit fallback to `qwen/qwen3.8-27b`. The owner saw the roles reversed in the second answer. The first request has no terminal failure record, so its exact visible error and attribution to a particular scanner run remain unknown. An independent pre-change browser run sent just one user message after reset and received five unsolicited products from 120B.

The previous primary credential was separate, while the fallback shared a credential with a background application. The replacement authenticated directly with Groq. A separate test-only Qwen request exceeding the per-request token allowance was rejected before generation. Groq supplied the owning organization in its response for the replacement and every scanner key. Comparison confirmed five distinct scanner organizations, all different from the shop's organization. No account identifiers or secret values are stored in this repository. Groq applies overall limits per organization. [Provider rate limits](https://console.groq.com/docs/rate-limits)

A real browser using test-only `qwen/qwen3.8-27b` exposed two further issues. A capabilities paraphrase spent two full inference contexts and could hit its input-token limit between them. A five-turn coffee conversation retrieved the correct carafe but answered a maximum-temperature question with the generic cold-brew description. The new capabilities tool can complete in one inference. Detail questions use canonical catalog fields and retain the selected product when a fact cannot be established.

A separate real-provider check saved a distinctive 43 EUR budget and reloaded the tab. A fresh tab in the same browser profile started empty with legacy history present before navigation. Only the legacy chat entry was retired. After New conversation, the first actual provider request contained the system instruction and the new customer question, with no previous budget, product marker or user/assistant exchange. The browser preserved unrelated storage and the cart.

### Reproduced conversations and checks

In the original public run, the capabilities question on 120B opened a catalog search. A second public browser reproduced the behavior with one user message after reset: "Pokazuję 5 produktów z 86 pasujących do kryteriów." The incident retry used Qwen and the customer saw "Możesz mi pomóc w szukaniu produktów". The old protocol had no capabilities tool or first-person validation and embedded its two recent messages inside a single user message.

In local test mode, an actual Qwen conversation searched for coffee items, narrowed the budget to EUR 25, compared Ceramic mugs and Glass carafe, switched to the mugs, and returned to the carafe. The comparison displayed EUR 22 and EUR 19 respectively. The last customer question asked for the maximum temperature. A catalog read returned `carafe`, glass, 25 cm high, narrow neck, suitable for cold brew, and a warning about breakage. The catalog has no maximum temperature. The early response restated the cold-brew description in English. After correction the chat said "Na podstawie opisu produktu Glass carafe nie potrafię potwierdzić, jaką temperaturę wytrzymuje." The preceding comparison and selection were present in the role-labelled model context.

In a separate source-of-truth regression, a temporary EUR 37.45 / out-of-stock record produced the same price and availability in the actual Lance repository, model evidence, chat card and rendered product page. The test restores the record. The provider fixture emitted a genuine-shaped 429 with Retry-After and then a successful response, once for a normal turn and once for optional advice. Chromium kept the same conversation and user message IDs on retry, showed the countdown and retained exactly five original cards.

The first candidate passed 245 unit and integration tests, strict TypeScript, the production build and 41 Chromium tests. The 76 dry agent/adapter checks are included in the 245. The secret scan found zero occurrences of the shop key among 268 source/candidate files and 19 browser assets.

On the first public candidate, Groq reported `openai/gpt-oss-120b` for the original Polish question and the same question after Retry. A third public comparison on that model exposed an additional factual error: the generated advice called the carafe a single piece without handles. Neither attribute occurs in its record. The application now validates comparison claims against the individual product and uses known materials if the proposed wording adds a fact. A browser replay of the actual English response and a Polish variant displayed the catalog materials for the mugs and the carafe. An eight-turn category-switching test also exposed a price request without a question mark and an inherited furniture kind represented as a department during a seating refinement. Both cases have dedicated regressions.

## Reliable shopping outcomes, 2026-11-16

Application revision: `e7f98a3c9e6fe6519dc1fc315b893a5332264d0d`. Public URL: [Aurelle](https://ecommerce-agent.michalsalek.com). Local, CI, public functional acceptance and the ten-minute runtime observation passed.

Catalog operations now have an independent outcome from optional model advice. A rejected comment leaves the canonical products, comparison, counts and continuation available. Structured controls and known cart selections do not initialize the model. Language follows the current customer message; cart clarification uses a bounded server-owned intention, and browser receipts follow the atomic device write.

## Integrated checks

- `npm test`: **214 passed**, including actual MiniLM/BGE retrieval, provider fixtures, legacy history and the reproduced shopping/cart failures. Strict types and the production build passed.
- Chromium E2E: **33 passed**, including cooldown/catalog independence, every starter/example action, Stop/reset, stored history, cart-write failure, retry and reload.
- [Same-revision source and container CI](https://github.com/MichalSalek/ecommerce-agent-ai/actions/runs/43924416642): both jobs passed. The real container used 512 MiB and 0.1 CPU; cold concurrent requests peaked at 170.8 MiB, and index rebuilding peaked at **312.3 MiB**, with no OOM.
- Correct-profile local Qwen acceptance covered **33 scenarios / 75 turns**: six bilingual families, four starters, ten examples, counts 4/5/10/20/all, comparisons 2/5/10, the original reported flow and a twenty-turn Polish conversation. Canonical facts, the mugs/carafe comparison and two saved carafes were inspected separately from language/status assertions.

The local router was found to force thinking/xhigh despite the request setting. QA used its existing documented upstream passthrough with the same Qwen GGUF, and a probe verified actual text with zero reasoning. Shared router configuration was unchanged. Engine QA has a longer functional boundary; it does **not** establish thirty-second HTTP latency. Production retains that deadline.

Evidence was reused only after scoped compatibility checks. The completed full run is `/tmp/aurelle-engine-overview.json`. Final output guards changed four source files; `/tmp/aurelle-final-evidence-validation.json` pins those files, proves unchanged inference/control flow, checks 69 retained turns and 61 identical canonical summaries, and preserves the other 32 scenarios plus the first fourteen long-conversation turns. `/tmp/aurelle-final-twenty.json` contains that verified prefix and six freshly executed final turns. The final comparison correctly remains completed when an unsupported claim that prices are missing is rejected. A separate Bielik text-only probe returned a complete Polish description with zero reasoning; it is not native-agent conformance evidence.

## Groq allowance and public behavior

All release attempts share one 8,000-token ledger. Actual uncached input plus output totals **7,053**, leaving **947**. This includes the earlier free-message canary (1,995), intermediate advice attempts (3,970), accepted compact advice (305), public overlong advice (475) and accepted public advice (308). No failed attempt was removed or given a new release budget. The earlier free-message path was reused; the final public model check exercised explicit advice on the deployed revision.

Fresh provider logs identify `openai/gpt-oss-120b`, primary route, for both public advice requests. A 529-character response to the five-product comparison was withheld; the comparison and its operation ID remained intact, with one advice-only retry and no retry of the whole message. A second, 267-character response for mugs/carafe was displayed and manually checked against material, features and limitations. The fallback route was exercised by deterministic failure fixtures, rather than deliberately exhausting the live allowance.

The fresh isolated public browser ran coffee → comparison → advice → new conversation → coffee → comparison → details → “Dodaj do koszyka ten produkt, fajny jest”. It saved one dripper, one operation and one receipt. Reload issued no chat request and preserved the exact cart/receipt; cart navigation and Back preserved them too. The cart showed EUR 18 items + EUR 4 demo delivery = EUR 22. The 390 px viewport had no horizontal overflow and a reachable composer. Browser-rendered Polish and apostrophe encoding were correct. Screenshots are `/tmp/aurelle-public-desktop-cart.png`, `/tmp/aurelle-public-mobile.png` and `/tmp/aurelle-public-mobile-cart.png`.

## Publication and observation

Render deployment `dep-dbtkbabl550s73dhpf7g` became live at `2026-11-16T18:06:40Z` on the existing Free service. Origin and public health checks identify the exact revision, 86 products and MiniLM fingerprint `24709dc1df1fee04`. Cache purge affected only the demo hostname; four documents and 101 assets were verified and warmed. The deployment verifier completed a ten-card structured turn with zero inferences. A separate actual semantic gift query loaded MiniLM before observation.

After the actual MiniLM query, observation ran from `18:10:42Z` through `18:21:16Z` (635 seconds). Render returned eleven memory and CPU samples spanning ten minutes on the same instance. Memory ranged from 140.1 to **204.6 MiB**; CPU ranged from 0.0010 to 0.0095 cores. There were no provider events during that window and no restart/OOM evidence. Sampled public health checks returned HTTP 200 with the expected revision; the existing Better Stack keyword monitor remained UP in the checks, with its final recorded check at `18:19:28Z`. The deployment still reported the exact accepted commit and live state. The private aggregate is `/tmp/aurelle-final-runtime-summary.json`.

These checks establish a bounded accepted demo release. Model interpretation can still be wrong, invalid advice can be omitted, provider quotas can block AI, and Render Free has no availability guarantee. Catalog controls and known cart operations remain usable during AI cooldown. The monitor checks web health, not every model response or provider allowance.

The records below describe earlier releases and are historical.

# Shopping-v2 acceptance

The current source adds 86 catalog records across ten categories, 38 individually generated WebP assets, structural search and device-local cart actions. The catalog census preserves the original 48 IDs, prices, stock states and image paths.

- BGE and MiniLM preparation passed with 86 products. Current fingerprints are `5827abe4ad9924bd` and `24709dc1df1fee04` respectively; the build manifest and `/api/health` identify the prepared runtime table.
- `npm test`: 68 assertions/subtests passed, including actual LanceDB with both encoders, expected and counterexample products across all ten categories, legacy wrong garden cards, exhaustion, canonical cart selection and stable operation IDs.
- `npm run typecheck` and `npm run build` passed. All 86 product pages are generated.
- `npm run test:e2e`: 14 Chromium cases passed. They cover history/drafts, navigation, desktop/390px viewport, legacy cards, repeated events, Retry/reload, cancelled/reset conversations, failed storage and the 99-unit limit.
- A direct Groq 120B and MiniLM API acceptance exercised the visible examples, Polish/English garden refinements, all six outdoor furniture products through exhaustion, topic change, actual comparison, cart-action Retry identity and missing products/attributes. This is an observed acceptance sample, not a guarantee of future model accuracy.
- The built application passed `verify:deployment` locally, including the 86-product manifest, actual retrieval and legacy search arrays. Production publication additionally requires same-commit green source/container CI, exact Render revision, scoped hostname cache invalidation and fresh browser cart acceptance.

Local Docker Desktop is unavailable in this WSL distribution. The release uses the actual GitHub container job for the same commit, with the existing 512 MiB/0.1 CPU smoke. Model availability is a separate runtime check.

Generated assets are in `public/images/products/`; [prompts and encoding provenance](IMAGE_GENERATION.json) record all 38 new photos. Existing photos were preserved. Screenshots are local verification artifacts, not repository assets.

The prior release records below are historical. Their smaller catalog, expanded/collapsed guide, narration and latency observations describe those earlier revisions only.

# Current verification evidence

Last checked: 2026-11-13. Older intermediate behavior and failures are preserved in Git history; this file describes the accepted refinement.

## Environment and gates

- Development: Linux x64 / WSL, Node 24.15; production container: Linux x64, Node 22.
- `npm test`: **15 passed, 0 failed**. Includes actual BGE/MiniLM embeddings and temporary LanceDB tables, persistence/refresh, budgets/currency/context, tool protocol/provider fixtures, cart rules and admission controls.
- `npm run typecheck`: passed (`next typegen` and strict TypeScript).
- `npm run build`: passed, including all 48 product pages and dynamic chat/health routes.
- `npm run test:e2e`: **5 passed** on the actual standalone production launcher.
- `npm audit`: zero reported dependency vulnerabilities at this checkpoint.
- CI has separate source/browser and constrained-container jobs. Cloud services were not created by these checks.

## Reported UX regressions

The browser suite uses an intercepted AI SDK UI stream to isolate UI behavior without spending model quota. It proves:

1. Enter submits; Shift+Enter inserts a line without a request.
2. Product navigation -> browser Back and full reload retain messages, product cards and draft.
3. New conversation during generation stops the old response, clears the old topic, restores the welcome state and prevents a late old reply from leaking into the new chat.
4. Mobile at 390 x 844 has no horizontal overflow and keeps the composer reachable.
5. Incoming replies do not pull a reader away from older messages; jump-to-latest works.
6. Failed product photos show a meaningful fallback while product actions remain usable.

The five tests combine those cases. IME composition is guarded in code but was not accepted on a real IME/mobile keyboard. The normal welcome message is local, not a model request. Root ownership retains an active conversation across route transitions; localStorage retains settled messages/draft across reloads. Restored cards use canonical current prices, not values from browser storage.

## Agent and retrieval behavior

A regression fixture returns the original question-only coffee response (`respond`), while the engine must still perform search and show two actual options. The clear purchase route uses real retrieval before a narrowing question. Product IDs are not hardcoded into its answer.

The Polish test -> language request -> broad home request -> alternatives -> around USD 30 -> categories sequence passed against real LanceDB and in a real-provider browser session. Broad home queries return two examples and a category question; alternatives exclude shown IDs. Approximate home-price ranking includes the EUR 32 vase near EUR 30, rather than treating the target as a maximum and returning a EUR 14 candle. Foreign currency examples explicitly request EUR-budget confirmation and are not represented as exchange-rate conversions.

Category discovery has its own actual-data tool. Invalid model action output asks for clarification. Optional narration supplies only an opening/question, has an eight-second deadline and rejects numeric price/currency/URL contradictions. Its absence does not discard successful tool results. Model context is compacted separately from visible history. Retained explicit language choice wins over generated English starter wording.

Live checks used **Groq / openai/gpt-oss-120b through the existing owner balancer**, including actual coffee retrieval/narration, an LLM-selected delivery-policy tool and category discovery. One Spanish coffee-search turn also produced Spanish narration. Polish/English are the grounded fallback locales. A separately supplied direct cloud key on Render has not been accepted yet. The local llama.cpp/Bielik adapter and its validated legacy envelope parser remain supported; this UI refinement does not claim a fresh complete Bielik conversation acceptance matrix.

## CPU profiles and container

- BGE q8: pinned revision `ea104dacec62c0de699686887e3f920caeb4f3e3`, CLS pooling, normalized 384 dimensions, retrieval prefix, cutoff 0.45.
- Smaller MiniLM q8: pinned revision `751bff37182d3f1213fa05d7196b954e230abad9`, mean pooling, normalized 384 dimensions, no prefix, cutoff 0.74.
- Both have distinct model identities/table fingerprints. MiniLM required its own cutoff; applying BGE's cutoff produced false negatives. Native tests cover coffee, music, irrelevant intent and price filtering.

A real image passed with `--memory=512m --memory-swap=512m --cpus=0.1`, including homepage/product routes, production image optimization and real MiniLM/LanceDB retrieval. The smoke deliberately uses an offline LLM URL: it proves retrieval/packaging and safe narration fallback, **not cloud LLM availability**.

Latest preflight samples:

| Scenario | Elapsed | Observed working memory |
| --- | --- | --- |
| Baked index -> query | 6.4 s | 134.2 MiB |
| Remove index -> restart -> recreate all 48 records -> query | 9.1 s | 166.7 MiB |

The container was not OOM-killed. These are sequential local working-memory samples, not peak/concurrent Render measurements or an uptime guarantee. Earlier runs were around 129-166 MiB. CPU-only pruning and standalone tracing reduced the initial 3.63 GB image to roughly 820 MB. Explicit dynamic ONNX tracing is retained and exercised. Every temporary smoke container is removed.

## Hosting boundary

Render CLI v2.20 returned `valid: true` for `render.yaml`; validation did not provision the planned service. No account, application, DNS record, monitor or status page was created. The executable handoff is [RENDER_FREE_PLAN.md](RENDER_FREE_PLAN.md).

Read-only checks of an existing project previously confirmed Render Free, HTTP liveness, external health/database checks every 180 seconds and a separate scheduler clock every 1800 seconds. No existing project's monitoring or quota policy was changed. Liveness does not prove model availability; the deployment verifier includes a real LLM tool-call scenario for that reason.

## 2026-11-13 stability, conversation lifetime and traceability

The existing owned Turbopack dev process failed an HTTP `/chat` timeout and was observed near 3.8 GiB RSS. It was stopped and replaced with Webpack development, isolated under `.next-development`; production still builds under `.next`. Actual `/chat` and `/` requests then returned 200, and the browser replayed shopping successfully. This is evidence of the old process's failure and the new path's recovery, not a proven upstream memory-leak diagnosis.

The real 29-dollar home request returned vase cards, explicit EUR confirmation, and a trace with zero LLM calls / 96 ms stream execution / responseCache false. The whole development POST logged about 579 ms. Existing table/weights/inference-session reuse is distinct from answer caching, which is not implemented.

A 20-user-turn or 24000-text-character conversation policy closes the composer, warns near the turn boundary and requires a new topic while preserving the cart. The API independently rejects excessive input before runtime/model execution. Browser acceptance restores a full saved transcript, verifies the locked input/send state, and starts a new conversation successfully. This is a heuristic lifetime cap, not exact tokenizer accounting or secure identity tracking.

The reported vase/material-durability scenario was inspected with real Groq: the earlier connection failure did not reproduce, so its historical cause remains unproven. Added a grounded handler stating the missing durability evidence rather than inventing resistance. A deterministic fixture verifies no LLM dependency for that specific evidence question. Manual retry is covered by an HTTP-503-then-success browser test: same request context, one user message, successful second response. No automatic provider switching/retry loop was introduced.

Final source acceptance: 17 unit/native integration tests, 7 Playwright production-browser tests, strict type generation/check and production build passed. The model-context compaction limits remain independent from the new visible conversation lifetime. Technical interview guidance is in AGENT_ARCHITECTURE.md. Separate NEXT_PROJECTS.md contains proposals only; the home-site source was inspected read-only and was not changed.

## Discovery extensions and recruiter walkthrough

Added compareProducts with two/three distinct IDs, canonical record resolution, missing-ID reporting and deterministic pairwise price difference. Actual mugs/carafe comparison produced a EUR 3 difference and both product cards. Comparison parts survive a reload via the same schema/canonical-product restoration as search. A browser regression clicks the advertised comparison scenario from the demo guide and verifies the resulting cards plus reload persistence.

Added inStockOnly as a real LanceDB boolean filter, independent of vector relevance. Stock-aware follow-ups retain earlier criteria. Gift browsing returns two available records within budget and asks for recipient/preferences; it does not claim that a generic gift is personalized already.

Manual browser checks on the actual development server exercised comparison, gift budget and stock follow-up with no error alerts. The public chat page now states that all catalog records/prices/stock/policies are mock data, that no orders/payments occur, and provides eight clickable capability scenarios plus persistence/retry/context boundaries. The guide was inspected at desktop and 390 px mobile; there was no horizontal overflow. Source code and UI do not represent structured routing as an LLM call on every turn.

Acceptance for the discovery extension: 18 unit/native integration tests passed, 8 Playwright tests passed, strict types and the production build passed, dependency audit reported zero vulnerabilities. The capability-guide screenshot reader returned SHIP; this was a visual/comprehension verdict only. Actual scenario buttons and tool results were exercised separately in manual and automated browser checks. The guide's stock example can run either after a search or on its own, and comparisons retain canonical product cards after reload.

## Public Render acceptance - 2026-11-15

Application SHA `b4d408ee9096ad6b7a1fb71a471014a7fb0e4922` is live at https://ecommerce-agent-ai-bpah.onrender.com. Render reported deploy `dep-dbsr8qnf3r2c73b5klhg` live. `verify:deployment` passed real retrieval, direct Groq policy-tool selection and category discovery. Headless Chromium against that origin passed navigation/Back, history/draft reload, cart quantity persistence, conversation reset preserving cart, Shift+Enter and 390px geometry; no page errors. A Polish request completed.

A controlled restart returned HTTP 200 from the provider; deployment verification passed again afterwards. Initial provider memory samples were 393097200 and 441077760 bytes. These are samples, not a measured peak. Physical-device/IME and actual sleep/idle suspension have not been tested.

Better Stack monitor `5239952` checks liveness every 180 seconds on the BV account; it does not spend model tokens. Source remained unchanged; later docs-only commits require no application rebuild.

## First-visit and reported conversation follow-up - 2026-11-15

Release `332997d356e7cbdbb0f3beb1732f938cff48879b`, Render deploy `dep-dbssd4jl550s739bnkd0`, passed all GitHub source/browser and container jobs. Live custom domain: https://ecommerce-agent.michalsalek.com. The source commit includes static WebP delivery,23generated photographs replacing product SVG references, a viewport-sized chat and concise expandable examples.

A fresh Chromium session loaded homepage plus all49image elements in1223ms with no request/page errors. The exact Polish coffee-grinder request and follow-up ending `.lo` completed in106ms/197ms; product card add-to-cart and reload persisted. Tall desktop and390px mobile chat geometry passed. These are observed samples, not universal latency guarantees.

An uncached AVIF conversion on the previous release took3169ms, while its readyWebP source took120ms. Runtime transcoding is now disabled. Actual initial missing-assets failure was not captured; a provider process restart was visible near the user's report, but its exact trigger remains unproven. The monitor recorded a missing health keyword at14:17UTC.

Cloudflare scopes caching to the new hostname, excludes API requests and honors origin cache headers. API health returns DYNAMIC; a verified hostname-prefix purge replaced oldHTML after URL-only purges proved insufficient. `warm-deployment.mjs` rejects HTML loading responses in place of assets. Origin liveness monitoring remains active; RenderFree still provides no always-on guarantee.

Final cache/navigation acceptance also covers public static RSC payloads with full Next-validated `_rsc` query keys. This was added after a browser idle-wait was held by background prefetches during the first restart probe. HTML and RSC variants remain separate; invalid/missing RSC hashes reach Next for validation. After warming, three fresh browser contexts during another controlled Render restart loaded complete visible HTML/CSS/scripts/all49images in523/337/336ms, with no page or HTTP errors. API chat availability remains dependent on the origin/provider; this is not a free-tier uptime SLA.


## Shopping-v3 candidate - 2026-11-16

The candidate replaces the earlier planner with sequential native tools, typed state/checkpoints, canonical result counts, ten category cards, comparisons of up to ten products and atomic multi-item cart actions. The source includes the homepage assistant hero. Product, price, stock and policy data remain authored demo data.

Final local checks passed: 119 unit/integration tests, 54 dry-agent/adapter tests, strict type checking, the production build and 23 browser E2E scenarios. The dry agent uses actual MiniLM and LanceDB with controlled model responses; browser E2E mocks the API. These checks cover the native completion boundary, canonical selection and budget evidence, foreign-currency rejection, requested page sizes, independent lookups, failed local saves, idempotent retry and additive history restoration.

The actual previous application readers restored the extended v1 cart lines, operation ledger, receipts, conversation text and draft. Those reader sources are identical between the previous production commit `c299a90497a714db1e02f6a5d9ac4e14239c1f39` and the hero commit `c56bfcc` used for that check.

Earlier in this candidate's development, a fresh 390px Chromium session using actual Groq compared mugs/carafe, added both with one cart operation, reloaded without a duplicate addition, visited product details and returned, opened the cart and started a new conversation without losing its lines. No page errors or horizontal overflow were observed. Later completion/evidence changes are covered by the final controlled tests; that earlier browser session does not establish final-source live acceptance.

The full real-provider suite remains open. A run stopped during Polish stock refinement after repeated reads and an SDK tool-choice violation; the final source introduces planned recommendation completion, bounded protocol-error recovery and canonical current-selection evidence. A subsequent probe reached the provider's daily token quota. At 04:41:36 UTC, the sanitized upstream diagnostic reported tokens/day, limit 200,000, used 199,453, requested 2,390 and Retry-After 797 seconds. The minute quota still had capacity. This is a provider organization quota; that retry time permits another attempt and does not establish a complete quota reset. See [Groq rate-limit semantics](https://console.groq.com/docs/rate-limits).

Release gates remain open: the complete bilingual provider run including the twenty-turn conversation, publication to main, exact-SHA Render deployment, final production browser/semantic acceptance, scoped cache purge/warming and ten minutes of provider observation. Production continues to identify `c299a90497a714db1e02f6a5d9ac4e14239c1f39`; no candidate deployment, provider restart, account change or quota upgrade was performed.

Source commit `49ef76fd6640c347fea8fe918427d583ff54847d` passed both jobs in [CI run 43806087904](https://github.com/MichalSalek/ecommerce-agent-ai/actions/runs/43806087904). Its actual Docker smoke used 512 MiB and 0.1 CPU: concurrent cold structural/semantic requests completed in 8.7 seconds with a 170.0 MiB cgroup peak; the missing-index rebuild completed in 18.5 seconds and reached 312.1 MiB. No OOM was observed. The container model was the controlled native fixture, so this result leaves the real-provider release gates above open.

After honoring the provider cooldown, a focused real-Groq Polish stock-refinement probe passed on the final application source at 04:55:33 UTC: one inference, five canonical selection cards, retained Polish/stock criteria and 1,974 uncached input/output tokens. The subsequent full-suite attempt was blocked on its first conversation by the daily quota: 200,000 limit, 199,204 used, 2,011 requested and Retry-After 525 seconds. This focused pass leaves the complete conversation suite open.

The candidate also preserves the independent README link fix from main. Merge commit `182e17c1cf8a69e11b038457c814de2e0db81350` passed both jobs in [CI run 43806563448](https://github.com/MichalSalek/ecommerce-agent-ai/actions/runs/43806563448), with a 313.3 MiB container peak and no OOM. Its application sources match `49ef76f`; subsequent evidence-only documentation does not change the application behavior.

## Shopping-v3 publication for manual evaluation - 2026-11-16

The owner requested that the verified implementation and documentation be pushed to origin/main and deployed to the existing public demo for immediate manual evaluation. This releases publication from the incomplete full-provider-suite gate for this deployment. The previous candidate evidence above remains historical; the complete bilingual/twenty-turn run remains open. Publication will verify the exact provider revision, prepared 86-product MiniLM index, public pages/assets, browser behavior and available real-provider responses, with quota failures reported separately from application failures. Runtime evidence is recorded below after deployment.

### First public deployment and comparison correction

Render deployment `dep-dbtbnul6e07s73c0tb00` published `86430fedba15c5e17bc60e17f4566b7819aeee10` and reported live at 08:21:01 UTC. Both the origin and public domain returned that exact revision, 86 products and MiniLM fingerprint `24709dc1df1fee04`, matching the prepared manifest. [CI run 43829356606](https://github.com/MichalSalek/ecommerce-agent-ai/actions/runs/43829356606) passed source and container checks; the constrained container peak was 315.9 MiB, without OOM. The demo-host prefix purge succeeded and warming verified four documents and 101 assets.

The public shopping-v3 smoke completed a real Groq ten-card turn with a checkpoint and consistent counts. Fresh 1280px and 390px browser sessions passed hero navigation, draft Back/reload and product-button cart save/reload without JavaScript errors or horizontal overflow. Runtime logs confirmed direct Groq `openai/gpt-oss-120b` and actual MiniLM CPU loading.

The real chat-purchase check exposed a missing-reference failure: for an explicit mugs/carafe comparison the model substituted a travel mug, and the application rejected the missing canonical reference. The correction resolves a complete literal list of catalog IDs/names from the current user request in source order, before validating the resulting read. It cannot create unknown products or expand the comparison past ten items; non-list requests retain model interpretation and canonical validation. A controlled real-catalog reproduction failed before the change and passed afterward, including missing, substituted, unknown and duplicate model references. All 120 unit/integration tests and the production build passed. The final public chat-purchase result is recorded after deploying this correction.

## Public incident containment and model failover - 2026-11-16

Owner evaluation exposed a coffee -> first-product details -> compare-displayed-group failure. The UI retained the recommendation group while the model context omitted resultIds after a single-item inspection. Repeated reads then consumed the inference budget; retries reached the shared organization daily token quota. The old failure path also emitted both a typed failure and an SDK error, used a static Retry-After string, and did not reliably preserve a status-only assistant message for reload. Runtime logs showed quota refusals and bounded partial responses, without evidence of an OOM or provider process restart for that failure.

The owned deployment was rolled back to `c299a90497a714db1e02f6a5d9ac4e14239c1f39` in deployment `dep-dbtc4f8ae00c73aag4k0`, live at 08:43:55 UTC. Host-only purge and warming followed. A fresh mobile browser passed the previous version's coffee, details and explicit mugs/carafe comparison with HTTP 200, non-empty replies, no stream error and no JavaScript error.

The owner authorized an existing second Groq credential profile and Qwen 3.8 27B failover, with a ten-minute baseline for daily quota failures. Real small native-tool probes returned HTTP 200 and valid presentAnswer calls from both Qwen 3.8 27B and GPT-OSS 20B; only Qwen is enabled as the configured alternative. The local Windows balancer remains loopback-only and its configuration is unchanged. Production uses the approved credential through Render runtime environment variables; no credential is committed or generated.

The repair preserves recommendation/comparison groups through details, carries explicit read selections on contextual buttons, preloads canonical facts and avoids a redundant model-selection inference. It streams transient progress, emits one typed failure with an absolute deadline, retains verified cards if advice fails, and preserves cooldown and failed-message identity across reload. Stop/new-conversation isolation and atomic cart effects remain enforced.

The real-provider acceptance used a private local test peer to reject the primary once while forwarding fallback requests to actual Groq Qwen. A fresh 390px browser clicked coffee, details and comparison without artificial pauses: all three turns completed, the original five products were compared, reload retained the comparison, and no page error or horizontal overflow occurred. The peer recorded one primary request and four Qwen requests; the failed inference and its fallback shared the same user/tool-context fingerprint. This verifies real fallback-model behavior with controlled primary unavailability, rather than claiming the primary provider actually failed in that test.

Current integrated checks passed: 138 unit/integration tests, type checking, production build and 29 browser E2E scenarios. E2E covers countdown movement and persistence, no Resume response after a status-only failure, no duplicate error panel, new-conversation cooldown, animation and stop/reset isolation. The complete original bilingual/twenty-turn acceptance remains separate from these scoped incident checks.

### Repaired public deployment

Deployment `dep-dbtd14rm8hqs73aieprg` published exact application revision `8c8d7d3d61769b596a3447adc439b54f87587383`, reported live by Render. Both the origin and public hostname returned that revision, 86 products and the matching prepared MiniLM fingerprint `24709dc1df1fee04`. The host-prefix purge succeeded; warming checked four documents and 101 assets. The owner-approved Qwen fallback profile was configured in protected Render environment variables and read back without disclosing values.

[CI run 43842133016](https://github.com/MichalSalek/ecommerce-agent-ai/actions/runs/43842133016) passed both jobs for the deployed SHA: 139 unit/integration tests, type checking, build, 29 browser scenarios and the actual constrained container. Container cgroup peak was 313.2 MiB at 512 MiB / 0.1 CPU, without OOM.

A fresh public-domain 390px browser clicked morning coffee, details of the first item, comparison of the original five and addition of the first item to cart, without artificial pauses. All four turns completed. Reload retained the five-item comparison and exactly one saved cart operation. Runtime logs confirmed 120B for the first three turns and the Qwen fallback during the cart turn; both cart inferences used Qwen and no application effect was replayed. Independent 1280px and 390px sessions passed hero navigation, draft Back/reload and product-button cart save/reload with no JavaScript errors or horizontal overflow.

Provider observation ran from 09:47:27 to 09:58:32 UTC (665 seconds). Twelve memory samples had a maximum of 170.9 MiB; these are provider samples rather than a measured runtime peak. One instance was observed, the events query returned no failure events, inspected application logs contained no failed-agent/OOM/panic message, and the existing 180-second monitor was UP. No production restart was requested as a test. Evidence-only documentation commits after the application revision do not rebuild the running artifact.
