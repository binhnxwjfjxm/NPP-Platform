import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresqlPersistence } from "./postgresql-adapter.js";
import { createPostgresqlLegacyProvider } from "./postgresql-legacy-provider.js";
import { supabaseRpc } from "./supabase-adapter.js";
import { runMcpMigrations } from "./migrations/index.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;

function config() {
  return Object.freeze({
    service: "mcp-plan-backend",
    persistence: Object.freeze({
      provider: "postgresql",
      databaseUrl,
      schema: "mcp",
      expectedRole: null,
      poolMax: 4,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 5000,
      statementTimeoutMs: 15000
    })
  });
}

function context({ requestId, idempotencyKey }) {
  return Object.freeze({
    requestId,
    receivedAt: "2026-08-02T00:00:00.000Z",
    idempotencyKey,
    auth: Object.freeze({ authenticated: true }),
    installation: Object.freeze({ id: "installation-parity", nppCode: "PARITY" }),
    principal: Object.freeze({
      id: "service:parity:mcp",
      type: "service",
      authentication: "backend-token",
      employeeId: null,
      roles: Object.freeze([]),
      permissions: Object.freeze(["mcp.routes.write"]),
      scopes: Object.freeze(["mcp:*"])
    })
  });
}

function routeArgs(requestId) {
  return {
    p_route_name: "Tuyến parity",
    p_area: "Khu vực A",
    p_weekday: 2,
    p_note: "Giữ nguyên hợp đồng Supabase cũ",
    p_distributor_id: "distributor-parity",
    p_context: {
      requestId,
      receivedAt: new Date().toISOString(),
      installationId: "installation-parity",
      actorId: "service:parity:mcp"
    }
  };
}

function routeCustomerArgs(routeId, requestId) {
  return {
    p_route_id: routeId,
    p_customer_name: "Điểm bán parity",
    p_phone: "0901 234 567",
    p_area: "Khu vực A",
    p_address: "123 Đường Thử Nghiệm",
    p_sort_order: 3,
    p_note: "Điểm bán phục vụ thị trường, chưa tự mở mã Core",
    p_customer_id: null,
    p_geo_lat: 10.7769,
    p_geo_lng: 106.7009,
    p_geo_accuracy: 8.5,
    p_geo_source: "browser",
    p_google_maps_url: "https://maps.google.com/?q=10.7769,106.7009",
    p_include_active_session: false,
    p_active_session_id: null,
    p_context: {
      requestId,
      receivedAt: new Date().toISOString(),
      installationId: "installation-parity",
      actorId: "service:parity:mcp"
    }
  };
}

