import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresqlPersistence } from "./postgresql-adapter.js";

function config(overrides = {}) {
  return {
    persistence: {
      provider: "postgresql",
      databaseUrl: "postgresql://test.invalid/mcp",
      schema: "mcp",
      expectedRole: null,
      poolMax: 4,
      connectionTimeoutMs: 1234,
      idleTimeoutMs: 2345,
      statementTimeoutMs: 3456,
      ...overrides
    }
  };
}

test("missing database config returns a stable fail-closed readiness code", async () => {
  const adapter = createPostgresqlPersistence(config({ databaseUrl: null }), {
    PoolImpl: class { constructor() { throw new Error("must_not_construct"); } }
  });
  assert.deepEqual(await adapter.readiness(), {
    provider: "postgresql",
    configured: false,
    ready: false,
    code: "missing_database_url"
  });
  await assert.rejects(
    () => adapter.assertReady(),
    (error) => error.code === "missing_database_url" && error.statusCode === 503
  );
});

test("PostgreSQL adapter enforces schema search_path, timeouts, role and graceful close", async () => {
  const calls = [];
  class FakePool {
    constructor(options) { calls.push({ type: "construct", options }); }
    async query(text, values) {
      calls.push({ type: "query", text, values });
      return { rows: [{ role: "mcp_runtime", search_path: "mcp, public", schema_available: true }] };
    }
    async end() { calls.push({ type: "end" }); }
  }

  const adapter = createPostgresqlPersistence(config({ expectedRole: "mcp_runtime" }), { PoolImpl: FakePool });
  assert.deepEqual(await adapter.readiness(), { provider: "postgresql", configured: true, ready: true });

  const created = calls.find((entry) => entry.type === "construct").options;
  assert.equal(created.max, 4);
  assert.equal(created.connectionTimeoutMillis, 1234);
  assert.equal(created.idleTimeoutMillis, 2345);
  assert.match(created.options, /search_path=mcp,public/);
  assert.match(created.options, /statement_timeout=3456/);

  const query = calls.find((entry) => entry.type === "query");
  assert.deepEqual(query.values, ["mcp"]);
  assert.equal(query.text.includes("to_regnamespace"), true);

  await adapter.close();
  assert.equal(calls.at(-1).type, "end");
});

test("transaction boundary commits, rolls back and always releases its client", async () => {
  const calls = [];
  const client = {
    async query(text) { calls.push(text); return { rows: [] }; },
    release() { calls.push("RELEASE"); }
  };
  class TransactionPool {
    async connect() { calls.push("CONNECT"); return client; }
    async end() {}
  }
  const adapter = createPostgresqlPersistence(config(), { PoolImpl: TransactionPool });
  const result = await adapter.withTransaction(async (activeClient) => {
    assert.equal(activeClient, client);
    await activeClient.query("SELECT 1");
    return "committed";
  });
  assert.equal(result, "committed");
  assert.deepEqual(calls, ["CONNECT", "BEGIN", 'SET LOCAL search_path TO "mcp", public', "SELECT 1", "COMMIT", "RELEASE"]);

  calls.length = 0;
  await assert.rejects(
    () => adapter.withTransaction(async () => { throw new Error("forced_failure"); }),
    /forced_failure/
  );
  assert.deepEqual(calls, ["CONNECT", "BEGIN", 'SET LOCAL search_path TO "mcp", public', "ROLLBACK", "RELEASE"]);
});

test("unreachable database and schema, search_path, or role mismatches fail closed", async () => {
  class DownPool {
    async query() { throw new Error("password and host details"); }
    async end() {}
  }
  assert.deepEqual(
    await createPostgresqlPersistence(config(), { PoolImpl: DownPool }).readiness(),
    { provider: "postgresql", configured: true, ready: false, code: "persistence_unavailable" }
  );

  class MissingSchemaPool {
    async query() { return { rows: [{ role: "mcp_runtime", search_path: "mcp, public", schema_available: false }] }; }
    async end() {}
  }
  assert.deepEqual(
    await createPostgresqlPersistence(config(), { PoolImpl: MissingSchemaPool }).readiness(),
    { provider: "postgresql", configured: true, ready: false, code: "persistence_schema_unavailable" }
  );

  class WrongSearchPathPool {
    async query() { return { rows: [{ role: "mcp_runtime", search_path: "public, mcp", schema_available: true }] }; }
    async end() {}
  }
  assert.deepEqual(
    await createPostgresqlPersistence(config(), { PoolImpl: WrongSearchPathPool }).readiness(),
    { provider: "postgresql", configured: true, ready: false, code: "persistence_search_path_mismatch" }
  );

  class WrongRolePool {
    async query() { return { rows: [{ role: "postgres", search_path: "mcp, public", schema_available: true }] }; }
    async end() {}
  }
  assert.deepEqual(
    await createPostgresqlPersistence(config({ expectedRole: "mcp_runtime" }), { PoolImpl: WrongRolePool }).readiness(),
    { provider: "postgresql", configured: true, ready: false, code: "persistence_role_mismatch" }
  );
});
