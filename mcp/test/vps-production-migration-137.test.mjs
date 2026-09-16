import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = ".github/workflows/vps-production-migration-137-manual.yml";

test("VPS production migration 137 is manual, exact and backup/rehearsal gated", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.equal(workflow.split(/\r?\n/, 1)[0], "name: VPS production DB migration 137");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-137'/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);

  assert.match(workflow, /db="npp_production"/);
  assert.match(workflow, /137_document_print_template_font_size/);
  assert.match(workflow, /136_inventory_tracking_policy_backfill/);
  assert.match(workflow, /pg_dump -Fc/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /npp_migration_rehearsal_/);
  assert.match(workflow, /RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /SET LOCAL lock_timeout = '5s'/);
  assert.match(workflow, /INSERT INTO shared\.schema_migrations/);
  assert.match(workflow, /font_size_percent/);
  assert.match(workflow, /document_print_template_settings_font_size_check/);
  assert.match(workflow, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(workflow, /PRINT_TEMPLATE_ROWS_UNCHANGED=PASS/);
  assert.match(workflow, /INVALID_FONT_SIZE_ROWS=0/);

  assert.doesNotMatch(workflow, /HEROKU_/);
  assert.doesNotMatch(workflow, /DATABASE_URL/);
  assert.doesNotMatch(workflow, /postgres(?:ql)?:\/\/[^\s"']+@/i);
});
