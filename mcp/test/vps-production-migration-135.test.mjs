import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = ".github/workflows/vps-production-migration-135-manual.yml";

test("VPS production migration 135 is manual, exact and backup/rehearsal gated", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.equal(workflow.split(/\r?\n/, 1)[0], "name: VPS production DB migration 135");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-135'/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);

  assert.match(workflow, /db="npp_production"/);
  assert.match(workflow, /135_sales_order_sku_search_indexes/);
  assert.match(workflow, /134_customer_profile_delivery_return_indexes/);
  assert.match(workflow, /pg_dump -Fc/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /npp_migration_rehearsal_/);
  assert.match(workflow, /RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /SET LOCAL lock_timeout = '5s'/);
  assert.match(workflow, /INSERT INTO shared\.schema_migrations/);
  assert.match(workflow, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(workflow, /INVALID_INDEXES=0/);

  assert.doesNotMatch(workflow, /HEROKU_/);
  assert.doesNotMatch(workflow, /DATABASE_URL/);
  assert.doesNotMatch(workflow, /postgres(?:ql)?:\/\/[^\s"']+@/i);
});