test("legacy route and route-customer contracts write once to PostgreSQL with audit and outbox", { skip: !databaseUrl }, async (t) => {
  const admin = new Pool({ connectionString: databaseUrl });
  let persistence = null;
  t.after(async () => {
    if (persistence) await persistence.close();
    await admin.query("DROP SCHEMA IF EXISTS mcp CASCADE");
    await admin.query("DELETE FROM shared.schema_migrations WHERE split_part(id, '_', 1) = 'mcp'");
    await admin.end();
  });

  await admin.query("DROP SCHEMA IF EXISTS mcp CASCADE");
  await admin.query("DELETE FROM shared.schema_migrations WHERE split_part(id, '_', 1) = 'mcp'");
  const migrated = await runMcpMigrations(admin);
  assert.deepEqual(migrated.applied, [
    "mcp_001_write_foundation",
    "mcp_002_domain_read_models",
    "mcp_003_supabase_contract_parity"
  ]);

  const runtimeConfig = config();
  persistence = createPostgresqlPersistence(runtimeConfig, { PoolImpl: Pool });
  const provider = createPostgresqlLegacyProvider(runtimeConfig, persistence);
  let networkCalled = false;
  const fetchImpl = async () => {
    networkCalled = true;
    throw new Error("network_must_not_be_called");
  };

  const routeKey = "route-parity-idempotency";
  const routeFirstContext = context({ requestId: "route-request-1", idempotencyKey: routeKey });
  const routeReplayContext = context({ requestId: "route-request-2", idempotencyKey: routeKey });
  const routeFirst = await supabaseRpc(
    provider.bindRequest(routeFirstContext),
    "mcp_idempotent_create_route",
    routeArgs(routeFirstContext.requestId),
    { fetchImpl }
  );
  const routeReplay = await supabaseRpc(
    provider.bindRequest(routeReplayContext),
    "mcp_idempotent_create_route",
    routeArgs(routeReplayContext.requestId),
    { fetchImpl }
  );

  assert.equal(networkCalled, false);
  assert.equal(routeFirst.meta.idempotency.replayed, false);
  assert.equal(routeReplay.meta.idempotency.replayed, true);
  assert.equal(routeReplay.data.routeId, routeFirst.data.routeId);

  const route = (await admin.query(
    "SELECT id, installation_id, route_name, area, weekday, note FROM mcp.mcp_routes WHERE id = $1",
    [routeFirst.data.routeId]
  )).rows[0];
  assert.deepEqual(route, {
    id: routeFirst.data.routeId,
    installation_id: "installation-parity",
    route_name: "Tuyến parity",
    area: "Khu vực A",
    weekday: 2,
    note: "Giữ nguyên hợp đồng Supabase cũ"
  });

  const customerKey = "route-customer-parity-idempotency";
  const customerFirstContext = context({ requestId: "route-customer-request-1", idempotencyKey: customerKey });
  const customerReplayContext = context({ requestId: "route-customer-request-2", idempotencyKey: customerKey });
  const customerFirst = await supabaseRpc(
    provider.bindRequest(customerFirstContext),
    "mcp_idempotent_add_route_customer",
    routeCustomerArgs(routeFirst.data.routeId, customerFirstContext.requestId),
    { fetchImpl }
  );
  const customerReplay = await supabaseRpc(
    provider.bindRequest(customerReplayContext),
    "mcp_idempotent_add_route_customer",
    routeCustomerArgs(routeFirst.data.routeId, customerReplayContext.requestId),
    { fetchImpl }
  );

  assert.equal(networkCalled, false);
  assert.equal(customerFirst.meta.idempotency.replayed, false);
  assert.equal(customerReplay.meta.idempotency.replayed, true);
  assert.equal(customerReplay.data.routeCustomerId, customerFirst.data.routeCustomerId);
  assert.equal(customerFirst.data.createdRouteCustomer, true);
  assert.equal(customerFirst.data.includedActiveSession, false);

  const routeCustomer = (await admin.query(`
    SELECT id, installation_id, route_id, customer_name, phone, area, address,
           sort_order, geo_lat::double precision AS geo_lat,
           geo_lng::double precision AS geo_lng,
           geo_accuracy::double precision AS geo_accuracy,
           geo_source, google_maps_url, sync_status
      FROM mcp.mcp_route_customers
     WHERE id = $1
  `, [customerFirst.data.routeCustomerId])).rows[0];
  assert.deepEqual(routeCustomer, {
    id: customerFirst.data.routeCustomerId,
    installation_id: "installation-parity",
    route_id: routeFirst.data.routeId,
    customer_name: "Điểm bán parity",
    phone: "0901 234 567",
    area: "Khu vực A",
    address: "123 Đường Thử Nghiệm",
    sort_order: 3,
    geo_lat: 10.7769,
    geo_lng: 106.7009,
    geo_accuracy: 8.5,
    geo_source: "browser",
    google_maps_url: "https://maps.google.com/?q=10.7769,106.7009",
    sync_status: "synced"
  });

  const counts = (await admin.query(`
    SELECT
      (SELECT count(*)::integer FROM mcp.mcp_routes WHERE id = $1) AS routes,
      (SELECT count(*)::integer FROM mcp.mcp_route_customers WHERE id = $2) AS route_customers,
      (SELECT count(*)::integer FROM mcp.idempotency_records
        WHERE installation_id = $3 AND command_name = 'mcp.create.route' AND idempotency_key = $4
          AND state = 'completed') AS route_idempotency,
      (SELECT count(*)::integer FROM mcp.idempotency_records
        WHERE installation_id = $3 AND command_name = 'mcp.add.route.customer' AND idempotency_key = $5
          AND state = 'completed') AS customer_idempotency,
      (SELECT count(*)::integer FROM mcp.audit_events
        WHERE installation_id = $3 AND action IN ('mcp.create.route', 'mcp.add.route.customer')) AS audit,
      (SELECT count(*)::integer FROM mcp.outbox_events
        WHERE installation_id = $3 AND event_type IN ('mcp.routes.create.route', 'mcp.routes.add.route.customer')) AS outbox
  `, [
    routeFirst.data.routeId,
    customerFirst.data.routeCustomerId,
    "installation-parity",
    routeKey,
    customerKey
  ])).rows[0];
  assert.deepEqual(counts, {
    routes: 1,
    route_customers: 1,
    route_idempotency: 1,
    customer_idempotency: 1,
    audit: 2,
    outbox: 2
  });
});
