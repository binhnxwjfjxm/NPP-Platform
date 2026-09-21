import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/vps-production-migration-146-147-manual.yml', import.meta.url);
const auditPath = new URL('../../.github/workflows/vps-production-audit-manual.yml', import.meta.url);

test('VPS production migrations 146-147 are fresh-backup gated and exact-main only', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.equal(workflow.split(/\r?\n/, 1)[0], 'name: VPS production DB migrations 146-147');
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-146-147'/);
  assert.match(workflow, /gustavjung01/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /145_company_runtime_privileges/);
  assert.match(workflow, /146_workforce_leave_absence/);
  assert.match(workflow, /147_workforce_violation_handling/);
  assert.match(workflow, /pg_dump -Fc/);
  assert.match(workflow, /pg_restore/);
  assert.match(workflow, /RESTORE_REHEARSAL=PASS/);
  assert.match(workflow, /PROTECTED_ROWS_UNCHANGED=PASS/);
  assert.match(workflow, /WORKFORCE_WORKFLOW_ROWS_STABLE=PASS/);
  assert.match(workflow, /RUNTIME_PRIVILEGES=PASS/);
  assert.match(workflow, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(workflow, /PRODUCTION_VERIFY=PASS/);
  assert.doesNotMatch(workflow, /HEROKU_/);
  assert.doesNotMatch(workflow, /DATABASE_URL/);
});

test('VPS read-only audit accepts the current production operator', async () => {
  const workflow = await readFile(auditPath, 'utf8');
  assert.match(workflow, /github\.event\.comment\.body == '\/audit-vps-production'/);
  assert.match(workflow, /github\.actor == 'gustavjung01'/);
});
