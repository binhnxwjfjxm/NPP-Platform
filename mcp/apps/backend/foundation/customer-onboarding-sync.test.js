import test from "node:test";
import assert from "node:assert/strict";
import {
  getCustomerOnboardingProjection,
  submitCustomerOnboarding,
  syncCustomerOnboarding
} from "./customer-onboarding-sync.js";
import { submitCustomerVerification } from "./customer-verification.js";

const context = {
  requestId: "request_mcp_onboarding_12345678",
  installation: { id: "installation-a", nppCode: "NPP-A" }
};
const config = {
  coreOnboarding: {
    configured: true,
    baseUrl: "https://core.example.com",
    apiToken: "core-onboarding-token-0123456789",
    timeoutMs: 1000
  }
};

function fakePersistence() {
  const state = {
    row: {
      session_customer_id: "sc-1",
      session_id: "session-1",
      route_id: "route-1",
      route_customer_id: "outlet-1",
      customer_id: null,
      customer_name: "Điểm bán A",
      phone: "0901234567",
      area: "TP.HCM",
      address: "1 Đường A",
      source: "added",
      session_sales: "Nhân viên A",
      order_id: "order-1",
      order_code: "MCP-001",
      order_status: "confirmed",
      customer_onboarding_request_id: null,
      customer_onboarding_status: null,
      customer_onboarding_version: null,
      customer_onboarding_fingerprint: null,
      core_customer_id: null,
      core_customer_address_id: null,
      customer_onboarding_review_reason: null,
      customer_onboarding_submitted_at: null,
      customer_onboarding_last_synced_at: null,
      order_updated_at: "2026-08-03T00:00:00.000Z"
    },
    updates: 0
  };
  const persistence = {
    async withTransaction(work) {
      return work({
        async query(sql, values) {
          if (sql.includes("FROM mcp.mcp_session_customers")) return { rows: [structuredClone(state.row)] };
          if (sql.includes("UPDATE mcp.orders")) {
            state.row.customer_onboarding_request_id = values[2];
            state.row.customer_onboarding_status = values[3];
            state.row.customer_onboarding_version = values[4];
            state.row.customer_onboarding_fingerprint = values[5];
            state.row.core_customer_id = values[6];
            state.row.core_customer_address_id = values[7];
            state.row.customer_onboarding_review_reason = values[8];
            state.row.customer_onboarding_submitted_at = values[9];
            state.row.customer_onboarding_last_synced_at = values[10];
            state.updates += 1;
            return { rows: [{ id: "order-1" }] };
          }
          throw new Error(`unexpected_sql:${sql}`);
        }
      });
    }
  };
  return { persistence, state };
}

function fetchSequence(statuses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return new Response(JSON.stringify({
      data: {
        customerOnboardingRequest: {
          id: "core-request-1",
          status,
          version: calls.length,
          approvedCustomerId: status === "approved" ? "customer-1" : null,
          approvedCustomerAddressId: status === "approved" ? "address-1" : null,
          reviewReason: status === "need_more_info" ? "Bổ sung địa chỉ" : null,
          updatedAt: "2026-08-03T00:00:00.000Z"
        }
      }
    }), { status: init.method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } });
  };
  return { fetchImpl, calls };
}

test("explicit order intent submission keeps legacy business identity but uses canonical idempotency generator", async () => {
  const { persistence, state } = fakePersistence();
  const { fetchImpl, calls } = fetchSequence(["submitted"]);
  const result = await submitCustomerOnboarding(
    { sessionCustomerId: "sc-1", orderId: "order-1" },
    context,
    config,
    { persistence, fetchImpl }
  );

  assert.equal(result.orderId, "order-1");
  assert.equal(result.coreRequestId, "core-request-1");
  assert.equal(result.status, "submitted");
  assert.equal(result.officialOrderAllowed, false);
  assert.equal(state.updates, 1);
  assert.equal(calls.length, 1);
  const requestBody = JSON.parse(calls[0].init.body);
  assert.equal(requestBody.sourceSystem, "MCP");
  assert.equal(requestBody.sourceOutletId, "outlet-1");
  assert.equal(requestBody.sourceDemandReference, "order-1");
  assert.equal(requestBody.orderRequired, true);
  assert.equal(requestBody.proposedCustomer.address.addressLine1, "1 Đường A");
  assert.equal(requestBody.sourceMetadata.sessionOwner, "Nhân viên A");
  assert.match(calls[0].init.headers["Idempotency-Key"], /^mcp\.customer-onboarding\.submit-[0-9a-f-]{36}$/);

  const local = await getCustomerOnboardingProjection({ sessionCustomerId: "sc-1" }, context, config, { persistence });
  assert.equal(local.coreRequestId, "core-request-1");
});

test("retry syncs the existing Core request and does not create another request", async () => {
  const { persistence } = fakePersistence();
  const first = fetchSequence(["submitted"]);
  await submitCustomerOnboarding({ sessionCustomerId: "sc-1" }, context, config, { persistence, fetchImpl: first.fetchImpl });

  const retry = fetchSequence(["under_review"]);
  const result = await submitCustomerOnboarding({ sessionCustomerId: "sc-1" }, context, config, { persistence, fetchImpl: retry.fetchImpl });
  assert.equal(retry.calls.length, 1);
  assert.equal(retry.calls[0].init.method, "GET");
  assert.match(retry.calls[0].url, /core-request-1$/);
  assert.equal(result.status, "under_review");
});

