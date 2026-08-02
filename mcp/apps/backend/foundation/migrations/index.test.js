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
      if (String(text).includes("to_regclass") || String(text).includes("to_regprocedure")) {
        return { rows: [{ exists: true }] };
      }
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

const EXPECTED_MIGRATIONS = [
  "mcp_001_write_foundation",
  "mcp_002_domain_read_models",
  "mcp_003_legacy_write_contract",
  "mcp_004_profile_media_contract"
];

test("MCP migrations use a unique registry namespace and apply once in one locked transaction", async () => {
  assert.deepEqual(MCP_MIGRATIONS.map((item) => item.id), EXPECTED_MIGRATIONS);
  const adapter = statefulAdapter();
  const first = await runMcpMigrations(adapter);
  const second = await runMcpMigrations(adapter);
  assert.deepEqual(first.applied, EXPECTED_MIGRATIONS);
  assert.deepEqual(second.applied, []);
  assert.equal(adapter.calls.filter((call) => call.text === "BEGIN").length, 2);
  assert.equal(adapter.calls.filter((call) => call.text === "COMMIT").length, 2);
  assert.equal(adapter.calls.some((call) => call.text.includes("pg_advisory_xact_lock")), true);
  assert.equal(adapter.calls.some((call) => call.text.includes("CREATE TABLE IF NOT EXISTS mcp.idempotency_records")), true);
  assert.equal(adapter.calls.some((call) => call.text.includes("CREATE TABLE IF NOT EXISTS mcp.mcp_routes")), true);
  assert.equal(adapter.calls.some((call) => call.text.includes("CREATE TABLE IF NOT EXISTS mcp.orders")), true);
  assert.equal(adapter.calls.some((call) => call.text.includes("CREATE TABLE IF NOT EXISTS mcp.mcp_outlet_media")), true);
  assert.equal(adapter.calls.some((call) => call.text.includes("CREATE TABLE IF NOT EXISTS mcp.mcp_archive_intents")), true);
  assert.equal(adapter.calls.some((call) => call.text.includes("ALTER COLUMN session_id DROP NOT NULL")), true);

  const status = await migrationStatusWithAdapter(adapter);
  assert.deepEqual(status.pending, []);
  assert.deepEqual(status.applied, EXPECTED_MIGRATIONS);
});

test("MCP foundation migration is canonical and leaves runtime role creation external", () => {
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

test("MCP domain migration owns writable MCP data and exposes only shared Core masters through views", () => {
  const sql = MCP_MIGRATIONS[1].sql;
  const canonicalSql = readFileSync(new URL("../../../../../database/migrations/mcp/002_mcp_domain_read_models.sql", import.meta.url), "utf8");
  assert.equal(sql, canonicalSql);

  for (const table of [
    "mcp_routes",
    "mcp_route_customers",
    "mcp_route_sessions",
    "mcp_session_customers",
    "mcp_visits",
    "mcp_followups",
    "mcp_session_reports",
    "market_reports",
    "mcp_report_setting_groups",
    "mcp_report_settings",
    "orders",
    "order_items",
    "test_files",
    "test_file_products",
    "test_customers",
    "test_customer_results"
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS mcp\\.${table}`));
  }

  for (const view of ["accounts", "products", "product_variants", "route_customers"]) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE VIEW mcp\\.${view}`));
  }

  assert.match(sql, /id text PRIMARY KEY DEFAULT \('route_'/);
  assert.match(sql, /id text PRIMARY KEY DEFAULT \('order_'/);
  assert.match(sql, /installation_id text/);
  assert.match(sql, /FROM shared\.customers/);
  assert.match(sql, /FROM shared\.products/);
  assert.match(sql, /FROM shared\.product_variants/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE VIEW mcp\.(orders|order_items)/);
  assert.doesNotMatch(sql, /FROM sales\./);
  assert.match(sql, /CREATE OR REPLACE FUNCTION shared\.grant_mcp_runtime_access/);
  assert.match(sql, /ALTER ROLE %I IN DATABASE %I SET search_path = mcp, public/);
  assert.doesNotMatch(sql, /CREATE\s+ROLE|ALTER\s+ROLE\s+mcp_runtime/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE\s+(shared|sales|purchasing|inventory|logistics|accounting|reporting)\./i);
  assert.doesNotMatch(sql, /public\.mcp_/i);
  assert.doesNotMatch(sql, /SUPABASE_/i);
});

test("MCP legacy write migration is canonical and ports final Supabase fields", () => {
  const sql = MCP_MIGRATIONS[2].sql;
  const canonicalSql = readFileSync(new URL("../../../../../database/migrations/mcp/003_mcp_legacy_write_contract.sql", import.meta.url), "utf8");
  assert.equal(sql, canonicalSql);
  for (const table of [
    "mcp_report_templates",
    "mcp_outlet_media",
    "mcp_storage_delete_jobs",
    "mcp_archive_intents"
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS mcp\\.${table}`));
  }
  for (const column of [
    "delete_requested_at",
    "deleted_at",
    "delete_attempt_count",
    "last_delete_error",
    "selected_competitor_ids",
    "selected_used_product_ids",
    "selected_setting_item_ids"
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(sql, /pg_has_role\(p_role::text, privileged\.oid, 'member'\)/);
  assert.match(sql, /pg_read_all_data/);
  assert.match(sql, /pg_write_all_data/);
  assert.doesNotMatch(sql, /public\.mcp_/i);
  assert.doesNotMatch(sql, /SUPABASE_/i);
});

test("MCP profile media migration preserves optional session and three-photo limit", () => {
  const sql = MCP_MIGRATIONS[3].sql;
  const canonicalSql = readFileSync(new URL("../../../../../database/migrations/mcp/004_mcp_profile_media_contract.sql", import.meta.url), "utf8");
  assert.equal(sql, canonicalSql);
  assert.match(sql, /ALTER COLUMN session_id DROP NOT NULL/i);
  assert.match(sql, /status IN \('pending', 'ready', 'deleting', 'delete_failed'\)/i);
  assert.match(sql, /v_active_media_count >= 3/i);
  assert.match(sql, /outlet_media_limit_reached/i);
  assert.match(sql, /CREATE TRIGGER mcp_outlet_media_limit/i);
  assert.doesNotMatch(sql, /public\.mcp_/i);
});

test("migration failure rolls back and preserves the original error", async () => {
  const adapter = statefulAdapter({ failSql: "CREATE TABLE IF NOT EXISTS mcp.idempotency_records" });
  await assert.rejects(() => runMcpMigrations(adapter), /forced_migration_failure/);
  assert.equal(adapter.calls.some((call) => call.text === "ROLLBACK"), true);
  assert.equal(adapter.calls.some((call) => call.text === "COMMIT"), false);
});
