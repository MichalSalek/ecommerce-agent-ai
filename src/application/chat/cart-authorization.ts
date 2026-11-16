import { products } from "@/data/products";
import { productTypes } from "@/domain/catalog/taxonomy";
import type { AgentState } from "./shopping-v3";
import { cartProposalSchema } from "./native-tools";
import type { z } from "zod";
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l")
    .replaceAll("’", "'");
const unquoted = (value: string) =>
  value
    .replace(
      /"[^"\n]*(?:"|$)|„[^”\n]*(?:”|$)|“[^”\n]*(?:”|$)|«[^»\n]*(?:»|$)/g,
      " ",
    )
    .replace(/(^|[^\w'])'[^'\n]*'/g, "$1 ");
/** Deterministic authorization checks effects only; the model owns shopping interpretation. */
export function hasCartInstruction(text: string) {
  const value = unquoted(normalize(text));
  return (
    !/\b(?:example|examples|quote|quoted|repeat|story|fiction|simulate|hypothetical|suppose|if|gdyby|gdybym|przyklad\w*|cytuj\w*|powtorz\w*|opowiedz\w*|histori\w*)\b/.test(
      value,
    ) &&
    !/\b(?:never|not|don't|do not|nie|nigdy)\s+(?:(?:actually|really|ever|wcale|faktycznie|naprawde)\s+)*(?:add|buy|take|dodawaj|dodaj|kupuj)\b/.test(
      value,
    ) &&
    /\b(?:add|dodaj|dodac|dodasz|buy|biore|wezme|kupuje|take)\b/.test(value)
  );
}
type CartProposal = z.infer<typeof cartProposalSchema>;
type CartContext = { resolvedThisTurn: boolean };
const quantityError = "Confirm the number of units for each item.";
function cartClause(text: string, context?: CartContext) {
  let value = normalize(text);
  if (context?.resolvedThisTurn) {
    // Only a resolved shopping read may precede an independently explicit cart command.
    let cartClause: string | undefined;
    for (const match of value.matchAll(
      /\b(?:and|then|oraz|i|potem|nastepnie)\b/g,
    )) {
      const prefix = value.slice(0, match.index).trim();
      const clause = value.slice(match.index + match[0].length).trim();
      if (
        /^(?:(?:please|prosze|poprosze)\s+)?(?:find|show|search|compare|znajdz|pokaz|szukam|szukaj|porownaj)\b/.test(
          prefix,
        ) &&
        /\b(?:cart|basket|koszyk\w*)\b/.test(clause) &&
        hasCartInstruction(clause)
      )
        cartClause = clause;
    }
    value = cartClause ?? value;
  }
  return value;
}

const quantityWords: Record<string, number> = {
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
  jedna: 1,
  jedno: 1,
  dwa: 2,
  dwie: 2,
  trzy: 3,
  cztery: 4,
  piec: 5,
  szesc: 6,
  siedem: 7,
  osiem: 8,
  dziewiec: 9,
  dziesiec: 10,
};
const quantityNumber = (text: string) => quantityWords[text] ?? Number(text);
function resolvedQuantities(
  value: string,
  items: CartProposal["items"],
): number[] | undefined {
  const text = value.replace(
    /\b(?:for|dla)\s+(?:\d+|\w+)\s+(?:people|persons?|osob\w*)\b/g,
    " ",
  );
  // Polish "ten" means "this"; it is the number ten only with an English cart verb.
  const quantityPattern = `(?:\\d+|${Object.keys(quantityWords)
    .filter((word) => word !== "ten" || /\b(?:add|buy|take)\b/.test(text))
    .join("|")})`;
  if (/(?:^|\s)-\d|\b\d+[.,]\d+\b/.test(text)) return undefined;
  if (
    [...text.matchAll(/\b\d+\b/g)].some(
      (match) => Number(match[0]) < 1 || Number(match[0]) > 99,
    )
  )
    return undefined;
  const each = [
    ...text.matchAll(
      new RegExp(
        `\\b(${quantityPattern})\\s+(?:of\\s+)?(?:each|kazd\\w*)\\b`,
        "g",
      ),
    ),
  ];
  if (each.length > 1) return undefined;
  const recognized = new Set<number>(each.map((match) => match.index!));
  let ambiguousNamed = false;
  const named = items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return undefined;
    const labels = [
      ...new Set(
        [product.id, product.id.replaceAll("-", " "), product.name].map(
          normalize,
        ),
      ),
    ]
      .sort((a, b) => b.length - a.length)
      .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(
      `\\b(${quantityPattern})\\s+(?:(?:units?|pieces?|szt\\w*)\\s+(?:of\\s+)?)?(?:${labels.join("|")})\\b`,
      "g",
    );
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 1) ambiguousNamed = true;
    for (const match of matches) recognized.add(match.index!);
    return matches.length === 1 ? quantityNumber(matches[0][1]) : undefined;
  });
  const lead = text.match(
    new RegExp(
      `\\b(?:add|dodaj|dodac|dodasz|buy|take|biore|wezme|kupuje)\\s+(${quantityPattern})\\b`,
    ),
  );
  const units = [
    ...text.matchAll(
      new RegExp(
        `\\b(${quantityPattern})\\s+(?:units?|pieces?|szt\\w*)\\b`,
        "g",
      ),
    ),
  ];
  if (lead) recognized.add(lead.index! + lead[0].lastIndexOf(lead[1]));
  for (const match of units) recognized.add(match.index!);
  if (
    ambiguousNamed ||
    [...text.matchAll(/\b\d+\b/g)].some(
      (match) => !recognized.has(match.index!),
    )
  )
    return undefined;
  const explicit = lead
    ? quantityNumber(lead[1])
    : units.length === 1
      ? quantityNumber(units[0][1])
      : undefined;
  let amounts: number[];
  if (each.length) {
    if (named.some((n) => n !== undefined)) return undefined;
    amounts = items.map(() => quantityNumber(each[0][1]));
  } else if (items.length === 1) {
    if (
      named[0] !== undefined &&
      explicit !== undefined &&
      named[0] !== explicit
    )
      return undefined;
    amounts = [named[0] ?? explicit ?? 1];
  } else if (named.some((n) => n !== undefined)) {
    if (named.some((n) => n === undefined)) return undefined;
    amounts = named as number[];
  } else {
    if (explicit !== undefined || units.length > 0 || /\b\d+\b/.test(text))
      return undefined;
    amounts = items.map(() => 1);
  }
  return amounts.every((n) => Number.isInteger(n) && n >= 1 && n <= 99)
    ? amounts
    : undefined;
}

