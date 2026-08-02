import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_MIGRATIONS, migrationStatusWithAdapter, runMcpMigrations } from "./index.js";

function statefulAdapter({ failSql = null } = {}) {
  const applied = new Set();
  const calls = [];
  return {
    calls,
    async query(text, values = []) {
      calls.push({ text: String(text), values });
      if (failSql && String(text).includes(failSql)) throw new Error("forced_migration_failure");
      if (String(text).includes("to_regclass")) return { rows: [{ exists: true }] };
      if (String(text).startsWith("SELECT id FROM shared.schema_migrations WHERE")) {
        return { rows: [...applied].filter((id) => id.startsWith("mcp_")).sort().map((id) => ({ id })) };
      }
      if (String(text) === "SELECT id FROM shared.schema_migrations ORDER BY id") {
        return { rows: [...applied].sort().map((id) => ({ id })) };
      }
      if (String(text).startsWith("INSERT INTO shared.schema_migrations")) {
        applied.add(String(values[0]));
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

test("MCP migrations use a unique registry namespace and apply once in one locked transaction", async () => {
  assert.deepEqual(MCP_MIGRATIONS.map((item) => item.id), ["mcp_001_write_foundation"]);
  const adapter = statefulAdapter();
  const first = await runMcpMigrations(adapter);
  const second = await runMcpMigrations(adapter);
  assert.deepEqual(first.applied, ["mcp_001_write_foundation"]);
  assert.deepEqual(second.applied, []);
  assert.equal(adapter.calls.filter((call) => call.text === "BEGIN").length, 2);
  assert.equal(adapter.calls.filter((call) => call.text === "COMMIT").length, 2);
  assert.equal(adapter.calls.some((call) => call.text.includes("pg_advisory_xact_lock")), true);
  assert.equal(adapter.calls.some((call) => call.text.includes("CREATE TABLE IF NOT EXISTS mcp.idempotency_records")), true);

  const status = await migrationStatusWithAdapter(adapter);
  assert.deepEqual(status.pending, []);
  assert.deepEqual(status.applied, ["mcp_001_write_foundation"]);
});

test("MCP migration owns only the MCP write foundation and leaves runtime role provisioning external", () => {
  const sql = MCP_MIGRATIONS[0].sql;
  const canonicalSql = readFileSync(new URL("../../../../../database/migrations/mcp/001_mcp_write_foundation.sql", import.meta.url), "utf8");
  assert.equal(sql, canonicalSql);
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS mcp/);
  assert.match(sql, /REVOKE ALL ON SCHEMA mcp FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA mcp FROM PUBLIC/);
  assert.doesNotMatch(sql, /CREATE\s+ROLE|ALTER\s+ROLE/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE\s+(shared|sales|purchasing|inventory|logistics|accounting|reporting)\./i);
  assert.doesNotMatch(sql, /GRANT[\s\S]+ON\s+(SCHEMA|TABLE)[\s\S]+(shared|sales|purchasing|inventory|logistics|accounting|reporting)/i);
});

test("migration failure rolls back and preserves the original error", async () => {
  const adapter = statefulAdapter({ failSql: "CREATE TABLE IF NOT EXISTS mcp.idempotency_records" });
  await assert.rejects(() => runMcpMigrations(adapter), /forced_migration_failure/);
  assert.equal(adapter.calls.some((call) => call.text === "ROLLBACK"), true);
  assert.equal(adapter.calls.some((call) => call.text === "COMMIT"), false);
});
