import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = ".github/workflows/vps-production-migration-143-manual.yml";

test("VPS production migration 143 is gated, rehearsed and verified before production", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.equal(workflow.split(/\r?\n/, 1)[0], "name: VPS production DB migration 143");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-143'/);
  assert.match(workflow, /gustavjung01/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /142_inventory_adjustment_warehouse_location_guard/);
  assert.match(workflow, /143_inventory_adjustment_reconciliation_batch/);
  assert.match(workflow, /pg_dump -Fc/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /SET LOCAL lock_timeout = '5s'/);
  assert.match(workflow, /INSERT INTO shared\.schema_migrations/);
  assert.match(workflow, /reconciliation_batch_code/);
  assert.match(workflow, /counted_base_quantity_snapshot/);
  assert.match(workflow, /ADJUSTMENT_ROWS_UNCHANGED=PASS/);
  assert.match(workflow, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(workflow, /PRODUCTION_VERIFY=PASS/);
  assert.doesNotMatch(workflow, /HEROKU_/);
  assert.doesNotMatch(workflow, /DATABASE_URL/);
});
