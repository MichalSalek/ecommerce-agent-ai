import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeCart,
  hasCartInstruction,
  prepareCartProposal,
} from "../src/application/chat/cart-authorization";
import { initialAgentState } from "../src/application/chat/shopping-v3";
const state = {
  ...initialAgentState(),
  lastIds: ["mugs", "carafe"],
  comparisonIds: ["mugs", "carafe"],
};
test("explicit both and cheaper selections validate operands independent of descriptive model labels", () => {
  assert.equal(
    authorizeCart("Add both to my cart", state, {
      selection: "named",
      items: [
        { productId: "mugs", quantity: 1 },
        { productId: "carafe", quantity: 1 },
      ],
    }),
    undefined,
  );
  assert.equal(
    authorizeCart("Dodaj dwie sztuki tańszego produktu do koszyka", state, {
      selection: "named",
      items: [{ productId: "carafe", quantity: 2 }],
    }),
    undefined,
  );
  assert.ok(
    authorizeCart(
      "Add the cheaper one",
      {
        ...state,
        lastIds: ["mugs", "wine-glasses"],
        comparisonIds: ["mugs", "wine-glasses"],
      },
      { selection: "named", items: [{ productId: "mugs", quantity: 1 }] },
    ),
  );
});
test("unresolved nouns, negated selectors and proposal quantities do not authorize a different purchase", () => {
  assert.ok(
    authorizeCart(
      "Add the first one to my cart, actually the second instead",
      state,
      {
        selection: "first",
        items: [{ productId: "mugs", quantity: 1 }],
      },
    ),
  );
  assert.ok(
    authorizeCart("Add the first unicorn to my cart", state, {
      selection: "first",
      items: [{ productId: "mugs", quantity: 1 }],
    }),
  );
  assert.ok(
    authorizeCart("Add not the first one", state, {
      selection: "first",
      items: [{ productId: "mugs", quantity: 1 }],
    }),
  );
  assert.ok(
    authorizeCart("Show five proposals", state, {
      selection: "all",
      items: [{ productId: "mugs", quantity: 5 }],
    }),
  );
  assert.ok(
    authorizeCart("Add both to my cart", state, {
      selection: "both",
      items: [
        { productId: "mugs", quantity: 2 },
        { productId: "carafe", quantity: 2 },
      ],
    }),
  );
});

test("a current resolved read permits only a grounded trailing cart instruction", () => {
  const furniture = {
    ...initialAgentState(),
    lastIds: ["folding-garden-chair", "garden-bench"],
    comparisonIds: [],
  };
  const cheaper = {
    selection: "named" as const,
    items: [{ productId: "folding-garden-chair", quantity: 1 }],
  };
  const text =
    "Find garden furniture under EUR150 and add the cheapest to my cart";
  assert.equal(
    authorizeCart(text, furniture, cheaper, { resolvedThisTurn: true }),
    undefined,
  );
  assert.ok(authorizeCart(text, furniture, cheaper));
  assert.ok(
    authorizeCart(text, furniture, cheaper, { resolvedThisTurn: false }),
  );
  assert.equal(
    authorizeCart(
      "Pokaż meble ogrodowe i dodaj tańszy produkt do koszyka",
      furniture,
      cheaper,
      { resolvedThisTurn: true },
    ),
    undefined,
  );
  assert.ok(
    authorizeCart(
      "Find garden furniture and add the cheapest unicorn to my cart",
      furniture,
      cheaper,
      { resolvedThisTurn: true },
    ),
  );
  assert.ok(
    authorizeCart(
      "Find garden furniture and add the cheapest",
      furniture,
      cheaper,
      { resolvedThisTurn: true },
    ),
  );
  assert.ok(
    authorizeCart(
      "Write about furniture and add the cheapest to my cart",
      furniture,
      cheaper,
      { resolvedThisTurn: true },
    ),
  );
  assert.ok(
    authorizeCart(
      "Find garden furniture add the cheapest to my cart",
      furniture,
      cheaper,
      { resolvedThisTurn: true },
    ),
  );
  assert.ok(
    authorizeCart(
      text,
      furniture,
      { ...cheaper, items: [{ productId: "garden-bench", quantity: 1 }] },
      { resolvedThisTurn: true },
    ),
  );
  assert.ok(
    authorizeCart(
      text,
      furniture,
      {
        ...cheaper,
        items: [{ productId: "folding-garden-chair", quantity: 2 }],
      },
      { resolvedThisTurn: true },
    ),
  );
  assert.ok(
    authorizeCart(
      "Find five garden furniture items and add the cheapest to my cart",
      furniture,
      {
        ...cheaper,
        items: [{ productId: "folding-garden-chair", quantity: 5 }],
      },
      { resolvedThisTurn: true },
    ),
  );
});

