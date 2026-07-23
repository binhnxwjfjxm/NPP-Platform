import test from "node:test";
import assert from "node:assert/strict";
import { updateFieldCheckResult } from "./field-check-mutations.js";

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "field-check-request-12345678",
  idempotencyKey: "field-check-idem-12345678",
  receivedAt: "2026-07-16T16:45:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "backend-token" }
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("field-check update maps presentation status and sends whitelisted context", async () => {
  const calls = [];
  const result = await updateFieldCheckResult({
    resultId: "result-1",
    productId: "product-1",
    productName: "Sản phẩm A",
    status: "opportunity",
    note: "Khách quan tâm",
    fileId: "file-1",
    customerId: "customer-1",
    sessionId: "session-1",
    sessionCustomerId: "session-customer-1",
    routeId: "route-1",
    sessionDate: "2026-07-16",
    ignored: "must-not-pass"
  }, context, config, {
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return response({ id: "result-1", status: "interested" });
    }
  });

  assert.equal(result.id, "result-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_update_field_check_result$/);
  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_status, "interested");
  assert.equal(args.p_result_id, "result-1");
  assert.equal(args.p_context.requestId, context.requestId);
  assert.deepEqual(args.p_input_meta, {
    fileId: "file-1",
    customerId: "customer-1",
    sessionId: "session-1",
    sessionCustomerId: "session-customer-1",
    routeId: "route-1",
    sessionDate: "2026-07-16"
  });
  assert.equal("ignored" in args.p_input_meta, false);
});

test("field-check status mapping preserves the canonical DB vocabulary", async () => {
  const mapped = [];
  for (const [presentation, persisted] of [
    ["normal", "ok"],
    ["opportunity", "interested"],
    ["risk", "bad"]
  ]) {
    await updateFieldCheckResult({
      resultId: `result-${presentation}`,
      productName: "Sản phẩm A",
      status: presentation
    }, context, config, {
      fetchImpl: async (_url, init) => {
        mapped.push(JSON.parse(init.body).p_status);
        return response({ id: `result-${presentation}`, status: persisted });
      }
    });
  }
  assert.deepEqual(mapped, ["ok", "interested", "bad"]);
});

test("field-check validation fails before provider access", async () => {
  let providerCalled = false;
  await assert.rejects(
    updateFieldCheckResult({ productName: "Sản phẩm A", status: "normal" }, context, config, {
      fetchImpl: async () => { providerCalled = true; }
    }),
    (error) => error.code === "result_id_required" && error.statusCode === 400
  );
  await assert.rejects(
    updateFieldCheckResult({ resultId: "result-1", productName: "Sản phẩm A", status: "pending" }, context, config, {
      fetchImpl: async () => { providerCalled = true; }
    }),
    (error) => error.code === "invalid_field_check_status" && error.statusCode === 400
  );
  assert.equal(providerCalled, false);
});

test("field-check business errors map to stable HTTP status", async () => {
  await assert.rejects(
    updateFieldCheckResult({ resultId: "missing", productName: "Sản phẩm A", status: "normal" }, context, config, {
      fetchImpl: async () => response({ message: "field_check_result_not_found" }, 400)
    }),
    (error) => error.code === "field_check_result_not_found" && error.statusCode === 404
  );

  await assert.rejects(
    updateFieldCheckResult({ resultId: "result-1", productName: "Sản phẩm A", status: "normal" }, context, config, {
      fetchImpl: async () => response({ message: "field_check_session_customer_mismatch" }, 400)
    }),
    (error) => error.code === "field_check_session_customer_mismatch" && error.statusCode === 409
  );
});
