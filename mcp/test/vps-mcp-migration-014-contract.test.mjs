import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../.github/workflows/vps-mcp-migration-014-manual.yml", import.meta.url), "utf8");
const canonical = readFileSync(new URL("../../database/migrations/mcp/014_mcp_customer_read_boundary.sql", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../apps/backend/foundation/migrations/sql/014_mcp_customer_read_boundary.sql", import.meta.url), "utf8");

test("VPS MCP migration 014 gate is exact-main, manual-only and serialized with production DB migrations", () => {
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-mcp-production-014'/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /test \"\$sha\" = \"\$\(git rev-parse origin\/main\)\"/);
  assert.doesNotMatch(workflow, /HEROKU_API_KEY|hung-phat-mcp|heroku config/);
});

test("VPS MCP migration 014 gate proves backup restore rehearsal before production mutation", () => {
  assert.match(workflow, /pg_dump/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /createdb \"\$rehearsal_db\"/);
  assert.match(workflow, /cmp \"\$before_counts\" \"\$rehearsal_before\"/);
  assert.match(workflow, /rehearsal_result=\"\$\(apply_migration \"\$rehearsal_db\"\)\"/);
  assert.match(workflow, /production_result=\"\$\(apply_migration \"\$production_db\"\)\"/);
  assert.match(workflow, /MCP_BACKUP_RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /MCP_ROW_COUNT_RECONCILIATION=PASS/);
});

test("VPS MCP migration 014 gate preserves canonical registry and idempotent rerun semantics", () => {
  assert.match(workflow, /mcp_013_customer_verification_review_reason/);
  assert.match(workflow, /mcp_014_customer_read_boundary/);
  assert.match(workflow, /pg_advisory_xact_lock\(hashtext\('npp-platform:mcp-migrations'\)\)/);
  assert.match(workflow, /INSERT INTO shared\.schema_migrations/);
  assert.match(workflow, /test \"\$\(apply_migration \"\$production_db\"\)\" = \"already_applied\"/);
  assert.match(workflow, /MCP_MIGRATION_RERUN=NOOP/);
});

test("VPS MCP migration 014 gate reapplies narrow runtime grants without opening shared tables", () => {
  assert.match(workflow, /shared\.grant_mcp_runtime_access/);
  assert.match(workflow, /has_table_privilege\('\$runtime_role', 'mcp\.workforce_employees', 'SELECT'\)/);
  assert.match(workflow, /has_table_privilege\('\$runtime_role', 'mcp\.customer_addresses', 'SELECT'\)/);
  assert.match(workflow, /has_table_privilege\('\$runtime_role', 'shared\.employees', 'SELECT'\)/);
  assert.match(workflow, /has_table_privilege\('\$runtime_role', 'shared\.customers', 'SELECT'\)/);
  assert.match(workflow, /has_table_privilege\('\$runtime_role', 'shared\.customer_addresses', 'SELECT'\)/);
  assert.match(workflow, /MCP_DIRECT_SHARED_READS=DENIED/);
});

test("migration 014 canonical and backend copies remain byte-identical and least-privilege", () => {
  assert.equal(canonical, runtime);
  assert.match(canonical, /CREATE OR REPLACE VIEW mcp\.workforce_employees/);
  assert.match(canonical, /CREATE OR REPLACE VIEW mcp\.customer_addresses/);
  assert.match(canonical, /GRANT SELECT ON TABLE mcp\.accounts/);
  assert.doesNotMatch(canonical, /GRANT SELECT ON TABLE shared\./);
  assert.match(canonical, /REVOKE ALL ON FUNCTION shared\.grant_mcp_runtime_access\(name\) FROM PUBLIC/);
});
