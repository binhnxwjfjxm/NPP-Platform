import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresqlPersistence } from "./postgresql-adapter.js";
import { bindProviderPersistence } from "./provider-runtime.js";
import { supabaseRpc } from "./supabase-adapter.js";
import { runMcpMigrations } from "./migrations/index.js";
import { createIdempotencyKey, isValidIdempotencyKey } from "../../../../packages/contracts/index.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const installationId = "installation-test-adapter";
const idempotencyKeys = new Map();

function mutationKey(operation) {
  if (!idempotencyKeys.has(operation)) {
    idempotencyKeys.set(operation, createIdempotencyKey(`postgresql-test-${operation}`));
  }
  const key = idempotencyKeys.get(operation);
  assert.equal(isValidIdempotencyKey(key), true);
  return key;
}

function config() {
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
    nppCode: "MCP-TEST-ADAPTER",
    legacyActorId: "service:test:mcp-test-adapter",
    authMode: "backend-token",
    servicePrincipal: Object.freeze({
      id: "service:test:mcp-test-adapter",
      type: "service",
      authentication: "backend-token",
      employeeId: null,
      roles: Object.freeze([]),
      permissions: Object.freeze([
        "mcp.route.write",
        "mcp.route-customer.write",
        "mcp.session.write",
        "mcp.test.write"
      ]),
      scopes: Object.freeze(["mcp:*"])
    })
  });
}

