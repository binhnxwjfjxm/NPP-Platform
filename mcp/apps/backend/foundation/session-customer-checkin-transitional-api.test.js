import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleTransitionalApi } from "./transitional-api.js";

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-checkin-route-12345678",
  idempotencyKey: "checkin-route-12345678",
  receivedAt: "2026-07-17T05:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "proxy-token" }
};

function request(body) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = "POST";
  stream.headers = {};
  return stream;
}

test("session check-in route is intercepted by Foundation", async () => {
  const calls = [];
  const result = await handleTransitionalApi(
    request({
      sessionCustomerId: "session-customer-1",
      checkedIn: true,
      geoLat: 10.123,
      geoLng: 106.456,
      geoAccuracy: 6.5,
      geoSource: "browser_manual"
    }),
    new URL("http://local/api/mcp-day/session-customer/checkin"),
    context,
    config,
    {
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({
          data: { checkedIn: true, sessionCustomerId: "session-customer-1" },
          meta: { idempotency: { replayed: false, originalRequestId: context.requestId } }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.checkedIn, true);
  assert.equal(result.payload.meta.idempotency.replayed, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_set_session_customer_checkin$/);
});
