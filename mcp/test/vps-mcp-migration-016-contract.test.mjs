import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../.github/workflows/vps-mcp-migration-016-manual.yml", import.meta.url), "utf8");
const canonical = readFileSync(new URL("../../database/migrations/mcp/016_mcp_media_pending_expiry.sql", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../apps/backend/foundation/migrations/sql/016_mcp_media_pending_expiry.sql", import.meta.url), "utf8");

test("VPS MCP migration 016 gate is exact-main, manual-only and serialized", () => {
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-mcp-production-016'/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.doesNotMatch(workflow, /HEROKU_API_KEY|hung-phat-mcp|heroku config/i);
});

test("VPS MCP migration 016 gate proves backup restore rehearsal before production mutation", () => {
  assert.match(workflow, /pg_dump/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /createdb "\$rehearsal_db"/);
  assert.match(workflow, /MCP_BACKUP_RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /MCP_ROW_COUNT_RECONCILIATION=PASS/);
});

test("VPS MCP migration 016 repairs stale pending reservations and preserves least privilege", () => {
  assert.equal(canonical, runtime);
  assert.match(canonical, /interval '10 minutes'/);
  assert.match(canonical, /upload_reservation_expired_at/);
  assert.match(canonical, /CREATE OR REPLACE FUNCTION mcp\.enforce_outlet_media_limit\(\)/);
  assert.match(canonical, /CREATE OR REPLACE FUNCTION mcp\.sync_outlet_media_shared_registry\(\)/);
  assert.match(canonical, /NEW\.status IN \('failed', 'deleted'\)/);
  assert.match(workflow, /PREDECESSOR_ID: mcp_015_customer_media_boundary/);
  assert.match(workflow, /MIGRATION_ID: mcp_016_media_pending_expiry/);
  assert.doesNotMatch(canonical, /GRANT[^;]+ON TABLE shared\.(customers|customer_media)/);
});
