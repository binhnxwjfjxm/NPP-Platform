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

test("legacy create-route contract writes once to PostgreSQL with audit and outbox", { skip: !databaseUrl }, async (t) => {
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
  const idempotencyKey = "route-parity-idempotency";
  const firstContext = context({ requestId: "route-request-1", idempotencyKey });
  const replayContext = context({ requestId: "route-request-2", idempotencyKey });
  let networkCalled = false;

  const first = await supabaseRpc(
    provider.bindRequest(firstContext),
    "mcp_idempotent_create_route",
    routeArgs(firstContext.requestId),
    { fetchImpl: async () => { networkCalled = true; throw new Error("network_must_not_be_called"); } }
  );
  const replay = await supabaseRpc(
    provider.bindRequest(replayContext),
    "mcp_idempotent_create_route",
    routeArgs(replayContext.requestId),
    { fetchImpl: async () => { networkCalled = true; throw new Error("network_must_not_be_called"); } }
  );

  assert.equal(networkCalled, false);
  assert.equal(first.meta.idempotency.replayed, false);
  assert.equal(replay.meta.idempotency.replayed, true);
  assert.equal(replay.data.routeId, first.data.routeId);

  const route = (await admin.query(
    "SELECT id, installation_id, route_name, area, weekday, note FROM mcp.mcp_routes WHERE id = $1",
    [first.data.routeId]
  )).rows[0];
  assert.deepEqual(route, {
    id: first.data.routeId,
    installation_id: "installation-parity",
    route_name: "Tuyến parity",
    area: "Khu vực A",
    weekday: 2,
    note: "Giữ nguyên hợp đồng Supabase cũ"
  });

  const counts = (await admin.query(`
    SELECT
      (SELECT count(*)::integer FROM mcp.mcp_routes WHERE id = $1) AS routes,
      (SELECT count(*)::integer FROM mcp.idempotency_records
        WHERE installation_id = $2 AND command_name = 'mcp.create.route' AND idempotency_key = $3
          AND state = 'completed') AS idempotency,
      (SELECT count(*)::integer FROM mcp.audit_events
        WHERE installation_id = $2 AND action = 'mcp.create.route') AS audit,
      (SELECT count(*)::integer FROM mcp.outbox_events
        WHERE installation_id = $2 AND event_type = 'mcp.routes.create.route') AS outbox
  `, [first.data.routeId, "installation-parity", idempotencyKey])).rows[0];
  assert.deepEqual(counts, { routes: 1, idempotency: 1, audit: 1, outbox: 1 });
});
