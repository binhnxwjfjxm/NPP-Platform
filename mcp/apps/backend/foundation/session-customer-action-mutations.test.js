import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionCustomerFollowup,
  createSessionCustomerOrder,
  createSessionCustomerReport,
  createSessionCustomerTest
} from "./session-customer-action-mutations.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-session-action-12345678",
  idempotencyKey: "session-action.create:12345678",
  receivedAt: "2026-07-18T06:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "backend-token" }
};

function provider(calls, payload = { data: { id: "result-1" }, meta: { idempotency: { replayed: false } } }) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
}

test("order/test/report/follow-up use typed idempotent RPCs with trusted Foundation context", async () => {
  const calls = [];
  const fetchImpl = provider(calls);

  await createSessionCustomerOrder({
    sessionCustomerId: "sc-1",
    items: [{ productName: "Trà", quantity: 2, unitPrice: 10000 }],
    note: "Đơn thử"
  }, context, config, { fetchImpl });

  await createSessionCustomerTest({
    sessionCustomerId: "sc-1",
    results: [{ productName: "Trà", status: "ok", note: "Đạt" }]
  }, context, config, { fetchImpl });

  await createSessionCustomerReport({
    sessionCustomerId: "sc-1",
    reportType: "market_report",
    fields: { opportunitySummary: "Có nhu cầu" },
    selected: { competitors: [{ id: "competitor-a", label: "Đối thủ A" }] },
    context: { customerName: "Điểm bán A" }
  }, context, config, { fetchImpl });

  await createSessionCustomerFollowup({
    sessionCustomerId: "sc-1",
    title: "Gọi lại",
    priority: "high",
    dueDate: "2026-07-20"
  }, context, config, { fetchImpl });

  const rpcNames = calls.map((call) => new URL(call.url).pathname.split("/").at(-1));
  assert.deepEqual(rpcNames, [
    "mcp_idempotent_create_order_from_session_customer",
    "mcp_idempotent_create_test_from_session_customer",
    "mcp_idempotent_create_report_from_session_customer",
    "mcp_idempotent_create_followup_from_session_customer"
  ]);

  for (const call of calls) {
    const args = JSON.parse(call.init.body);
    assert.equal(args.p_context.requestId, context.requestId);
    assert.equal(args.p_context.idempotencyKey, context.idempotencyKey);
    assert.equal(args.p_context.installationId, "installation-a");
    assert.equal(args.p_context.actorId, "service:npp-a:mcp-v1");
  }

  const orderArgs = JSON.parse(calls[0].init.body);
  assert.equal(orderArgs.p_items[0].quantity, 2);
  assert.equal(orderArgs.p_items[0].unitPrice, 10000);

  const reportArgs = JSON.parse(calls[2].init.body);
  assert.deepEqual(reportArgs.p_selected_competitor_ids, ["competitor-a"]);
  assert.match(reportArgs.p_content, /Đối thủ A|Có nhu cầu/);
});

test("session action validation rejects invalid input before provider access", async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error("provider_must_not_be_called");
  };

  await assert.rejects(
    createSessionCustomerOrder({ sessionCustomerId: "sc-1", items: [] }, context, config, { fetchImpl }),
    (error) => error.message === "order_items_required" && error.statusCode === 400
  );

  await assert.rejects(
    createSessionCustomerTest({ sessionCustomerId: "sc-1", results: [{ productName: "Trà", status: "unknown" }] }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_test_status" && error.statusCode === 400
  );

  await assert.rejects(
    createSessionCustomerFollowup({ sessionCustomerId: "sc-1", title: "" }, context, config, { fetchImpl }),
    (error) => error.message === "followup_title_required" && error.statusCode === 400
  );

  assert.equal(providerCalls, 0);
});
