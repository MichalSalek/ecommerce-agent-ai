import { randomUUID } from "node:crypto";
import { products } from "@/data/products";
import {
  prepareCartProposal,
  hasCartInstruction,
  cartSelectionIds,
  cartInstructionText,
  cartSelectionKind,
} from "./cart-authorization";
import type { AgentState } from "./shopping-v3";
import type { Language } from "./assistant-text";

export type PendingCartIntent = {
  nonce: string;
  conversationId: string;
  sourceMessageId: string;
  sourceText: string;
  kind: "confirm" | "selection" | "quantity";
  productIds: string[];
  quantity?: number;
  language: Language;
  expiresAt: number;
};
const intents = new Map<string, PendingCartIntent>();
export function cleanCartIntents(now = Date.now()) {
  for (const [key, value] of intents)
    if (value.expiresAt <= now) intents.delete(key);
  while (intents.size > 300) intents.delete(intents.keys().next().value!);
}
export function pendingCartIntent(
  conversationId: string | undefined,
  reference: string | undefined,
  now = Date.now(),
) {
  cleanCartIntents(now);
  const intent = conversationId ? intents.get(conversationId) : undefined;
  return intent && intent.nonce === reference ? intent : undefined;
}
export function forgetCartIntent(conversationId?: string) {
  if (conversationId) intents.delete(conversationId);
}
export function rememberCartIntent(
  input: Omit<PendingCartIntent, "nonce" | "expiresAt">,
  now = Date.now(),
) {
  cleanCartIntents(now);
  const value = { ...input, nonce: randomUUID(), expiresAt: now + 600_000 };
  intents.set(input.conversationId, value);
  cleanCartIntents(now);
  return value;
}
export function resolveCartOperand(text: string, state: AgentState) {
  if (!hasCartInstruction(text)) return undefined;
  const value = cartInstructionText(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l");
  const named = products.filter((p) =>
    [p.id, p.name.toLowerCase()].some((label) => value.includes(label)),
  );
  const candidates = cartSelectionIds(state);
  const selector = cartSelectionKind(value);
  let selection:
    | "named"
    | "first"
    | "second"
    | "cheapest"
    | "both"
    | "all"
    | "selected" = "selected";
  let ids: string[] = [];
  if (named.length) {
    selection = "named";
    ids = named.map((p) => p.id);
  } else if (selector === "first") {
    selection = "first";
    ids = candidates.slice(0, 1);
  } else if (selector === "second") {
    selection = "second";
    ids = candidates.slice(1, 2);
  } else if (selector === "cheapest") {
    selection = "cheapest";
    const rows = products.filter((p) => candidates.includes(p.id));
    const price = Math.min(...rows.map((p) => p.price));
    ids = rows.filter((p) => p.price === price).map((p) => p.id);
    if (ids.length !== 1) ids = [];
  } else if (selector === "both") {
    selection = "both";
    if (candidates.length === 2) ids = candidates;
  } else if (selector === "all") {
    selection = "all";
    ids = candidates;
  } else
    ids = state.selectedIds.length
      ? state.selectedIds
      : state.lastIds.length === 1
        ? state.lastIds
        : [];
  if (!ids.length) return { error: "selection" as const, candidates };
  const prepared = prepareCartProposal(text, state, {
    selection,
    items: ids.map((productId) => ({ productId, quantity: 1 })),
  });
  if ("proposal" in prepared) return prepared;
  return {
    error: /units/.test(prepared.error)
      ? ("quantity" as const)
      : /Unavailable/.test(prepared.error)
        ? ("unavailable" as const)
        : ("selection" as const),
    candidates: /Unavailable/.test(prepared.error)
      ? candidates.filter((id)=>products.find((p)=>p.id===id)?.inStock)
      : /units/.test(prepared.error) && ids.length ? ids : candidates,
  };
}
