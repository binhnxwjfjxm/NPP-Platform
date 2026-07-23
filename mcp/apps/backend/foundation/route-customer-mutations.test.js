import test from "node:test";
import assert from "node:assert/strict";
import { addRouteCustomer } from "./route-customer-mutations.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-route-customer-12345678",
  idempotencyKey: "route-customer.add:12345678",
  receivedAt: "2026-07-17T09:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "proxy-token" }
};

test("route customer add forwards the explicit active-session choice to one typed RPC", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      routeCustomerId: "route-customer-1",
      sessionCustomerId: "session-customer-1",
      includedActiveSession: true,
      createdRouteCustomer: true,
      createdSessionCustomer: true
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await addRouteCustomer({
    routeId: "route-1",
    customerName: "Điểm bán mới",
    phone: "0909 111 222",
    area: "Khu vực A",
    address: "Số 1",
    sortOrder: 5,
    geoLat: 10.123,
    geoLng: 106.456,
    geoAccuracy: 8.5,
    geoSource: "browser",
    includeActiveSession: true,
    activeSessionId: "session-1"
  }, context, config, { fetchImpl });

  assert.equal(result.routeCustomerId, "route-customer-1");
  assert.equal(result.sessionCustomerId, "session-customer-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_add_route_customer$/);

  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_route_id, "route-1");
  assert.equal(args.p_include_active_session, true);
  assert.equal(args.p_active_session_id, "session-1");
  assert.equal(args.p_geo_lat, 10.123);
  assert.equal(args.p_geo_lng, 106.456);
  assert.equal(args.p_context.idempotencyKey, "route-customer.add:12345678");
  assert.equal(args.p_context.installationId, "installation-a");
});

test("route-only choice is explicit and does not require an active session id", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      routeCustomerId: "route-customer-1",
      sessionCustomerId: null,
      includedActiveSession: false
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  await addRouteCustomer({
    routeId: "route-1",
    customerName: "Điểm bán mới",
    includeActiveSession: false
  }, context, config, { fetchImpl });

  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_include_active_session, false);
  assert.equal(args.p_active_session_id, null);
});

test("active-session and GPS validation happens before provider access", async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error("provider_must_not_be_called");
  };

  await assert.rejects(
    addRouteCustomer({
      routeId: "route-1",
      customerName: "Thiếu phiên",
      includeActiveSession: true
    }, context, config, { fetchImpl }),
    (error) => error.message === "active_session_id_required" && error.statusCode === 400
  );

  await assert.rejects(
    addRouteCustomer({
      routeId: "route-1",
      customerName: "Thiếu kinh độ",
      includeActiveSession: false,
      geoLat: 10.1
    }, context, config, { fetchImpl }),
    (error) => error.message === "geo_coordinates_incomplete" && error.statusCode === 400
  );

  assert.equal(providerCalls, 0);
});
