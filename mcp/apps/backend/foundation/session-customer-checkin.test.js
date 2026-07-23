import test from "node:test";
import assert from "node:assert/strict";
import { setSessionCustomerCheckin } from "./session-customer-mutations.js";

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-checkin-12345678",
  idempotencyKey: "session-checkin-12345678",
  receivedAt: "2026-07-17T05:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "proxy-token" }
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("manual check-in validates and forwards current browser coordinates", async () => {
  const calls = [];
  const result = await setSessionCustomerCheckin({
    sessionCustomerId: "session-customer-1",
    checkedIn: true,
    geoLat: 10.123,
    geoLng: 106.456,
    geoAccuracy: 7.5,
    geoSource: "browser_manual"
  }, context, config, {
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return response({ data: { checkedIn: true, sessionCustomerId: "session-customer-1" } });
    }
  });

  assert.equal(result.data.checkedIn, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_set_session_customer_checkin$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_session_customer_id: "session-customer-1",
    p_checked_in: true,
    p_geo_lat: 10.123,
    p_geo_lng: 106.456,
    p_geo_accuracy: 7.5,
    p_geo_source: "browser_manual",
    p_context: {
      requestId: "request-checkin-12345678",
      idempotencyKey: "session-checkin-12345678",
      receivedAt: "2026-07-17T05:00:00.000Z",
      installationId: "installation-a",
      nppCode: "NPP-A",
      actorId: "service:npp-a:mcp-v1",
      actorType: "service",
      actorAuthentication: "proxy-token"
    }
  });
});

test("second click removes check-in without requesting or forwarding coordinates", async () => {
  const calls = [];
  const result = await setSessionCustomerCheckin({
    sessionCustomerId: "session-customer-1",
    checkedIn: false
  }, context, config, {
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return response({ data: { checkedIn: false, sessionCustomerId: "session-customer-1" } });
    }
  });

  assert.equal(result.data.checkedIn, false);
  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_checked_in, false);
  assert.equal(args.p_geo_lat, null);
  assert.equal(args.p_geo_lng, null);
  assert.equal(args.p_geo_accuracy, null);
  assert.equal(args.p_geo_source, null);
});

test("invalid coordinates fail before provider access", async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error("provider_must_not_be_called");
  };

  await assert.rejects(
    setSessionCustomerCheckin({
      sessionCustomerId: "session-customer-1",
      checkedIn: true,
      geoLat: 10.1
    }, context, config, { fetchImpl }),
    (error) => error.message === "checkin_coordinates_required" && error.statusCode === 400
  );

  await assert.rejects(
    setSessionCustomerCheckin({
      sessionCustomerId: "session-customer-1",
      checkedIn: true,
      geoLat: 91,
      geoLng: 106.1
    }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_geo_lat" && error.statusCode === 400
  );

  await assert.rejects(
    setSessionCustomerCheckin({
      sessionCustomerId: "session-customer-1",
      checkedIn: false,
      geoLat: 10.1,
      geoLng: 106.1
    }, context, config, { fetchImpl }),
    (error) => error.message === "checkin_coordinates_not_allowed" && error.statusCode === 400
  );

  assert.equal(providerCalls, 0);
});
