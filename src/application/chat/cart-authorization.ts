import { products } from "@/data/products";
import type { AgentState } from "./shopping-v3";
import { cartProposalSchema } from "./native-tools";
import type { z } from "zod";
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l");
/** Deterministic authorization checks effects only; the model owns shopping interpretation. */
export function hasCartInstruction(text: string) {
  const value = normalize(text);
  return (
    !/\b(?:not|don't|do not|nie)\s+(?:add|buy|take|dodawaj|dodaj|kupuj)/.test(
      value,
    ) &&
    /\b(?:add|dodaj|dodac|dodasz|buy|biore|wezme|kupuje|take)\b/.test(value)
  );
}
export function authorizeCart(
  text: string,
  state: AgentState,
  proposal: z.infer<typeof cartProposalSchema>,
) {
  const value = normalize(text);
  if (!hasCartInstruction(text)) return "Explicit cart instruction required.";
  const items = proposal.items;
  if (proposal.selection === "first" && !/\bfirst\b|pierwsz/.test(value))
    return "Ask which product.";
  if (proposal.selection === "second" && !/\bsecond\b|drug/.test(value))
    return "Ask which product.";
  if (
    proposal.selection === "cheapest" &&
    !/cheap|less expensive|tansz/.test(value)
  )
    return "Ask which product.";
  if (
    proposal.selection === "both" &&
    !/\bboth\b|\boba\b|\bobie\b|obydw/.test(value)
  )
    return "Ask which products.";
  if (proposal.selection === "all" && !/\ball\b|wszystk/.test(value))
    return "Ask which products.";
  const quantityText = value.replace(
    /\b(?:for|dla)\s+\w+\s+(?:people|persons?|osob\w*)/g,
    "",
  );
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    jeden: 1,
    jedna: 1,
    jedno: 1,
    dwa: 2,
    dwie: 2,
    trzy: 3,
    cztery: 4,
    piec: 5,
  };
  const amounts = [
    1,
    ...[
      ...quantityText.matchAll(
        /\b(?:add|buy|take|dodaj|biore|wezme)\s+(\d+)\b|\b(\d+)\s*(?:units?|pieces?|szt\w*|of them)/g,
      ),
    ].map((m) => Number(m[1] ?? m[2])),
    ...[
      ...quantityText.matchAll(
        /\b(one|two|three|four|five|jeden|jedna|jedno|dwa|dwie|trzy|cztery|piec)\b/g,
      ),
    ].map((m) => words[m[1]]),
  ];
  if (items.some((item) => !amounts.includes(item.quantity)))
    return "Confirm the number of units for each item.";
  if (new Set(items.map((p) => p.productId)).size !== items.length)
    return "Choose distinct items.";
  const candidates =
    state.lastIds.length > 1
      ? state.lastIds
      : state.comparisonIds.length
        ? state.comparisonIds
        : state.lastIds;
  let expected: string[] = [];
  switch (proposal.selection) {
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
