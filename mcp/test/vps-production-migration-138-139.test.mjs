import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = ".github/workflows/vps-production-migration-138-139-manual.yml";

test("VPS production migrations 138-139 are manual, exact and backup/rehearsal gated", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.equal(workflow.split(/\r?\n/, 1)[0], "name: VPS production DB migrations 138-139");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-138-139'/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);

  assert.match(workflow, /db="npp_production"/);
  assert.match(workflow, /137_document_print_template_font_size/);
  assert.match(workflow, /138_inventory_stocktake_line_details/);
  assert.match(workflow, /139_inventory_stocktake_line_annotation/);
  assert.match(workflow, /pg_dump -Fc/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /npp_migration_rehearsal_/);
  assert.match(workflow, /RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /SET LOCAL lock_timeout = '5s'/);
  assert.match(workflow, /INSERT INTO shared\.schema_migrations/);
  assert.match(workflow, /count_reason/);
  assert.match(workflow, /count_note/);
  assert.match(workflow, /stocktake_lines_count_reason_length/);
  assert.match(workflow, /stocktake_lines_count_note_length/);
  assert.match(workflow, /stocktake_lines_history_guard/);
  assert.match(workflow, /write_context = ''annotation''/);
  assert.match(workflow, /write_context = ''posting''/);
  assert.match(workflow, /STOCKTAKE_LINE_ROWS_UNCHANGED=PASS/);
  assert.match(workflow, /PRODUCTION_RERUN_NOOP=PASS/);

  assert.doesNotMatch(workflow, /HEROKU_/);
  assert.doesNotMatch(workflow, /DATABASE_URL/);
  assert.doesNotMatch(workflow, /postgres(?:ql)?:\/\/[^\s"']+@/i);
});