test("approved Core status stores customer references and unblocks only the later official-order phase", async () => {
  const { persistence } = fakePersistence();
  const submitted = fetchSequence(["submitted"]);
  await submitCustomerOnboarding({ sessionCustomerId: "sc-1" }, context, config, { persistence, fetchImpl: submitted.fetchImpl });
  const approved = fetchSequence(["approved"]);
  const result = await syncCustomerOnboarding({ sessionCustomerId: "sc-1" }, context, config, { persistence, fetchImpl: approved.fetchImpl });
  assert.equal(result.officialOrderAllowed, true);
  assert.equal(result.coreCustomerId, "customer-1");
  assert.equal(result.coreCustomerAddressId, "address-1");
  assert.equal(result.reviewReason, null);
});

test("outlet without an address is blocked before Core access", async () => {
  const { persistence, state } = fakePersistence();
  state.row.address = null;
  let called = false;
  await assert.rejects(
    submitCustomerOnboarding({ sessionCustomerId: "sc-1" }, context, config, { persistence, fetchImpl: async () => { called = true; } }),
    (error) => error.code === "customer_address_required" && error.statusCode === 400
  );
  assert.equal(called, false);
});

test("same demand reference conflicts when the outlet snapshot changes after submission", async () => {
  const { persistence, state } = fakePersistence();
  const submitted = fetchSequence(["submitted"]);
  await submitCustomerOnboarding({ sessionCustomerId: "sc-1" }, context, config, { persistence, fetchImpl: submitted.fetchImpl });
  state.row.address = "2 Đường B";
  let called = false;
  await assert.rejects(
    submitCustomerOnboarding(
      { sessionCustomerId: "sc-1" },
      context,
      config,
      { persistence, fetchImpl: async () => { called = true; } }
    ),
    (error) => error.code === "demand_reference_payload_mismatch" && error.statusCode === 409
  );
  assert.equal(called, false);
});

function fakeVerificationPersistence() {
  const employeeId = "11111111-1111-4111-8111-111111111111";
  const state = {
    row: {
      id: "outlet-1",
      installation_id: "installation-a",
      route_id: "route-1",
      route_name: "Tuyến A",
      route_sales: "NV001",
      employee_code: "NV001",
      employee_name: "Nhân viên A",
      employee_active: true,
      route_employee_matches: 1,
      responsible_employee_id: employeeId,
      customer_name: "Điểm bán A",
      phone: "0901234567",
      area: "TP.HCM",
      address: "1 Đường A",
      active: true,
      core_onboarding_request_id: null,
      core_onboarding_status: null,
      core_customer_id: null,
      core_customer_address_id: null,
      core_customer_code: null,
      customer_onboarding_review_reason: null,
      customer_verification_operation_id: null,
      customer_verification_idempotency_key: null,
      customer_verification_payload: null,
      customer_verification_fingerprint: null,
      customer_verification_submitted_at: null,
      last_core_sync_at: null,
      updated_at: "2026-08-15T00:00:00.000Z"
    }
  };
  return {
    employeeId,
    state,
    persistence: {
      async withTransaction(work) {
        return work({
          async query(sql, values) {
            if (sql.includes("FROM mcp.mcp_route_customers AS rc") && sql.includes("JOIN mcp.mcp_routes")) {
              return { rows: [structuredClone(state.row)] };
            }
            if (sql.includes("SET customer_verification_operation_id")) {
              state.row.customer_verification_operation_id = values[2];
              state.row.customer_verification_idempotency_key = values[3];
              state.row.customer_verification_payload = JSON.parse(values[4]);
              state.row.customer_verification_fingerprint = values[5];
              return { rows: [structuredClone(state.row)] };
            }
            if (sql.includes("UPDATE mcp.mcp_route_customers AS rc")) {
              state.row.core_onboarding_request_id = values[2];
              state.row.core_onboarding_status = values[3];
              state.row.core_customer_id = values[4];
              state.row.core_customer_address_id = values[5];
              state.row.customer_onboarding_review_reason = values[6];
              state.row.customer_verification_submitted_at ||= values[7];
              state.row.last_core_sync_at = values[7];
              return { rows: [structuredClone(state.row)] };
            }
            if (sql.startsWith("SELECT mcp.sync_route_customer_media_to_shared")) return { rows: [] };
            throw new Error(`unexpected_verification_sql:${sql}`);
          }
        });
      }
    }
  };
}

test("standalone field verification persists and reuses the exact canonical Core idempotency key after an outbound failure", async () => {
  const { persistence, employeeId } = fakeVerificationPersistence();
  const fieldContext = {
    ...context,
    principal: { employeeId }
  };
  const keys = [];
  await assert.rejects(
    submitCustomerVerification(
      { routeCustomerId: "outlet-1" },
      fieldContext,
      config,
      {
        persistence,
        fetchImpl: async (_url, init) => {
          keys.push(init.headers["Idempotency-Key"]);
          throw new Error("network_down");
        }
      }
    ),
    (error) => error.code === "core_onboarding_unavailable"
  );
  const successFetch = async (_url, init) => {
    keys.push(init.headers["Idempotency-Key"]);
    assert.equal(init.headers["X-NPP-MCP-Employee-Id"], employeeId);
    const body = JSON.parse(init.body);
    assert.equal(body.orderRequired, false);
    assert.equal(body.triggerReason, "FIELD_PROFILE_VERIFICATION");
    assert.equal(body.sourceDemandReference, "FIELD_PROFILE_VERIFICATION");
    assert.equal(Object.prototype.hasOwnProperty.call(body, "orderId"), false);
    return new Response(JSON.stringify({
      data: { customerOnboardingRequest: { id: "core-request-2", status: "submitted", version: 1 } }
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  const result = await submitCustomerVerification(
    { routeCustomerId: "outlet-1" },
    fieldContext,
    config,
    { persistence, fetchImpl: successFetch }
  );
  assert.equal(result.status, "submitted");
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.match(keys[0], /^mcp\.customer-verification\.submit-[0-9a-f-]{36}$/);
});
