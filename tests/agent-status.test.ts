import { test } from "node:test";
import assert from "node:assert/strict";
import { agentFailureStatus } from "../src/infrastructure/chat/native-agent";

test("timeout and temporary provider unavailability have distinct safe statuses", () => {
  const signal = new AbortController().signal;
  const timeout = agentFailureStatus(
    new DOMException("private timeout detail", "TimeoutError"),
    signal,
    1000,
  );
  assert.equal(timeout.status, "connection-error");
  assert.equal(timeout.code, "TIMEOUT");
  assert.doesNotMatch(JSON.stringify(timeout), /private timeout detail/);
  const unavailable = agentFailureStatus(
    {
      statusCode: 429,
      message: "secret provider details",
      responseHeaders: {
        "retry-after": "60",
        "x-aurelle-error-code": "provider-unavailable",
      },
    },
    signal,
    1000,
  );
  assert.equal(unavailable.status, "connection-error");
  assert.equal(unavailable.code, "NETWORK_ERROR");
  assert.equal(unavailable.retryAfter, 60);
  assert.equal(unavailable.retryAt, 61000);
  assert.equal(unavailable.providerLimit, undefined);
  assert.doesNotMatch(JSON.stringify(unavailable), /secret provider details/);
});

test("legacy read buttons retain the last group after inspecting one product", async () => {
  const { initialAgentState, legacyButtonAction } =
    await import("../src/application/chat/shopping-v3");
  const state = {
    ...initialAgentState(),
    lastIds: ["mugs"],
    resultIds: ["mugs", "carafe", "travel-mug"],
  };
  assert.deepEqual(legacyButtonAction("Compare these products", state), {
    type: "compare",
    productIds: state.resultIds,
  });
  assert.deepEqual(
    legacyButtonAction("Tell me more about the first product", state),
    { type: "details", productId: "mugs" },
  );
  assert.equal(
    legacyButtonAction("Add the first product to my cart", state),
    undefined,
  );
  assert.equal(
    legacyButtonAction("Compare these products except mugs", state),
    undefined,
  );
});
