import test from "node:test";
import assert from "node:assert/strict";
import { updateRouteCustomer } from "./route-customer-update-mutations.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-route-customer-update-12345678",
  idempotencyKey: "route-customer.update:12345678",
  receivedAt: "2026-07-19T13:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "backend-token" }
};

function provider(calls, payload = { data: { id: "route-customer-1" }, meta: { idempotency: { replayed: false } } }) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
}

function persistence(queries) {
  return {
    async withTransaction(work) {
      return work({
        async query(sql, params) {
          queries.push({ sql, params });
          return { rowCount: 1, rows: [] };
        }
      });
    }
  };
}

test("route-customer update sends the full canonical 13-field contract and trusted context", async () => {
  const calls = [];
  const fetchImpl = provider(calls);

  await updateRouteCustomer("route-customer-1", {
    customerName: "Điểm bán A",
    phone: "0909000000",
    area: "Quận 5",
    address: "1 Trần Hưng Đạo",
    sortOrder: "3",
    note: "Cửa hàng lớn",
    active: false,
    geoLat: "10.755",
    geoLng: "106.667",
    geoAccuracy: "12.5",
    geoSource: "browser"
  }, context, config, { fetchImpl });

  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname.split("/").at(-1), "mcp_idempotent_update_route_customer");
  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_route_customer_id, "route-customer-1");
  assert.equal(args.p_customer_name, "Điểm bán A");
  assert.equal(args.p_sort_order, 3);
  assert.equal(args.p_active, false);
  assert.equal(args.p_geo_lat, 10.755);
  assert.equal(args.p_geo_lng, 106.667);
  assert.equal(args.p_geo_accuracy, 12.5);
  assert.equal(args.p_geo_source, "browser");
  assert.equal(args.p_google_maps_url, "https://www.google.com/maps/search/?api=1&query=10.755,106.667");
  assert.equal(args.p_context.requestId, context.requestId);
  assert.equal(args.p_context.idempotencyKey, context.idempotencyKey);
  assert.equal(args.p_context.installationId, "installation-a");
  assert.equal(args.p_context.actorId, "service:npp-a:mcp-v1");
});

test("PostgreSQL route-customer update reconciles identity into mutable active-session snapshots only", async () => {
  const calls = [];
  const queries = [];
  const postgresConfig = {
    ...config,
    persistence: { provider: "postgresql" }
  };

  await updateRouteCustomer("route-customer-1", {
    customerName: "Điểm bán đã đổi tên",
    address: "99 Đường mới"
  }, context, postgresConfig, {
    fetchImpl: provider(calls),
    persistence: persistence(queries)
  });

  assert.equal(calls.length, 1);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ["installation-a", "route-customer-1"]);
  assert.match(queries[0].sql, /UPDATE mcp\.mcp_session_customers AS session_customer/);
  assert.match(queries[0].sql, /customer_name = route_customer\.customer_name/);
  assert.match(queries[0].sql, /account_name = route_customer\.customer_name/);
  assert.match(queries[0].sql, /phone = route_customer\.phone/);
  assert.match(queries[0].sql, /area = route_customer\.area/);
  assert.match(queries[0].sql, /address = route_customer\.address/);
  assert.match(queries[0].sql, /route_session\.status = 'active'/);
  assert.match(queries[0].sql, /customer_onboarding_request_id IS NOT NULL/);
  assert.match(queries[0].sql, /NOT EXISTS/);
  assert.doesNotMatch(queries[0].sql, /SET[\s\S]*visit_status\s*=/);
  assert.doesNotMatch(queries[0].sql, /SET[\s\S]*order_id\s*=/);
  assert.doesNotMatch(queries[0].sql, /SET[\s\S]*checkin_/);
});

test("PostgreSQL idempotency replay still retries active-session identity reconciliation", async () => {
  const calls = [];
  const queries = [];
  const postgresConfig = {
    ...config,
    persistence: { provider: "postgresql" }
  };
  const replayPayload = {
    data: { id: "route-customer-1", customerName: "Điểm bán đã đổi tên" },
    meta: { idempotency: { replayed: true, originalRequestId: "request-original" } }
  };

  const result = await updateRouteCustomer("route-customer-1", { note: "retry" }, context, postgresConfig, {
    fetchImpl: provider(calls, replayPayload),
    persistence: persistence(queries)
  });

  assert.equal(result.meta.idempotency.replayed, true);
  assert.equal(queries.length, 1);
});

test("omitted route-customer fields stay null so the canonical owner preserves current values", async () => {
  const calls = [];
  await updateRouteCustomer("route-customer-1", { note: "Chỉ đổi ghi chú" }, context, config, {
    fetchImpl: provider(calls)
  });
  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_customer_name, null);
  assert.equal(args.p_phone, null);
  assert.equal(args.p_geo_lat, null);
  assert.equal(args.p_geo_lng, null);
  assert.equal(args.p_google_maps_url, null);
  assert.equal(args.p_note, "Chỉ đổi ghi chú");
});

test("route-customer validation rejects invalid GPS and ordering before provider access", async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error("provider_must_not_be_called");
  };

  await assert.rejects(
    updateRouteCustomer("route-customer-1", { sortOrder: -1 }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_sort_order" && error.statusCode === 400
  );
  await assert.rejects(
    updateRouteCustomer("route-customer-1", { geoLat: 10.7 }, context, config, { fetchImpl }),
    (error) => error.message === "geo_coordinates_incomplete" && error.statusCode === 400
  );
  await assert.rejects(
    updateRouteCustomer("route-customer-1", { geoLat: 95, geoLng: 106 }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_geo_lat" && error.statusCode === 400
  );
  await assert.rejects(
    updateRouteCustomer("route-customer-1", { geoLat: 10, geoLng: 181 }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_geo_lng" && error.statusCode === 400
  );
  await assert.rejects(
    updateRouteCustomer("route-customer-1", { geoLat: 10, geoLng: 106, geoAccuracy: -1 }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_geo_accuracy" && error.statusCode === 400
  );
  await assert.rejects(
    updateRouteCustomer("", {}, context, config, { fetchImpl }),
    (error) => error.message === "route_customer_id_required" && error.statusCode === 400
  );
  assert.equal(providerCalls, 0);
});

test("route-customer not found is normalized to public 404", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ message: "route_customer_not_found" }), {
    status: 400,
    headers: { "Content-Type": "application/json" }
  });
  await assert.rejects(
    updateRouteCustomer("missing", {}, context, config, { fetchImpl }),
    (error) => error.code === "route_customer_not_found" && error.statusCode === 404
  );
});
