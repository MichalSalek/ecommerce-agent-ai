import type { ModelMessage } from "ai";
import { catalogById } from "@/data/products";
import type { Product } from "@/domain/catalog/product";

/** Bounded, role-labelled conversation data; product facts always come from the catalog. */
export function conversationContext(
  history: ModelMessage[] = [],
  groups: { userText: string; productIds: string[] }[] = [],
) {
  const messages: ModelMessage[] = history
    .filter((message) =>
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" && !!message.content.trim(),
    )
    .slice(-12)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: (message.content as string).slice(0, 600),
    }));
  const priorGroups = groups.slice(-6).flatMap((group) => {
    const ids = [...new Set(group.productIds)].slice(0, 10);
    const records = ids.flatMap((id) => { const product = catalogById.get(id); return product ? [product] : []; });
    return records.length
      ? [{ request: group.userText.slice(0, 300), products: records.map((p) => ({ id: p.id, name: p.name })) }]
      : [];
  });
  return { messages, priorGroups };
}

export const compactProduct = (p: Product, detail = false) => ({
  id: p.id,
  name: p.name,
  priceEUR: p.price,
  inStock: p.inStock,
  features: detail ? p.features : p.features.slice(0, 2),
  ...(detail
    ? {
        material: p.material,
        dimensions: p.dimensions,
        description: p.fullDescription,
        limitations: p.limitations,
      }
    : {}),
});

/** These descriptions correspond to implemented catalog, policy and cart operations. */
export const shoppingCapabilities = {
  operations: [
    "Find and refine products in the catalog by the customer's needs and budget in EUR.",
    "Show categories, inspect product details and compare identified products using catalog facts.",
    "Explain the available delivery, returns and payment policies.",
    "Prepare an explicitly requested cart selection for this device to save; the device confirms saving.",
  ],
  limits: [
    "Do not claim checkout, ordering, delivery tracking, booking, discounts or changes to policies.",
    "Only known catalog facts and store policies are confirmed; unknown product features remain unconfirmed.",
  ],
} as const;


/** Validate the assistant's perspective and the limitations of this demo. */
export function capabilityAnswerError(text: string, language: "pl" | "en", requireFirstPerson = false): string | undefined {
  const folded = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll("ł", "l");
  if ((language === "pl" && /\bmozesz mi pomoc\b/.test(folded)) ||
      (language === "en" && /\byou can help me\b/.test(folded)) ||
      (requireFirstPerson && !(language === "pl" ? /\b(?:moge|pomoge)\b/ : /\b(?:i can|i will|i'll)\b/).test(folded)))
    return "Speak as the assistant in the first person, addressing the customer.";
  const unsupported = /\b(?:place (?:an? |the )?order|track (?:an? |the )?order|checkout|book (?:a |an )?(?:delivery|appointment)|apply (?:a |an )?(?:discount|promo)|realizowac zamowieni\w*|skladac zamowieni\w*|sledzic (?:twoje )?zamowieni\w*|rezerwowac dostawe|naliczac rabat\w*)\b/;
  const denial = /\b(?:cannot|can't|do not|don't|does not|doesn't|no|nie|bez)\b/;
  if (folded.split(/[.!?;]/).some((clause) => unsupported.test(clause) && !denial.test(clause)))
    return "Do not claim ordering, checkout or order tracking. Use only the listed capabilities.";
}

/** Safe fallback only after a model has selected the capabilities tool. */
export function capabilityFallback(language: "pl" | "en"): string {
  return language === "pl"
    ? "Mogę pomóc znaleźć i porównać produkty oraz sprawdzić zasady dostawy i zwrotów."
    : "I can help you find and compare products and check delivery and returns policies.";
}
