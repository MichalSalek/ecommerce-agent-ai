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
