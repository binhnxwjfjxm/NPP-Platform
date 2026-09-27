import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../.github/workflows/vps-mcp-migration-015-manual.yml", import.meta.url), "utf8");
const canonical = readFileSync(new URL("../../database/migrations/mcp/015_mcp_customer_media_boundary.sql", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../apps/backend/foundation/migrations/sql/015_mcp_customer_media_boundary.sql", import.meta.url), "utf8");

test("VPS MCP migration 015 gate is exact-main, manual-only and serialized", () => {
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-mcp-production-015'/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /test "\$sha" = "\$\(git rev-parse origin\/main\)"/);
  assert.doesNotMatch(workflow, /HEROKU_API_KEY|hung-phat-mcp|heroku config/);
});

test("VPS MCP migration 015 gate proves backup and restore rehearsal before production mutation", () => {
  assert.match(workflow, /pg_dump/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /createdb "\$rehearsal_db"/);
  assert.match(workflow, /cmp "\$before_counts" "\$rehearsal_before"/);
  assert.match(workflow, /rehearsal_result="\$\(apply_migration "\$rehearsal_db"\)"/);
  assert.match(workflow, /production_result="\$\(apply_migration "\$production_db"\)"/);
  assert.match(workflow, /MCP_BACKUP_RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /MCP_ROW_COUNT_RECONCILIATION=PASS/);
});

test("VPS MCP migration 015 gate preserves registry order and rerun semantics", () => {
  assert.match(workflow, /PREDECESSOR_ID: mcp_014_customer_read_boundary/);
  assert.match(workflow, /MIGRATION_ID: mcp_015_customer_media_boundary/);
  assert.match(workflow, /pg_advisory_xact_lock\(hashtext\('npp-platform:mcp-migrations'\)\)/);
  assert.match(workflow, /INSERT INTO shared\.schema_migrations/);
  assert.match(workflow, /test "\$\(apply_migration "\$production_db"\)" = "already_applied"/);
  assert.match(workflow, /MCP_MIGRATION_RERUN=NOOP/);
});

test("VPS MCP migration 015 verifies MCP read models and keeps direct shared access denied", () => {
  assert.match(workflow, /has_table_privilege\('\$runtime_role', 'mcp\.customer_media', 'SELECT'\)/);
  assert.match(workflow, /has_table_privilege\('\$runtime_role', 'mcp\.customer_addresses', 'SELECT'\)/);
  assert.match(workflow, /has_table_privilege\('\$runtime_role', 'shared\.customer_media', 'SELECT'\)/);
  assert.match(workflow, /has_table_privilege\('\$runtime_role', 'shared\.customers', 'SELECT'\)/);
  assert.match(workflow, /prosecdef::int/);
  assert.match(workflow, /MCP_DIRECT_SHARED_READS=DENIED/);
});

test("migration 015 canonical and backend copies remain byte-identical and least-privilege", () => {
  assert.equal(canonical, runtime);
  assert.match(canonical, /CREATE OR REPLACE VIEW mcp\.customer_media/);
  assert.match(canonical, /CREATE OR REPLACE VIEW mcp\.customer_addresses/);
  assert.match(canonical, /CREATE OR REPLACE FUNCTION mcp\.sync_outlet_media_shared_registry\(\)/);
  assert.match(canonical, /SECURITY DEFINER/);
  assert.match(canonical, /GRANT SELECT ON TABLE[\s\S]+mcp\.customer_media/);
  assert.doesNotMatch(canonical, /GRANT[^;]+ON TABLE shared\.(customers|customer_media)/);
  assert.match(canonical, /REVOKE ALL ON FUNCTION shared\.grant_mcp_runtime_access\(name\) FROM PUBLIC/);
});
