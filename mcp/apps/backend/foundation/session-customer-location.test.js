import test from "node:test";
import assert from "node:assert/strict";
import { addSessionCustomer } from "./session-customer-mutations.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-gps-12345678",
  idempotencyKey: "add-customer-gps-1",
  receivedAt: "2026-07-16T07:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "proxy-token" }
};

test("session customer GPS is validated and forwarded to the atomic RPC", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      routeCustomer: { id: "route-customer-1", geo_lat: 10.123, geo_lng: 106.456 },
      sessionCustomer: { id: "session-customer-1" },
      created: true
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await addSessionCustomer({
    sessionId: "session-1",
    customerName: "Khách GPS",
    phone: "0909 111 222",
    geoLat: 10.123,
    geoLng: 106.456,
    geoAccuracy: 8.5,
    geoSource: "browser"
  }, context, config, { fetchImpl });

  assert.equal(result.routeCustomer.id, "route-customer-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_add_session_customer$/);

  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_session_id, "session-1");
  assert.equal(args.p_geo_lat, 10.123);
  assert.equal(args.p_geo_lng, 106.456);
  assert.equal(args.p_geo_accuracy, 8.5);
  assert.equal(args.p_geo_source, "browser");
  assert.equal(args.p_context.requestId, "request-gps-12345678");
});

test("session customer GPS rejects incomplete and out-of-range coordinates before provider access", async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error("provider_must_not_be_called");
  };

  await assert.rejects(
    addSessionCustomer({
      sessionId: "session-1",
      customerName: "Thiếu kinh độ",
      geoLat: 10.1
    }, context, config, { fetchImpl }),
    (error) => error.message === "geo_coordinates_incomplete" && error.statusCode === 400
  );

  await assert.rejects(
    addSessionCustomer({
      sessionId: "session-1",
      customerName: "Sai vĩ độ",
      geoLat: 91,
      geoLng: 106.1
    }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_geo_lat" && error.statusCode === 400
  );

  assert.equal(providerCalls, 0);
});
