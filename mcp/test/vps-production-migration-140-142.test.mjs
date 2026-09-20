import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = ".github/workflows/vps-production-migration-140-142-manual.yml";

test("VPS production migrations 140-142 are ordered, gated and rehearse before production", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.equal(workflow.split(/\r?\n/, 1)[0], "name: VPS production DB migrations 140-142");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-140-142'/);
  assert.match(workflow, /gustavjung01/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);

  assert.match(workflow, /139_inventory_stocktake_line_annotation/);
  assert.match(workflow, /140_workforce_attendance_foundation/);
  assert.match(workflow, /141_workforce_attendance_qr/);
  assert.match(workflow, /142_inventory_adjustment_warehouse_location_guard/);
  assert.match(workflow, /pg_dump -Fc/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /SET LOCAL lock_timeout = '5s'/);
  assert.match(workflow, /INSERT INTO shared\.schema_migrations/);
  assert.match(workflow, /warehouse_location_mode = ''UNMANAGED''/);
  assert.match(workflow, /inventory_adjustment_source_location_required/);
  assert.match(workflow, /PROTECTED_ROWS_UNCHANGED=PASS/);
  assert.match(workflow, /PRODUCTION_RERUN_NOOP=PASS/);

  assert.doesNotMatch(workflow, /HEROKU_/);
  assert.doesNotMatch(workflow, /DATABASE_URL/);
  assert.doesNotMatch(workflow, /postgres(?:ql)?:\/\/[^\s"']+@/i);
});
