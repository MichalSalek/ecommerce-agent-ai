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
/** Preserve only a quoted exact catalog name; quoted instructions remain non-authoritative. */
function unquotedWithCatalogNames(value: string): string {
  const protectedNames = value.replace(/"([^"\n]*)"|„([^”\n]*)”|“([^”\n]*)”|«([^»\n]*)»|'([^'\n]*)'/g,
    (whole, ...groups: unknown[]) => {
      const content = groups.slice(0, 5).find((group): group is string => typeof group === "string");
      return content && (products.some((product) => normalize(product.name) === content) || [...content.matchAll(externalSeller)].length > 0)
        ? ` ${content} ` : whole;
    });
  return unquoted(protectedNames);
}
const externalSeller = /\b(?:(?:inn\w*|zewnetrzn\w*|obc\w*|konkurencyjn\w*)\s+(?:(?:internetow\w*|online)\s+)?(?:sklep\w*|sprzedawc\w*|stron\w*|witryn\w*|serwis\w*)|(?:sklep\w*|sprzedawc\w*)\s+konkurencj\w*|(?:other|another|different|external|third[- ]party)\s+(?:(?:online|web)\s+)?(?:stores?|shops?|retailers?|sellers?|vendors?|sites?|websites?|marketplaces?))\b|https?:\/\/|\bwww\.|\b[a-z0-9][a-z0-9-]*\.[a-z]{2,}(?=\b|\/)/g;
const cartVerb = /\b(?:add|dodaj|dodac|dodasz|buy|biore|wezme|kupuje|take)\b/;
const localProvenance = /\b(?:z\s+(?:(?:naszego|waszego|tego|tutejszego)\s+)(?:sklepu|katalogu)|from\s+(?:(?:our|your|this)\s+)(?:store|shop|catalog|catalogue))\b/g;
const ambiguousExternalReference = /\b(?:tam|stamtad|tamtego|tamta|tamten|there|therefrom|that one|same (?:item|product)|ten sam|ten produkt z zewnatrz)\b|\b(?:add|buy|take)\s+(?:it|them|that|this)\b|\b(?:dodaj|dodac|dodasz)\s+(?:go|je|to|tego)\b/;

