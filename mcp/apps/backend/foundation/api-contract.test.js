import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalErrorPayload,
  canonicalSuccessPayload,
  normalizeApiPayload,
  sanitizePublicDetails
} from "./api-contract.js";

test("success envelope has only canonical transport fields", () => {
  const payload = canonicalSuccessPayload({ id: "route-1" }, {
    requestId: "request_12345678",
    receivedAt: "2026-07-14T00:00:00.000Z"
  });
  assert.deepEqual(payload, {
    data: { id: "route-1" },
    receivedAt: "2026-07-14T00:00:00.000Z",
    requestId: "request_12345678"
  });
});

test("provider failures never expose provider diagnostics", () => {
  const result = canonicalErrorPayload(
    {
      message: "supabase_read_failed",
      statusCode: 502,
      providerMessage: "column orders.secret does not exist",
      table: "orders",
      details: { table: "orders", sql: "select *", safeReason: "temporarily unavailable" }
    },
    { requestId: "request_12345678", receivedAt: "2026-07-14T00:00:00.000Z" }
  );

  assert.equal(result.statusCode, 502);
  assert.equal(result.payload.error.code, "PROVIDER_UNAVAILABLE");
  assert.equal(result.payload.error.retryable, true);
  assert.deepEqual(result.payload.error.details, { safeReason: "temporarily unavailable" });
  assert.equal(JSON.stringify(result.payload).includes("orders"), false);
  assert.equal(JSON.stringify(result.payload).includes("select *"), false);
});

test("legacy wrapped success is normalized without nesting data twice", () => {
  const result = normalizeApiPayload(
    { data: [{ id: "route-1" }], receivedAt: "old", ok: true },
    { status: 200, requestId: "request_12345678", receivedAt: "2026-07-14T00:00:00.000Z" }
  );
  assert.deepEqual(result.payload, {
    data: [{ id: "route-1" }],
    receivedAt: "2026-07-14T00:00:00.000Z",
    requestId: "request_12345678"
  });
});

test("legacy string errors become stable uppercase codes and generic messages", () => {
  const result = normalizeApiPayload(
    { ok: false, error: "session_closed", detail: "rpc mcp_update_route_session failed" },
    { status: 409, requestId: "request_12345678", receivedAt: "2026-07-14T00:00:00.000Z" }
  );
  assert.equal(result.payload.error.code, "SESSION_CLOSED");
  assert.equal(result.payload.error.message, "Dữ liệu đang xung đột với trạng thái hiện tại.");
  assert.deepEqual(result.payload.error.details, {});
});

test("detail sanitizer removes infrastructure-shaped keys recursively", () => {
  assert.deepEqual(
    sanitizePublicDetails({ safe: 1, nested: { token: "x", reason: "valid" }, providerUrl: "https://secret" }),
    { safe: 1, nested: { reason: "valid" } }
  );
});
