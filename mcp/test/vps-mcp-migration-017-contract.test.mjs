import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../.github/workflows/vps-mcp-migration-017-manual.yml", import.meta.url), "utf8");
const canonical = readFileSync(new URL("../../database/migrations/mcp/017_mcp_session_employee_ownership.sql", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../apps/backend/foundation/migrations/sql/017_mcp_session_employee_ownership.sql", import.meta.url), "utf8");

test("VPS MCP migration 017 gate is exact-main, manual-only and serialized", () => {
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-mcp-production-017'/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.doesNotMatch(workflow, /HEROKU_API_KEY|heroku config/i);
});

test("VPS MCP migration 017 proves backup and restore rehearsal before production mutation", () => {
  assert.match(workflow, /pg_dump/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /createdb "\$rehearsal_db"/);
  assert.match(workflow, /MCP_BACKUP_RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /MCP_ROW_COUNT_RECONCILIATION=PASS/);
  assert.match(workflow, /MCP_MIGRATION_RERUN=NOOP/);
});

test("VPS MCP migration 017 locks employee-owned sessions without exposing shared employee table", () => {
  assert.equal(canonical, runtime);
  assert.match(canonical, /ADD COLUMN IF NOT EXISTS owner_employee_id uuid NULL/);
  assert.match(canonical, /mcp_route_sessions_owner_employee_fk/);
  assert.match(canonical, /mcp_route_sessions_one_active_employee_idx/);
  assert.match(canonical, /mcp_route_sessions_one_active_service_idx/);
  assert.match(canonical, /DROP INDEX IF EXISTS mcp\.mcp_route_sessions_one_active_idx/);
  assert.match(workflow, /PREDECESSOR_ID: mcp_016_media_pending_expiry/);
  assert.match(workflow, /MIGRATION_ID: mcp_017_session_employee_ownership/);
  assert.match(workflow, /has_table_privilege\('\$runtime_role', 'shared\.employees', 'SELECT'\)::int/);
  assert.match(workflow, /MCP_SESSION_OWNERSHIP_CONTRACT=PASS/);
});
