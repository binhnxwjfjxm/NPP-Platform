import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleTransitionalApi } from "./transitional-api.js";

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-route-add-12345678",
  idempotencyKey: "route-customer.add:abcdefgh",
  receivedAt: "2026-07-17T09:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "proxy-token" }
};

function request(body) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = "POST";
  stream.headers = {};
  return stream;
}

test("Foundation owns POST /api/route-customers through the typed idempotent RPC", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      data: {
        routeCustomerId: "route-customer-1",
        sessionCustomerId: "session-customer-1",
        includedActiveSession: true
      },
      meta: { idempotency: { replayed: false } }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await handleTransitionalApi(
    request({
      routeId: "route-1",
      customerName: "Điểm bán mới",
      includeActiveSession: true,
      activeSessionId: "session-1"
    }),
    new URL("http://local/api/route-customers"),
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.routeCustomerId, "route-customer-1");
  assert.equal(result.payload.meta.idempotency.replayed, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_add_route_customer$/);
});
