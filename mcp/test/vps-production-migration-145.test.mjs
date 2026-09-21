import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/vps-production-migration-145-manual.yml', import.meta.url);

test('VPS production migration 145 repairs current grants and locks future default privileges', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.equal(workflow.split(/\r?\n/, 1)[0], 'name: VPS production DB migration 145');
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-145'/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /144_workforce_attendance_adjustment_lock/);
  assert.match(workflow, /145_company_runtime_privileges/);
  assert.match(workflow, /npp_company_runtime/);
  assert.match(workflow, /pg_dump -Fc/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /WORKFORCE_TABLE_PRIVILEGES_BEFORE/);
  assert.match(workflow, /WORKFORCE_TABLE_PRIVILEGES_AFTER=8\/8/);
  assert.match(workflow, /pg_default_acl/);
  assert.match(workflow, /PROTECTED_ROWS_UNCHANGED=PASS/);
  assert.match(workflow, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(workflow, /PRODUCTION_VERIFY=PASS/);
  assert.doesNotMatch(workflow, /HEROKU_/);
  assert.doesNotMatch(workflow, /DATABASE_URL/);
});