/** Isolate a new, explicitly named local command after a separate external-seller mention. */
function independentLocalCartClause(value: string): string | undefined {
  const mentions = [...value.matchAll(externalSeller)];
  if (!mentions.length) return value;
  const lastMentionEnd = mentions.at(-1)!.index! + mentions.at(-1)![0].length;
  const boundaries = [...value.matchAll(/[.!?;](?=\s|$)\s*|\b(?:ale|jednak|natomiast|but|however|instead)\b/g)];
  for (const boundary of boundaries) {
    const start = boundary.index! + boundary[0].length;
    if (start < lastMentionEnd) continue;
    const rest = value.slice(start).trim();
    const nextBoundary = /[.!?;](?=\s|$)|\b(?:ale|jednak|natomiast|but|however|instead)\b/.exec(rest);
    const clause = (nextBoundary ? rest.slice(0, nextBoundary.index) : rest).trim();
    if (!cartVerb.test(clause) || ambiguousExternalReference.test(clause)) continue;
    const named = products.filter((product) => {
      const label = normalize(product.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^a-z0-9-])${label}(?=$|[^a-z0-9-])`).test(clause);
    });
    if (!named.length) continue;
    const previous = value.slice(0, start);
    const priorSameName = named.some((product) => previous.includes(normalize(product.name)));
    if (priorSameName && ![...clause.matchAll(localProvenance)].length) continue;
    return clause.replace(localProvenance, " ");
  }
}

/** An external-dependent request is never permission for a local cart mutation. */
export function hasExternalCartDependency(text: string): boolean {
  const value = unquotedWithCatalogNames(normalize(text));
  return [...value.matchAll(externalSeller)].length > 0 && independentLocalCartClause(value) === undefined;
}

/** Deterministic authorization checks effects only; the model owns shopping interpretation. */
export function hasCartInstruction(text: string) {
  const original = unquotedWithCatalogNames(normalize(text));
  const value = independentLocalCartClause(original);
  return (
    value !== undefined &&
    !/\b(?:example|examples|quote|quoted|repeat|story|fiction|simulate|hypothetical|suppose|if|gdyby|gdybym|przyklad\w*|cytuj\w*|powtorz\w*|opowiedz\w*|histori\w*)\b/.test(original) &&
    !/\b(?:never|not|don't|do not|nie|nigdy)\s+(?:(?:actually|really|ever|wcale|faktycznie|naprawde)\s+)*(?:add|buy|take|dodawaj|dodaj|kupuj)\b/.test(original) &&
    // "When I add it to my cart" describes the shopper’s own hypothetical
    // action. It cannot authorize an addition by the assistant.
    cartVerb.test(value.replace(/\b(?:after|before|when|once)\s+(?:i|we)\s+(?:add|put|place|buy)\b[^.!?;,]*/g, " "))
  );
}
type CartProposal = z.infer<typeof cartProposalSchema>;
type CartContext = { resolvedThisTurn: boolean };
const quantityError = "Confirm the number of units for each item.";
export function cartSelectionIds(state: AgentState): string[] {
  return state.lastIds.length > 1
    ? state.lastIds
    : state.resultIds.length > 1
      ? state.resultIds
      : state.comparisonIds.length
        ? state.comparisonIds
        : state.lastIds;
}
const firstReference =
  /\b(?:first|pierwsz(?:y|a|e|ego|emu|ym|ych|ymi|ej)|pierwsi)\b/;
const secondReference =
  /\b(?:second|drug(?:i|a|ie|iego|iemu|im|ich|imi|iej))\b/;
const cheaperReference =
  /\b(?:cheaper|cheapest|(?:naj)?tansz(?:y|a|e|ego|emu|ym|ych|ymi|ej))\b|less expensive/;
export function cartSelectionKind(
  value: string,
): "both" | "first" | "second" | "cheapest" | "all" | undefined {
  if (/\b(?:both|oba|obie|obydwa|obydwie|obydwu)\b/.test(value)) return "both";
  if (firstReference.test(value)) return "first";
  if (secondReference.test(value)) return "second";
  if (cheaperReference.test(value)) return "cheapest";
  if (
    /\b(?:all|each|wszystkie|wszystkich|wszystko|kazdy|kazda|kazde|kazdego|kazdej|kazdym|kazdych|kazdemu|kazdymi)\b/.test(
      value,
    )
  )
    return "all";
}
const inflection =
  "(?:s|es|a|y|i|e|u|ow|om|ami|ach|iem|em|ka|ki|ke|ek|kach|kom|kami|ce)?";
function operandClause(value: string, proposal: CartProposal): string {
  const ends: number[] = [];
  for (const item of proposal.items) {
    const p = products.find((p) => p.id === item.productId);
    if (!p) continue;
    for (const label of [p.id, p.id.replaceAll("-", " "), p.name]) {
      const escaped = normalize(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const m of value.matchAll(
        new RegExp(`\\b${escaped}${inflection}\\b`, "g"),
      ))
        ends.push(m.index! + m[0].length);
    }
  }
  if (proposal.selection !== "named")
    for (const m of value.matchAll(
      /\b(?:(?:first|second|selected|cheaper|cheapest|this|that)\s+(?:one|product|item|option)|(?:pierwsz(?:y|a|e|ego|emu|ym|ych|ymi|ej)|drug(?:i|a|ie|iego|iemu|im|ich|imi|iej)|wybran\w*|tansz\w*|ten|tego)\s+produkt\w*|it|(?:first|second|this|that|pierwsz(?:y|a|e|ego|emu|ym|ych|ymi|ej)|drug(?:i|a|ie|iego|iemu|im|ich|imi|iej))(?=\s+(?:to|do)\b|[,;.!?]|$))\b/g,
    ))
      ends.push(m.index! + m[0].length);
  for (const m of value.matchAll(
    /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|jeden|dwa|dwie|trzy|cztery|piec|szesc|siedem|osiem|dziewiec|dziesiec)\s+(?:units?|pieces?|sztuk\w*)\b/g,
  ))
    ends.push(m.index! + m[0].length);
  for (const end of ends.sort((a, b) => a - b)) {
    const tail = value
      .slice(end)
      .replace(
        /^\s*(?:(?:to|into|do)\s+(?:(?:my|the)\s+)?(?:cart|basket|koszyk\w*))?/i,
        "",
      )
      .replace(/^[\s,;.!?]+/, "");
    const confirmation =
      /^(?:ask me.*confirm|confirm with me|zapytaj.*potwierdz|potwierdz.*najpierw)/.test(
        tail,
      );
    if (
      !confirmation &&
      !/\b(?:is|are|like|likes|love|jest|sa|podoba|lubie|has|have|ma|looks|seems)\b/.test(
        tail,
      )
    )
      continue;
    if (
      /^(?:and|or|oraz|lub|i)\b/.test(tail) &&
      !/^(?:and\s+(?:it|they)\s+(?:is|are)|(?:i|oraz)\s+(?:jest|sa)|i\s+(?:like|love))\b/.test(
        tail,
      )
    )
      continue;
    if (
      proposal.selection === "named" &&
      !confirmation &&
      !/^(?:i|it|they|we|you|is|are|jest|sa|podoba|lubie|has|ma|looks|seems)\b/.test(
        tail,
      )
    )
      continue;
    if (hasCartInstruction(tail)) continue;
    return value.slice(0, end);
  }
  return value;
}
export function cartInstructionText(text: string): string {
  const original = normalize(text);
  const safe = unquotedWithCatalogNames(original);
  const value = [...safe.matchAll(externalSeller)].length ? independentLocalCartClause(safe) ?? original : original;
  return operandClause(value, {
    selection: "selected",
    items: products.map((p) => ({ productId: p.id, quantity: 1 })),
  });
}
function cartClause(text: string, context?: CartContext) {
  const original = normalize(text);
  const safe = unquotedWithCatalogNames(original);
  let value = [...safe.matchAll(externalSeller)].length ? independentLocalCartClause(safe) ?? original : original;
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
  const clause = operandClause(cartClause(text, context), proposal);
  const operandError = authorizeCart(
    text,
    state,
    {
      ...proposal,
      items: proposal.items.map((item) => ({ ...item, quantity: 1 })),
    },
    context,
    false,
  );
  if (operandError) return { error: operandError };
  const amounts = resolvedQuantities(clause, proposal.items);
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
  checkQuantities = true,
) {
  if (!hasCartInstruction(text)) return "Explicit cart instruction required.";
  const value = operandClause(cartClause(text, context), proposal);
  const items = proposal.items;
  const positions = [firstReference, secondReference, cheaperReference].filter(
    (pattern) => pattern.test(value),
  ).length;
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
  const selection = cartSelectionKind(value) ?? proposal.selection;
  // Parse the purchase operand independently of harmless commentary after a comma.
  // Quantity parsing still uses the whole instruction ("both, two each").
  let remainder = operandClause(value, proposal);
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
      remainder = remainder.replace(
        new RegExp(`\\b${escaped}${inflection}\\b`, "g"),
        " ",
      );
    }
  }
  remainder = remainder
    .replace(
      /\b(?:add|dodaj|dodac|dodasz|biore|wezme|kupuje|buy|take|choose|can|could|would|you|i|we|please|prosze|poprosze|mozesz|moge|chcialbym|czy|do|to|my|the|a|an|this|that|it|these|those|one|two|three|four|five|six|seven|eight|nine|ten|jeden|jedna|jedno|dwa|dwie|trzy|cztery|piec|szesc|siedem|osiem|dziewiec|dziesiec|ta|te|tego|(?:naj)?tansz(?:y|a|e|ego|emu|ym|ych|ymi|ej)|drozsz(?:y|a|e|ego|emu|ym|ych|ymi|ej)|cheaper|cheapest|less|expensive|first|second|pierwsz(?:y|a|e|ego|emu|ym|ych|ymi|ej)|drug(?:i|a|ie|iego|iemu|im|ich|imi|iej)|both|all|oba|obie|obydw(?:a|ie|u)|wszystk(?:ie|ich|o)|each|kazd(?:y|a|e|ego|ej|ym|ych|emu|ymi)|again|another|more|jeszcze|ponownie|wiecej|kolejn(?:y|a|e|ego|ej|ym|ych|emu|ymi)|products?|produkt(?:u|y|ow|om|ami|ach|em|owi)?|items?|options?|of|and|or|i|cart|basket|koszyk(?:a|u|i|ow|om|ami|ach|iem)?|szt(?:uk(?:a|i|e|om|ami|ach)?)?|units?|pieces?|them|x)\b/g,
      " ",
    )
    .replace(/[^a-z]+/g, " ")
    .trim();
  if (remainder)
    return "The selection contains an unresolved reference. Please name the product or use its position.";
  if (selection === "first" && !firstReference.test(value))
    return "Ask which product.";
  if (selection === "second" && !secondReference.test(value))
    return "Ask which product.";
  if (selection === "cheapest" && !cheaperReference.test(value))
    return "Ask which product.";
  if (selection === "both" && !/\bboth\b|\boba\b|\bobie\b|obydw/.test(value))
    return "Ask which products.";
  if (selection === "all" && !/\ball\b|wszystk|\beach\b|kazd\w*/.test(value))
    return "Ask which products.";
  const amounts = checkQuantities
    ? resolvedQuantities(operandClause(value, proposal), items)
    : items.map((item) => item.quantity);
  if (
    checkQuantities &&
    (!amounts || items.some((item, index) => item.quantity !== amounts[index]))
  )
    return quantityError;
  if (new Set(items.map((p) => p.productId)).size !== items.length)
    return "Choose distinct items.";
  const candidates = cartSelectionIds(state);
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
      expected = candidates.slice(0, 1);
      break;
    case "second":
      expected = candidates.slice(1, 2);
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
        : state.lastIds.length === 1
          ? state.lastIds
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
