import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIdempotencyProviderError,
  unwrapIdempotentMutationResult
} from "./idempotency.js";

test("unwrap preserves business data and replay metadata", () => {
  assert.deepEqual(
    unwrapIdempotentMutationResult({
      data: { id: "row-1" },
      meta: { idempotency: { replayed: true, originalRequestId: "request-original" } }
    }),
    {
      data: { id: "row-1" },
      meta: { idempotency: { replayed: true, originalRequestId: "request-original" } }
    }
  );
});

test("unwrap leaves legacy business results unchanged", () => {
  assert.deepEqual(
    unwrapIdempotentMutationResult({ id: "legacy-row" }),
    { data: { id: "legacy-row" }, meta: null }
  );
});

test("same key different payload becomes non-retryable conflict", () => {
  const error = new Error("provider_request_failed");
  error.providerMessage = "idempotency_key_conflict";

  assert.equal(normalizeIdempotencyProviderError(error), true);
  assert.equal(error.code, "idempotency_key_conflict");
  assert.equal(error.statusCode, 409);
  assert.equal(error.publicRetryable, false);
});

test("active lease becomes retryable conflict with bounded delay", () => {
  const error = new Error("provider_request_failed");
  error.providerMessage = "idempotency_in_progress";
  error.providerDetails = "17";

  assert.equal(normalizeIdempotencyProviderError(error), true);
  assert.equal(error.statusCode, 409);
  assert.equal(error.publicRetryable, true);
  assert.deepEqual(error.publicDetails, { retryAfterSeconds: 17 });
});

test("missing idempotency key is a client error", () => {
  const error = new Error("provider_request_failed");
  error.providerMessage = "idempotency_key_required";

  assert.equal(normalizeIdempotencyProviderError(error), true);
  assert.equal(error.statusCode, 400);
});

test("unrelated provider errors are not reclassified", () => {
  const error = new Error("provider_request_failed");
  error.providerMessage = "database_connection_failed";
  assert.equal(normalizeIdempotencyProviderError(error), false);
});
