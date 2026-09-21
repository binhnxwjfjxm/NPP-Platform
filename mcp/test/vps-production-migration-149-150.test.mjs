import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/vps-production-migration-149-150-manual.yml', import.meta.url);
const scriptPath = new URL('../../npp-core/api/scripts/vps-production-migrate-workforce-149-150.sh', import.meta.url);

test('VPS production migrations 149-150 are exact-main, backup and restore-rehearsal gated', async () => {
  const [workflow, script] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    readFile(scriptPath, 'utf8'),
  ]);

  assert.equal(workflow.split(/\r?\n/, 1)[0], 'name: VPS production DB migrations 149-150');
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-149-150'/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /149_workforce_employee_history\.sql/);
  assert.match(workflow, /150_workforce_organization_structure\.sql/);
  assert.match(workflow, /vps-production-migrate-workforce-149-150\.sh/);
  assert.match(workflow, /VPS_SSH_USER@\$VPS_DB_HOST/);
  assert.match(workflow, /set \+e/);
  assert.match(workflow, /> "\$out" 2>&1/);
  assert.match(workflow, /exit "\$status"/);

  assert.match(script, /148_workforce_attendance_movement/);
  assert.match(script, /149_workforce_employee_history/);
  assert.match(script, /150_workforce_organization_structure/);
  assert.match(script, /pg_dump -Fc/);
  assert.match(script, /pg_restore/);
  assert.match(script, /RESTORE_REHEARSAL=PASS/);
  assert.match(script, /PROTECTED_ROWS_UNCHANGED=PASS/);
  assert.match(script, /WORKFORCE_HISTORY_RERUN_STABLE=PASS/);
  assert.match(script, /grant_company_runtime_access\('npp_company_runtime'::name\)/);
  assert.match(script, /MISSING_EMPLOYMENTS=/);
  assert.match(script, /MISSING_ASSIGNMENTS=/);
  assert.match(script, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(script, /PRODUCTION_VERIFY=PASS/);
  assert.doesNotMatch(script, /HEROKU_|DATABASE_URL/);
});
