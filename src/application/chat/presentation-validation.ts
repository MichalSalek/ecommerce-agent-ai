import { products } from "@/data/products";
import type { ProductSearch } from "@/domain/catalog/product";
import { catalogFactAbsenceError } from "./assistant-text";
import type { PresentedAnswer } from "./native-tools";
import type { Comparison, SearchEvidence } from "./shopping-v3";

export type Evidence = {
  id: string;
  tool: string;
  input: unknown;
  output: unknown;
  productIds: string[];
};
function numericText(text: string, evidence: Evidence[]) {
  return text
    .replace(/\[\[amount:([^:]+):([^\]]+)\]\]/g, (_match, id, field) => {
      const record = evidence.find((e) => e.id === id)?.output;
      const value =
        field === "totalEUR" &&
        record &&
        typeof record === "object" &&
        field in record
          ? (record as { totalEUR: number }).totalEUR
          : undefined;
      if (typeof value !== "number")
        throw new Error("Unverified monetary reference.");
      return `${value.toFixed(2)} EUR`;
    })
    .replace(
      /\[\[(difference|dimensions):([^\]]+)\]\]/g,
      (_match, kind, id) => {
        const record = evidence.find((e) => e.productIds.includes(id));
        const product = products.find((p) => p.id === id);
        if (!record || !product)
          throw new Error("Unverified measurement reference.");
        if (kind === "dimensions") return product.dimensions;
        const row = evidence
          .flatMap((e) => (e.output as Comparison)?.differencesCents ?? [])
          .find((row) => row.productId === id);
        if (!row) throw new Error("Unverified difference reference.");
        return `${(row.cents / 100).toFixed(2)} EUR`;
      },
    )
    .replace(/\[\[(price|name):([^\]]+)\]\](\s+EUR\b)?/g, (_match, kind, id, suffix) => {
      if (!evidence.some((e) => e.productIds.includes(id)))
        throw new Error("Unverified product reference.");
      const product = products.find((p) => p.id === id)!;
      return kind === "price"
        ? `${product.price.toFixed(2)} EUR`
        : product.name + (suffix ?? "");
    })
    .replace(/\[\[count:([^:]+):([^\]]+)\]\]/g, (_match, id, field) => {
      const record = evidence.find((e) => e.id === id)?.output;
      const value =
        field === "productCount" &&
        record &&
        typeof record === "object" &&
        "productIds" in record &&
        Array.isArray(record.productIds)
          ? record.productIds.length
          : record && typeof record === "object" && field in record
            ? (record as Record<string, unknown>)[field]
            : undefined;
      if (typeof value !== "number")
        throw new Error("Unverified count reference.");
      return String(value);
    });
}
export function validatePresentation(
  answer: PresentedAnswer,
  evidence: Evidence[],
  search?: SearchEvidence,
) {
  if (answer.evidenceIds.some((id) => !evidence.some((e) => e.id === id)))
    throw new Error("Unknown evidence ID.");
  const cited = evidence.filter((e) => answer.evidenceIds.includes(e.id));
  const knownProducts = products.filter((product) =>
    cited.some((record) => record.productIds.includes(product.id)),
  );
  const missingFact = catalogFactAbsenceError(answer.text, {
    price: knownProducts.some((product) => Number.isFinite(product.price)),
    dimensions: knownProducts.some((product) => !!product.dimensions),
  });
  if (missingFact) throw new Error(missingFact);
  if (
    /\b(?:smaller|larger|bigger|taller|shorter|lighter|heavier|faster|slower|(?:less|more)\s+space)\b|mniejsz|większ|wyższ|niższ|lżejsz|cięższ|szybsz|wolniejsz|mniej.{0,20}miejsc|więcej.{0,20}miejsc/i.test(
      answer.text,
    )
  )
    throw new Error("UNVERIFIED_PHYSICAL_COMPARISON");
  const foldedReply = answer.text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l");
  if (
    /\bi(?:'ve| have)?\s+added\b|\bwe(?:'ve| have)?\s+added\b|\b(?:was|were|have been|has been)\s+added\b|(?:^|[.!?]\s+)(?:added|saved)\b|dodal(?:em|am)|\bdodano\b|zostal.{0,25}dodan/i.test(
      foldedReply,
    )
  )
    throw new Error(
      "Only the browser may confirm a saved cart operation. Say the selection is prepared and the device will confirm after saving.",
    );
  const offerWords =
    /\b(?:discounts?|promotions?|promo codes?|free|sale)\b|rabat|gratis|darmo/i.test(
      answer.text,
    );
  const denyingOffer =
    /\bno (?:discounts?|promotions?|promo codes?|free)|\bnot free\b|(?:cannot|can't|do not|don't|does not|doesn't).{0,60}(?:offer|apply|provide|discount|promo|free)|(?:nie|brak).{0,50}(?:rabat|promoc|darmo|gratis)/i.test(
      answer.text,
    );
  const approximateBudget = cited.some(
    (record) =>
      (record.output as SearchEvidence)?.appliedCriteria?.targetPrice !==
      undefined,
  );
  if (
    (offerWords && !denyingOffer) ||
    (/%/.test(answer.text) && !approximateBudget)
  )
    throw new Error(
      "There is no verified promotion, free offer or discount. Use canonical prices and policies.",
    );
  if (
    answer.view === "products" &&
    search &&
    !evidence.some(
      (record) =>
        record.tool === "getProductDetails" &&
        record.productIds.some((id) => answer.productIds.includes(id)),
    )
  ) {
    const source = evidence.find((record) => record.id === search.evidenceId);
    if (source && !cited.includes(source)) {
      cited.push(source);
      answer.evidenceIds.push(source.id);
    }
    if (
      answer.productIds.some(
        (id) => !cited.some((record) => record.productIds.includes(id)),
      )
    )
      throw new Error("Products require cited evidence.");
    // The application owns the requested page size; an omitted presentation ID never hides a matching card.
    answer.productIds = search.products.map((product) => product.id);
  }
  const absence =
    /\b(?:no (?:products|items|stock|matches|assortment)|nothing (?:available|in stock)|we (?:do not|don't) (?:have|stock)|brak (?:produkt|asortyment|dopasowa)|nie (?:mamy|ma (?:produkt|takich)))/i.test(
      answer.text,
    );
  if (
    absence &&
    !cited.some(
      (e) =>
        (e.tool === "searchProducts" &&
          (e.output as SearchEvidence).products?.length === 0) ||
        (e.tool === "getCatalogOverview" &&
          (e.output as { total: number }).total === 0) ||
        (e.tool === "deviceCart" &&
          (e.output as { totalUnits: number }).totalUnits === 0 &&
          /cart|basket|koszyk/i.test(answer.text)),
    )
  )
    throw new Error("Check the exact catalog scope before claiming absence.");
  if (
    /we (?:do not|don't) (?:have|stock)|no assortment|nie mamy|brak asortymentu/i.test(
      answer.text,
    ) &&
    !/\bmore\b|additional|new options|kolejn|nowych/i.test(answer.text) &&
    cited.some(
      (record) =>
        record.tool === "searchProducts" &&
        ["exhausted", "unconfirmed-feature"].includes(
          (record.output as SearchEvidence).outcome,
        ),
    )
  )
    throw new Error(
      "Shown items or an unconfirmed feature do not establish absence of assortment.",
    );
  if (
    new Set(answer.productIds).size !== answer.productIds.length ||
    answer.productIds.some(
      (id) => !cited.some((e) => e.productIds.includes(id)),
    )
  )
    throw new Error("Products require cited evidence.");
  if (
    answer.claim &&
    answer.claim !== "none" &&
    !cited.some(
      (e) =>
        (e.output as SearchEvidence)?.outcome === answer.claim ||
        (answer.claim === "unavailable" &&
          e.productIds.some((id) =>
            products.some((product) => product.id === id && !product.inStock),
          )) ||
        (answer.claim === "no-assortment" &&
          e.tool === "getCatalogOverview" &&
          (e.output as { total: number }).total === 0),
    )
  )
    throw new Error("Absence requires a measured scoped result.");
  if (
    /https?:|www\.|\]\(|<\w|\[\[(?!price:|name:|count:|difference:|dimensions:|amount:)/i.test(
      answer.text,
    )
  )
    throw new Error(
      "Use canonical cards and supported references, not URLs/markup.",
    );
  // Prices in advice are resolved by the application. Avoid unchecked numeric currency claims.
  const withoutReferences = answer.text.replace(/\[\[[^\]]+\]\]/g, "");
  if (cited.length) {
    if (
      /(?:all.*(?:in stock|available)|wszystk.*dostępn)/i.test(answer.text) &&
      !/(?:not all|nie wszystk)/i.test(answer.text) &&
      cited.some((record) =>
        record.productIds.some(
          (id) => products.find((p) => p.id === id)?.inStock === false,
        ),
      )
    )
      throw new Error("Not all cited products are in stock.");
  }
  const counts = cited.flatMap((e) => {
    const record = e.output as Record<string, unknown>;
    return [
      "total",
      "scopeTotal",
      "totalMatches",
      "unseenMatches",
      "remainingMatches",
      "requestedCount",
      "totalLines",
      "totalUnits",
    ]
      .flatMap((field) =>
        typeof record?.[field] === "number" ? [record[field] as number] : [],
      )
      .concat(
        Array.isArray(record?.productIds) ? [record.productIds.length] : [],
      )
      .concat(
        ...["products", "categories"].flatMap((field) =>
          Array.isArray(record?.[field])
            ? [(record[field] as unknown[]).length]
            : [],
        ),
      )
      .concat(
        Array.isArray(record?.categories)
          ? record.categories.flatMap((category) =>
              category &&
              typeof category === "object" &&
              "count" in category &&
              typeof category.count === "number"
                ? [category.count]
                : [],
            )
          : [],
      );
  });
  for (const match of withoutReferences.matchAll(
    /\b(\d+)\s+(?:products?|items?|matches|categories|produkt\w*|kategor\w*|dopasowa\w*)\b/gi,
  ))
    if (!counts.includes(Number(match[1])))
      throw new Error(
        "Unverified catalog count. Use [[count:EVIDENCE:FIELD]].",
      );
  const countWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    jeden: 1,
    dwa: 2,
    trzy: 3,
    cztery: 4,
    pięć: 5,
    sześć: 6,
    siedem: 7,
    osiem: 8,
    dziewięć: 9,
    dziesięć: 10,
  };
  for (const match of withoutReferences.matchAll(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|jeden|dwa|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć)\s+(?:products?|items?|matches|categories|produkt\w*|kategor\w*|dopasowa\w*)\b/gi,
  ))
    if (
      !counts.includes(countWords[match[1].toLowerCase()]) &&
      !(
        countWords[match[1].toLowerCase()] === 10 &&
        /(?:up to|at most)\s*$/i.test(withoutReferences.slice(0, match.index))
      )
    )
      throw new Error("Unverified catalog count.");
  const units = cited
    .filter((e) => e.tool === "deviceCart" || e.tool === "proposeCart")
    .flatMap((e) => {
      const value = e.output as {
        totalUnits?: number;
        products?: { quantity?: number }[];
        items?: { quantity?: number }[];
      };
      return [
        value.totalUnits,
        ...(value.products ?? value.items ?? []).map((row) => row.quantity),
      ].filter((n): n is number => typeof n === "number");
    });
  for (const match of withoutReferences.matchAll(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|jeden|dwa|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć)\s+(?:units?|pieces?|sztuk\w*)\b/gi,
  ))
    if (!units.includes(countWords[match[1].toLowerCase()] ?? Number(match[1])))
      throw new Error("Unverified cart unit count.");
  if (
    /\b\d+(?:[.,]\d+)?\s*(?:mm|cm|metres?|meters?|kg|grams?|kilograms?|litres?|liters?|ml|watts?|hours?)\b/i.test(
      withoutReferences,
    )
  )
    throw new Error("Unverified measurement. Use [[dimensions:ID]].");
  const policies = cited
    .filter((e) => e.tool === "getPolicy")
    .map((e) => (e.output as { policy: string }).policy);
  for (const match of withoutReferences.matchAll(
    /\b(\d+)\s+(?:business\s+)?(?:days?|dni|dniach)\b/gi,
  ))
    if (
      !policies.some((policy) =>
        (policy.match(/\d+/g) ?? ([] as string[])).includes(match[1]),
      )
    )
      throw new Error("Unverified policy duration.");
  const amounts = cited.flatMap((e) => {
    const record = e.output as {
      appliedCriteria?: ProductSearch;
      differencesCents?: { cents: number }[];
      policy?: string;
      totalEUR?: number;
    };
    return [
      ...e.productIds.flatMap((id) =>
        products.filter((p) => p.id === id).map((p) => p.price),
      ),
      record?.appliedCriteria?.maxPrice,
      record?.appliedCriteria?.targetPrice,
      record?.totalEUR,
      ...(record?.differencesCents ?? []).map((p) => p.cents / 100),
      ...(record?.policy?.match(/\d+(?:\.\d+)?/g) ?? []).map(Number),
    ].filter((n): n is number => typeof n === "number");
  });
  for (const match of withoutReferences.matchAll(
    /(?:EUR|€)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:EUR|euros?|€)\b/gi,
  )) {
    const amount = Number((match[1] ?? match[2]).replace(",", "."));
    if (
      !amounts.includes(amount) ||
      !cited.some((e) => e.tool === "getPolicy" || e.tool === "userPreferences")
    )
      throw new Error(
        "Unverified monetary amount. Use [[price:ID]] or a verified criterion.",
      );
  }
  if (
    /(?:USD|GBP|PLN|[$£¥₹])\s*\d|\d+\s*(?:USD|GBP|PLN|zł|zl|£|¥|₹)\b/i.test(
      withoutReferences,
    )
  )
    throw new Error("The catalog is priced in EUR; do not convert currencies.");
  return numericText(answer.text, cited);
}
