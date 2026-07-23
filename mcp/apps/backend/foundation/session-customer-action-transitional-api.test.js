import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleTransitionalApi } from "./transitional-api.js";

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-session-action-12345678",
  idempotencyKey: "session-action.create:abcdefgh",
  receivedAt: "2026-07-18T06:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "proxy-token" }
};

function request(body) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = "POST";
  stream.headers = {};
  return stream;
}

const cases = [
  {
    route: "/api/mcp-day/session-customer/order",
    rpc: "mcp_idempotent_create_order_from_session_customer",
    body: { sessionCustomerId: "sc-1", items: [{ productName: "Trà", quantity: 1, unitPrice: 10000 }] }
  },
  {
    route: "/api/mcp-day/session-customer/test",
    rpc: "mcp_idempotent_create_test_from_session_customer",
    body: { sessionCustomerId: "sc-1", results: [{ productName: "Trà", status: "ok" }] }
  },
  {
    route: "/api/mcp-day/session-customer/report",
    rpc: "mcp_idempotent_create_report_from_session_customer",
    body: { sessionCustomerId: "sc-1", fields: { opportunitySummary: "Có nhu cầu" } }
  },
  {
    route: "/api/mcp-day/session-customer/followup",
    rpc: "mcp_idempotent_create_followup_from_session_customer",
    body: { sessionCustomerId: "sc-1", title: "Gọi lại" }
  }
];

test("Foundation intercepts four A5.5.2 session action routes before legacy proxy", async () => {
  for (const item of cases) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        data: { sessionCustomerId: "sc-1", resultId: "result-1" },
        meta: { idempotency: { replayed: false } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await handleTransitionalApi(
      request(item.body),
      new URL(`http://local${item.route}`),
      context,
      config,
      { fetchImpl }
    );

    assert.equal(result.statusCode, 200, item.route);
    assert.equal(result.payload.meta.idempotency.replayed, false, item.route);
    assert.equal(calls.length, 1, item.route);
    assert.equal(new URL(calls[0].url).pathname.split("/").at(-1), item.rpc, item.route);
  }
});
