import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = ".github/workflows/vps-production-migration-144-manual.yml";

test("VPS production migration 144 is gated, backed up, rehearsed and verified before production", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.equal(workflow.split(/\r?\n/, 1)[0], "name: VPS production DB migration 144");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-144'/);
  assert.match(workflow, /gustavjung01/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /143_inventory_adjustment_reconciliation_batch/);
  assert.match(workflow, /144_workforce_attendance_adjustment_lock/);
  assert.match(workflow, /pg_dump -Fc/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /SET LOCAL lock_timeout = '5s'/);
  assert.match(workflow, /INSERT INTO shared\.schema_migrations/);
  assert.match(workflow, /attendance_adjustment_requests/);
  assert.match(workflow, /attendance_period_locks/);
  assert.match(workflow, /core\.attendance\.self-adjust-request/);
  assert.match(workflow, /core\.attendance\.lock/);
  assert.match(workflow, /PROTECTED_ROWS_UNCHANGED=PASS/);
  assert.match(workflow, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(workflow, /PRODUCTION_VERIFY=PASS/);
  assert.doesNotMatch(workflow, /HEROKU_/);
  assert.doesNotMatch(workflow, /DATABASE_URL/);
});
