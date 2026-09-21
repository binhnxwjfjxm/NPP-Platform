import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/vps-production-migration-146-147-manual.yml', import.meta.url);
const scriptPath = new URL('../../npp-core/api/scripts/vps-production-migrate-workforce-146-147.sh', import.meta.url);
const auditPath = new URL('../../.github/workflows/vps-production-audit-manual.yml', import.meta.url);

test('VPS production migrations 146-147 use exact main and a separate guarded DB script', async () => {
  const [workflow, script] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    readFile(scriptPath, 'utf8'),
  ]);
  assert.equal(workflow.split(/\r?\n/, 1)[0], 'name: VPS production DB migrations 146-147');
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-146-147'/);
  assert.match(workflow, /gustavjung01/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /vps-production-migrate-workforce-146-147\.sh/);
  assert.match(workflow, /VPS_SSH_USER@\$VPS_DB_HOST/);
  assert.doesNotMatch(workflow, /\$VPS_SSH_USER\$@VPS_DB_HOST/);

  assert.match(script, /145_company_runtime_privileges/);
  assert.match(script, /146_workforce_leave_absence/);
  assert.match(script, /147_workforce_violation_handling/);
  assert.match(script, /pg_dump -Fc/);
  assert.match(script, /pg_restore/);
  assert.match(script, /RESTORE_REHEARSAL=PASS/);
  assert.match(script, /PROTECTED_ROWS_UNCHANGED=PASS/);
  assert.match(script, /WORKFORCE_WORKFLOW_ROWS_STABLE=PASS/);
  assert.match(script, /RUNTIME_PRIVILEGES=PASS/);
  assert.match(script, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(script, /PRODUCTION_VERIFY=PASS/);
  assert.doesNotMatch(script, /HEROKU_|DATABASE_URL/);
});

test('VPS read-only audit accepts the current production operator', async () => {
  const workflow = await readFile(auditPath, 'utf8');
  assert.match(workflow, /github\.event\.comment\.body == '\/audit-vps-production'/);
  assert.match(workflow, /github\.actor == 'gustavjung01'/);
});