function context(key, requestId = `request-${key}`) {
  return {
    requestId,
    idempotencyKey: mutationKey(key),
    receivedAt: "2026-09-12T17:00:00.000Z",
    installationId,
    nppCode: "MCP-TEST-ADAPTER",
    actorId: "service:test:mcp-test-adapter",
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
  "PostgreSQL test action creates canonical result, product, visit and exact counters",
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
    const runtimeConfig = config();
    persistence = createPostgresqlPersistence(runtimeConfig, { PoolImpl: Pool });
    await persistence.assertReady();
    bindProviderPersistence(persistence);

    const route = data(await supabaseRpc(runtimeConfig, "mcp_idempotent_create_route", {
      p_route_name: "Tuyến kiểm tra PostgreSQL",
      p_area: "Kiểm tra tích hợp",
      p_weekday: 5,
      p_note: "test action integration",
      p_context: context("route-create")
    }));
    assert.match(route.routeId, /^route_/);

    const routeCustomer = data(await supabaseRpc(runtimeConfig, "mcp_idempotent_add_route_customer", {
      p_route_id: route.routeId,
      p_customer_name: "Điểm bán kiểm tra",
      p_area: "Kiểm tra tích hợp",
      p_sort_order: 1,
      p_include_active_session: false,
      p_context: context("route-customer-create")
    }));
    assert.match(routeCustomer.routeCustomerId, /^route_customer_/);

    const session = data(await supabaseRpc(runtimeConfig, "mcp_idempotent_open_route_session", {
      p_route_id: route.routeId,
      p_session_date: "2030-12-31",
      p_owner: "Kiểm tra tích hợp",
      p_context: context("session-open")
    }));
    assert.match(session.sessionId, /^session_/);

    const sessionCustomer = (await admin.query(
      `SELECT id FROM mcp.mcp_session_customers
       WHERE installation_id = $1 AND session_id = $2 AND route_customer_id = $3`,
      [installationId, session.sessionId, routeCustomer.routeCustomerId]
    )).rows[0];
    assert.match(sessionCustomer.id, /^session_customer_/);

    const createArgs = {
      p_session_customer_id: sessionCustomer.id,
      p_file_id: null,
      p_file_title: "Kiểm tra PostgreSQL",
      p_results: [{
        productName: "Sản phẩm kiểm tra PostgreSQL",
        status: "ok",
        note: "Đạt"
      }],
      p_note: "integration test",
      p_status: "tested",
      p_context: context("test-create")
    };
    const firstEnvelope = await supabaseRpc(
      runtimeConfig,
      "mcp_idempotent_create_test_from_session_customer",
      createArgs
    );
    const created = data(firstEnvelope);
    assert.equal(firstEnvelope.meta.idempotency.replayed, false);
    assert.match(created.fileId, /^test_file_/);
    assert.match(created.testCustomerId, /^test_customer_/);
    assert.match(created.testId, /^test_result_/);
    assert.match(created.visitId, /^visit_/);
    assert.equal(created.resultCount, 1);

    const replayEnvelope = await supabaseRpc(
      runtimeConfig,
      "mcp_idempotent_create_test_from_session_customer",
      {
        ...createArgs,
        p_context: context("test-create", "request-test-create-retry")
      }
    );
    assert.equal(replayEnvelope.meta.idempotency.replayed, true);
    assert.equal(data(replayEnvelope).testId, created.testId);

    const stored = (await admin.query(
      `SELECT sc.test_id, sc.visit_status,
              s.planned_customers, s.visited_customers, s.test_count,
              r.id AS result_id, r.file_id, r.customer_id AS test_customer_id,
              r.product_id AS test_file_product_id,
              r.product_name, r.status AS result_status,
              r.raw_payload ->> 'session_customer_id' AS result_session_customer_id
       FROM mcp.mcp_session_customers sc
       JOIN mcp.mcp_route_sessions s
         ON s.installation_id = sc.installation_id AND s.id = sc.session_id
       JOIN mcp.test_customer_results r
         ON r.installation_id = sc.installation_id AND r.id = sc.test_id
       WHERE sc.installation_id = $1 AND sc.id = $2`,
      [installationId, sessionCustomer.id]
    )).rows[0];
    assert.equal(stored.test_id, created.testId);
    assert.equal(stored.visit_status, "visited");
    assert.equal(stored.result_id, created.testId);
    assert.equal(stored.file_id, created.fileId);
    assert.equal(stored.test_customer_id, created.testCustomerId);
    assert.equal(stored.product_name, "Sản phẩm kiểm tra PostgreSQL");
    assert.equal(stored.result_status, "ok");
    assert.equal(stored.result_session_customer_id, sessionCustomer.id);
    assert.equal(Number(stored.planned_customers), 1);
    assert.equal(Number(stored.visited_customers), 1);
    assert.equal(Number(stored.test_count), 1);

    const testProduct = (await admin.query(
      `SELECT id, product_name FROM mcp.test_file_products
       WHERE installation_id = $1 AND file_id = $2`,
      [installationId, created.fileId]
    )).rows[0];
    assert.equal(testProduct.id, stored.test_file_product_id);
    assert.equal(testProduct.product_name, "Sản phẩm kiểm tra PostgreSQL");

    const counts = (await admin.query(
      `SELECT
         (SELECT count(*) FROM mcp.test_files WHERE installation_id = $1) AS files,
         (SELECT count(*) FROM mcp.test_customers WHERE installation_id = $1) AS customers,
         (SELECT count(*) FROM mcp.test_customer_results WHERE installation_id = $1) AS results,
         (SELECT count(*) FROM mcp.test_file_products WHERE installation_id = $1) AS products,
         (SELECT count(*) FROM mcp.mcp_visits WHERE installation_id = $1 AND session_customer_id = $2) AS visits,
         (SELECT count(*) FROM mcp.audit_events WHERE installation_id = $1 AND event_type = 'mcp.test.created') AS audit_events,
         (SELECT count(*) FROM mcp.outbox_events WHERE installation_id = $1 AND event_type = 'mcp.test.created') AS outbox_events`,
      [installationId, sessionCustomer.id]
    )).rows[0];
    assert.equal(Number(counts.files), 1);
    assert.equal(Number(counts.customers), 1);
    assert.equal(Number(counts.results), 1);
    assert.equal(Number(counts.products), 1);
    assert.equal(Number(counts.visits), 1);
    assert.equal(Number(counts.audit_events), 1);
    assert.equal(Number(counts.outbox_events), 1);
  }
);
