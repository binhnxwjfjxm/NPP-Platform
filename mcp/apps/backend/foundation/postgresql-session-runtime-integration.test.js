import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresqlPersistence } from "./postgresql-adapter.js";
import { bindProviderPersistence } from "./provider-runtime.js";
import { supabaseRpc } from "./supabase-adapter.js";
import { migrationVerifyWithAdapter, runMcpMigrations } from "./migrations/index.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const installationId = "installation-session-runtime";

function runtimeConfig() {
  return Object.freeze({
    persistence: Object.freeze({
      provider: "postgresql",
      databaseUrl,
      schema: "mcp",
      expectedRole: null,
      poolMax: 4,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 5000,
      statementTimeoutMs: 15000
    }),
    legacyRuntime: Object.freeze({ enabled: false }),
    installationId,
    nppCode: "NPP-SESSION-RUNTIME",
    legacyActorId: "service:test:session-runtime",
    authMode: "backend-token",
    servicePrincipal: Object.freeze({
      id: "service:test:session-runtime",
      type: "service",
      authentication: "backend-token",
      employeeId: null,
      roles: Object.freeze([]),
      permissions: Object.freeze([
        "mcp.route.write",
        "mcp.route-customer.write",
        "mcp.session.write",
        "mcp.session-customer.write",
        "mcp.order.write"
      ]),
      scopes: Object.freeze(["mcp:*"])
    })
  });
}

function context(key) {
  return {
    requestId: `request-${key}`,
    idempotencyKey: `session-runtime:${key}`,
    receivedAt: "2026-08-02T15:00:00.000Z",
    installationId,
    nppCode: "NPP-SESSION-RUNTIME",
    actorId: "service:test:session-runtime",
    actorType: "service",
    actorAuthentication: "backend-token"
  };
}

function data(result) {
  return result?.data && typeof result.data === "object" ? result.data : result;
}

async function resetMcp(admin) {
  await admin.query("DROP SCHEMA IF EXISTS mcp CASCADE");
  await admin.query("CREATE SCHEMA IF NOT EXISTS shared");
  await admin.query(`CREATE TABLE IF NOT EXISTS shared.schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  await admin.query("DELETE FROM shared.schema_migrations WHERE split_part(id, '_', 1) = 'mcp'");
}

test(
  "PostgreSQL rolls stale sessions, keeps visited KPIs correct and deletes used routes",
  { skip: !databaseUrl },
  async (t) => {
    const admin = new Pool({ connectionString: databaseUrl });
    let persistence = null;
    t.after(async () => {
      if (persistence) await persistence.close();
      await resetMcp(admin);
      await admin.end();
    });

    await resetMcp(admin);
    await runMcpMigrations(admin);
    const verification = await migrationVerifyWithAdapter(admin);
    assert.equal(verification.verified, true, verification.issues.join("; "));
    assert.equal(verification.status.applied.includes("mcp_005_session_runtime_contract"), true);
    assert.equal(verification.checks.sessionVisitedCounterTrigger, true);

    const config = runtimeConfig();
    persistence = createPostgresqlPersistence(config, { PoolImpl: Pool });
    await persistence.assertReady();
    bindProviderPersistence(persistence);

    const route = data(await supabaseRpc(config, "mcp_idempotent_create_route", {
      p_route_name: "Tuyến rollover",
      p_area: "Quận 5",
      p_context: context("route")
    }));
    const routeCustomer = data(await supabaseRpc(config, "mcp_idempotent_add_route_customer", {
      p_route_id: route.routeId,
      p_customer_name: "Điểm bán rollover",
      p_include_active_session: false,
      p_context: context("route-customer")
    }));
    const firstSession = data(await supabaseRpc(config, "mcp_idempotent_open_route_session", {
      p_route_id: route.routeId,
      p_session_date: "2026-08-01",
      p_owner: "NV thị trường",
      p_context: context("session-day-1")
    }));

    const sessionCustomer = (await admin.query(
      `SELECT id FROM mcp.mcp_session_customers
       WHERE installation_id = $1 AND session_id = $2 AND route_customer_id = $3`,
      [installationId, firstSession.sessionId, routeCustomer.routeCustomerId]
    )).rows[0];
    assert.ok(sessionCustomer?.id);

    await supabaseRpc(config, "mcp_idempotent_create_order_from_session_customer", {
      p_session_customer_id: sessionCustomer.id,
      p_items: [{ productName: "Sản phẩm thử", quantity: 1, unitPrice: 10000, discount: 0 }],
      p_status: "confirmed",
      p_context: context("order")
    });
    const afterOrder = (await admin.query(
      `SELECT visited_customers, order_count FROM mcp.mcp_route_sessions
       WHERE installation_id = $1 AND id = $2`,
      [installationId, firstSession.sessionId]
    )).rows[0];
    assert.equal(Number(afterOrder.visited_customers), 1);
    assert.equal(Number(afterOrder.order_count), 1);

    const secondSession = data(await supabaseRpc(config, "mcp_idempotent_open_route_session", {
      p_route_id: route.routeId,
      p_session_date: "2026-08-02",
      p_owner: "NV thị trường",
      p_context: context("session-day-2")
    }));
    assert.notEqual(secondSession.sessionId, firstSession.sessionId);
    const sessions = await admin.query(
      `SELECT id, status, visited_customers, order_count
       FROM mcp.mcp_route_sessions
       WHERE installation_id = $1 AND route_id = $2
       ORDER BY session_date`,
      [installationId, route.routeId]
    );
    assert.deepEqual(sessions.rows.map((row) => ({
      id: row.id,
      status: row.status,
      visited: Number(row.visited_customers),
      orders: Number(row.order_count)
    })), [
      { id: firstSession.sessionId, status: "done", visited: 1, orders: 1 },
      { id: secondSession.sessionId, status: "active", visited: 0, orders: 0 }
    ]);

    const deleted = await supabaseRpc(config, "mcp_delete_route_hard", {
      p_route_id: route.routeId
    });
    assert.equal(deleted.deleted, true);
    const remaining = await admin.query(
      `SELECT
         (SELECT COUNT(*) FROM mcp.mcp_routes WHERE installation_id = $1 AND id = $2)::integer AS routes,
         (SELECT COUNT(*) FROM mcp.mcp_route_sessions WHERE installation_id = $1 AND route_id = $2)::integer AS sessions,
         (SELECT COUNT(*) FROM mcp.mcp_session_customers WHERE installation_id = $1 AND route_id = $2)::integer AS customers`,
      [installationId, route.routeId]
    );
    assert.deepEqual(remaining.rows[0], { routes: 0, sessions: 0, customers: 0 });
  }
);
