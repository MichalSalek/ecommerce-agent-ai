# Aurelle visual system

Contrasting editorial commerce: the owner-selected #f3f0f4 paper background, navy structure and coral actions, serif display typography, restrained sans-serif labels and large local product imagery. No gradients, shadows, ornamental icons or scroll reveals. The primary action is visible on each screen; actions have keyboard focus and at least 44 px hit height.

References inspected: MUJI homeware and Article homeware (ARKET denied access). Adapt product-first photography, a calm navigation/utility hierarchy and clear catalog controls. Do not adopt newsletter overlays or promotional clutter.

Home uses an asymmetric photographic introduction followed by search/category controls and a three-column collection. Product pages use a generous image/detail split. Cart has editable lines and a summary; mobile stacks them. Chat keeps verified product cards compact and uses the same AddToCart behavior as every other surface. The heading color is uniform.

UI, catalog, code and documentation are English; assistant replies follow the shopper language. Catalog money is EUR. Prices are demo amounts. Original source photographs and generated product photographs are demo assets. Light-only design; there is no separate dark mode.

Independent screenshot review accepted the visual direction and comprehension of the cart. Follow-up corrections shortened the search placeholder and disabled Next's development overlay for demo presentation. Browser acceptance covers desktop and 390 px mobile with no horizontal overflow.

The hero introduces the AI shopping assistant with a generated photograph of a laptop and product recommendations. Its image and primary CTA open the assistant; browsing the collection is secondary. Keep the full image visible on mobile. The assistant navigation item uses bold text and a restrained robot icon, explicitly requested by the owner. This icon is functional navigation emphasis, not a repeated decorative motif.

2026-11-13 chat refinement: keep the exact #f3f0f4 page background, strengthen the palette with navy #142b38 and coral #b93e1e, white reading surfaces, a pinned composer and compact product cards. Chat owns its scroll area; mobile omits the visual sidebar while retaining the page heading for assistive technology. The conversation starts with a welcome message and visible starters. New conversation stays accessible in the toolbar. Enter/newline, Back/reload, reset isolation, scroll retention and failed-image fallback have browser regression coverage. References: HuggingChat's visible new-topic control and reading rail, v0's anchored composer and starter affordances; avoid burying the core actions in icon-only menus.

The chat uses the remaining viewport height below the measured page header and main padding, with a 16 px bottom inset and no desktop height cap. The thread scrolls independently while the composer stays visible. The sidebar keeps a brief mock-data notice and catalog link; on mobile it is visually omitted. Ten executable shopping examples remain visible below the chat, while contextual suggestions offer relevant next actions after results. Implementation details belong in the README. The top bar states that the store uses mock products and has no checkout.
