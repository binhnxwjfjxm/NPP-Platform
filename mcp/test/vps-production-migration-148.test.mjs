import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/vps-production-migration-148-manual.yml', import.meta.url);
const runnerPath = new URL('../../npp-core/api/scripts/vps-production-migrate-workforce-148.sh', import.meta.url);

test('VPS production migration 148 is exact-main, backup-gated and rehearsed', async () => {
  const [workflow, runner] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    readFile(runnerPath, 'utf8'),
  ]);

  assert.equal(workflow.split(/\r?\n/, 1)[0], 'name: VPS production DB migration 148');
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-148'/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /148_workforce_attendance_movement\.sql/);
  assert.match(workflow, /vps-production-migrate-workforce-148\.sh/);
  assert.match(workflow, /VPS_DB_SSH_KEY/);

  assert.match(runner, /147_workforce_violation_handling/);
  assert.match(runner, /148_workforce_attendance_movement/);
  assert.match(runner, /pg_dump -Fc/);
  assert.match(runner, /pg_restore/);
  assert.match(runner, /RESTORE_REHEARSAL=PASS/);
  assert.match(runner, /PROTECTED_ROWS_UNCHANGED=PASS/);
  assert.match(runner, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(runner, /PRODUCTION_VERIFY=PASS/);
  assert.match(runner, /attendance_basis/);
  assert.match(runner, /movement_reason/);
  assert.match(runner, /grant_company_runtime_access/);
  assert.doesNotMatch(runner, /HEROKU_|DATABASE_URL/);
});