export function prepareCartProposal(
  text: string,
  state: AgentState,
  proposal: CartProposal,
  context?: CartContext,
): { proposal: CartProposal } | { error: string } {
  if (!hasCartInstruction(text))
    return { error: "Explicit cart instruction required." };
  const amounts = resolvedQuantities(cartClause(text, context), proposal.items);
  if (!amounts) return { error: quantityError };
  const prepared = {
    ...proposal,
    items: proposal.items.map((item, index) => ({
      ...item,
      quantity: amounts[index],
    })),
  };
  const error = authorizeCart(text, state, prepared, context);
  return error ? { error } : { proposal: prepared };
}

export function authorizeCart(
  text: string,
  state: AgentState,
  proposal: CartProposal,
  context?: CartContext,
) {
  if (!hasCartInstruction(text)) return "Explicit cart instruction required.";
  const value = cartClause(text, context);
  const items = proposal.items;
  const positions = [
    /\bfirst\b|pierwsz/,
    /\bsecond\b|drug/,
    /cheap|less expensive|tansz/,
  ].filter((pattern) => pattern.test(value)).length;
  if (positions > 1)
    return "Please identify one unambiguous product selection.";
  if (
    items.some(
      (item) =>
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99,
    )
  )
    return "Confirm the number of units for each item.";
  if (
    /\b(?:not|nie|except)\s+(?:the\s+)?(?:first|second|both|cheaper)|nie\s+(?:pierwsz|drug|tansz)/.test(
      value,
    )
  )
    return "Please identify the exact product to add.";
  const selection = /\bboth\b|\boba\b|\bobie\b|obydw/.test(value)
    ? "both"
    : /\bfirst\b|pierwsz/.test(value)
      ? "first"
      : /\bsecond\b|drug/.test(value)
        ? "second"
        : /cheap|less expensive|tansz/.test(value)
          ? "cheapest"
          : /\ball\b|wszystk|\beach\b|kazd\w*/.test(value)
            ? "all"
            : proposal.selection;
  // Parse the purchase operand independently of harmless commentary after a comma.
  // Quantity parsing still uses the whole instruction ("both, two each").
  let remainder = value.split(/[,;.!?]/, 1)[0];
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product)
      return "Unknown product; please choose an actual catalog item.";
    for (const label of [
      product.id,
      product.id.replaceAll("-", " "),
      product.name,
      ...(productTypes[product.productType]?.aliases ?? []),
    ].sort((a, b) => b.length - a.length)) {
      const escaped = normalize(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      remainder = remainder.replace(new RegExp(`\\b${escaped}\\w*`, "g"), " ");
    }
  }
  remainder = remainder
    .replace(
      /\b(?:add|dodaj|dodac|dodasz|biore|wezme|kupuje|buy|take|choose|can|could|would|you|i|we|please|prosze|poprosze|mozesz|moge|chcialbym|czy|do|to|my|the|a|an|this|that|it|these|those|one|two|three|four|five|six|seven|eight|nine|ten|jeden|jedna|jedno|dwa|dwie|trzy|cztery|piec|szesc|siedem|osiem|dziewiec|dziesiec|ta|te|tego|tansz\w*|drozsz\w*|cheaper|cheapest|less|expensive|first|second|pierwsz\w*|drug\w*|both|all|oba|obie|obydw\w*|wszystk\w*|each|kazd\w*|again|another|more|jeszcze|ponownie|wiecej|kolejn\w*|product\w*|produkt\w*|items?|options?|of|and|or|i|cart|basket|koszyk\w*|szt\w*|units?|pieces?|them|x)\b/g,
      " ",
    )
    .replace(/[^a-z]+/g, " ")
    .trim();
  if (remainder)
    return "The selection contains an unresolved reference. Please name the product or use its position.";
  if (selection === "first" && !/\bfirst\b|pierwsz/.test(value))
    return "Ask which product.";
  if (selection === "second" && !/\bsecond\b|drug/.test(value))
    return "Ask which product.";
  if (selection === "cheapest" && !/cheap|less expensive|tansz/.test(value))
    return "Ask which product.";
  if (selection === "both" && !/\bboth\b|\boba\b|\bobie\b|obydw/.test(value))
    return "Ask which products.";
  if (selection === "all" && !/\ball\b|wszystk|\beach\b|kazd\w*/.test(value))
    return "Ask which products.";
  const amounts = resolvedQuantities(value, items);
  if (!amounts || items.some((item, index) => item.quantity !== amounts[index]))
    return quantityError;
  if (new Set(items.map((p) => p.productId)).size !== items.length)
    return "Choose distinct items.";
  const candidates =
    state.lastIds.length > 1
      ? state.lastIds
      : state.comparisonIds.length
        ? state.comparisonIds
        : state.lastIds;
  let expected: string[] = [];
  switch (selection) {
    case "named":
      expected = products
        .filter(
          (p) =>
            value.includes(normalize(p.id)) ||
            value.includes(normalize(p.name)),
        )
        .map((p) => p.id);
      break;
    case "first":
      expected = state.lastIds.slice(0, 1);
      break;
    case "second":
      expected = state.lastIds.slice(1, 2);
      break;
    case "both":
      if (candidates.length === 2) expected = candidates;
      break;
    case "all":
      expected = candidates;
      break;
    case "selected":
      expected = state.selectedIds.length
        ? state.selectedIds
        : candidates.length === 1
          ? candidates
          : [];
      break;
    case "cheapest": {
      const rows = products.filter((p) => candidates.includes(p.id));
      const min = Math.min(...rows.map((p) => p.price));
      const cheapest = rows.filter((p) => p.price === min);
      if (cheapest.length === 1) expected = [cheapest[0].id];
      break;
    }
  }
  if (
    !expected.length ||
    expected.length !== items.length ||
    items.some((p) => !expected.includes(p.productId))
  )
    return "Selection is ambiguous, unknown or tied. Ask which product.";
  if (
    items.some(
      (item) => !products.find((p) => p.id === item.productId)?.inStock,
    )
  )
    return "Unavailable product; nothing added.";
}