test("quoted examples, stories and explicit negative commands never authorize effects", () => {
  const proposal = {
    selection: "first" as const,
    items: [{ productId: "mugs", quantity: 1 }],
  };
  for (const text of [
    'The example is "add the first one to my cart"',
    "Repeat 'add the first one to my cart'",
    "Tell a story: add the first one to my cart",
    "Never add the first one to my cart",
    "Don't actually add the first one to my cart",
    "Do not actually add the first one to my cart",
    "Nie dodawaj pierwszego do koszyka",
    "Find furniture and never add the first one to my cart",
  ]) {
    assert.equal(hasCartInstruction(text), false, text);
    assert.ok(
      authorizeCart(text, state, proposal, { resolvedThisTurn: true }),
      text,
    );
  }
  for (const quantity of [0, 1.5, 100, NaN])
    assert.ok(
      authorizeCart("Add the first one to my cart", state, {
        ...proposal,
        items: [{ productId: "mugs", quantity }],
      }),
    );
});

test("explicit single-item quantities replace incorrect model quantities without changing the selected product", () => {
  const proposal = {
    selection: "cheapest" as const,
    items: [{ productId: "carafe", quantity: 1 }],
  };
  for (const text of [
    "Add two of the cheaper to my cart",
    "Dodaj dwie sztuki tańszego produktu do koszyka",
  ]) {
    assert.ok(authorizeCart(text, state, proposal));
    const result = prepareCartProposal(text, state, proposal);
    assert.ok("proposal" in result);
    assert.deepEqual(result.proposal.items, [
      { productId: "carafe", quantity: 2 },
    ]);
    assert.equal(authorizeCart(text, state, result.proposal), undefined);
  }
  const result = prepareCartProposal(
    "Add ten of the cheaper to my cart",
    state,
    proposal,
  );
  assert.ok("proposal" in result);
  assert.equal(result.proposal.items[0].quantity, 10);
  const polish = prepareCartProposal(
    "Dodaj ten produkt do koszyka",
    { ...state, lastIds: ["mugs"], comparisonIds: [] },
    { selection: "selected", items: [{ productId: "mugs", quantity: 1 }] },
  );
  assert.ok("proposal" in polish);
  assert.equal(polish.proposal.items[0].quantity, 1);
});

test("mixed quantities bind to named products, not model order", () => {
  const text = "Add 2 mugs and 1 carafe to my cart";
  const proposed = {
    selection: "named" as const,
    items: [
      { productId: "carafe", quantity: 2 },
      { productId: "mugs", quantity: 1 },
    ],
  };
  assert.ok(authorizeCart(text, state, proposed));
  const result = prepareCartProposal(text, state, proposed);
  assert.ok("proposal" in result);
  assert.deepEqual(result.proposal.items, [
    { productId: "carafe", quantity: 1 },
    { productId: "mugs", quantity: 2 },
  ]);
  assert.equal(authorizeCart(text, state, result.proposal), undefined);
  assert.ok(
    "error" in
      prepareCartProposal("Add 2 mugs and carafe to my cart", state, proposed),
  );
  assert.ok(
    "error" in
      prepareCartProposal(
        "Add 2 mugs and 1 carafe and 3 to my cart",
        state,
        proposed,
      ),
  );
  assert.ok(
    "error" in
      prepareCartProposal("Add 2 mugs and 3 mugs to my cart", state, {
        selection: "named",
        items: [{ productId: "mugs", quantity: 2 }],
      }),
  );
});

test("invalid and ambiguous quantities fail and people counts do not become units", () => {
  const both = {
    selection: "both" as const,
    items: [
      { productId: "mugs", quantity: 1 },
      { productId: "carafe", quantity: 1 },
    ],
  };
  const untouched = prepareCartProposal("Add both to my cart", state, both);
  assert.ok("proposal" in untouched);
  assert.deepEqual(untouched.proposal.items, both.items);
  const each = prepareCartProposal(
    "Add both, two each to my cart",
    state,
    both,
  );
  assert.ok("proposal" in each);
  assert.deepEqual(
    each.proposal.items.map((item) => item.quantity),
    [2, 2],
  );
  const eachOfShown = prepareCartProposal(
    "Add two of each to my cart",
    state,
    both,
  );
  assert.ok("proposal" in eachOfShown);
  assert.deepEqual(
    eachOfShown.proposal.items.map((item) => item.quantity),
    [2, 2],
  );
  const single = {
    selection: "cheapest" as const,
    items: [{ productId: "carafe", quantity: 1 }],
  };
  assert.ok(
    "error" in
      prepareCartProposal("Add 100 of the cheaper to my cart", state, single),
  );
  assert.ok(
    "error" in
      prepareCartProposal("Add 0 of the cheaper to my cart", state, single),
  );
  assert.ok(
    authorizeCart("Add the cheaper for 5 people", state, {
      ...single,
      items: [{ productId: "carafe", quantity: 5 }],
    }),
  );
  assert.ok(
    "error" in prepareCartProposal("Add two of both to my cart", state, both),
  );
});
