import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

test('migration 159 is registered for manual workforce attendance and paper leave', () => {
  const index = source('src/migrations/index.js');
  const migration = source('../../database/migrations/shared/159_workforce_manual_attendance_leave.sql');
  assert.match(index, /159_workforce_manual_attendance_leave/);
  assert.match(migration, /request_source/);
  assert.match(migration, /MANUAL_PAPER/);
  assert.match(migration, /requested_by_employee_id DROP NOT NULL/);
});

test('migration 159 production operation is VPS-only, exact-main, backed up and rehearsal-gated', () => {
  const script = source('scripts/vps-production-migrate-workforce-159.sh');
  const workflow = source('../../.github/workflows/vps-production-migration-159-manual.yml');

  assert.match(script, /predecessor_id="158_workforce_attendance_method_combinations"/);
  assert.match(script, /migration_id="159_workforce_manual_attendance_leave"/);
  assert.match(script, /pg_dump -Fc/);
  assert.match(script, /pg_restore --exit-on-error/);
  assert.match(script, /LEAVE_STATUS_DISTRIBUTION_UNCHANGED=PASS/);
  assert.match(script, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(script, /PRODUCTION_VERIFY=PASS/);
  assert.match(script, /leave_balance_ledger/);
  assert.doesNotMatch(script, /leave_balance_entries/);

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /\/migrate-vps-production-159/);
  assert.match(workflow, /Verify exact origin\/main SHA/);
  assert.match(workflow, /Fresh backup, restore rehearsal, migrate production and verify/);
  assert.match(workflow, /Run ID: \$GITHUB_RUN_ID/);
  assert.match(workflow, /Exact main SHA: \$SOURCE_SHA/);
  assert.doesNotMatch(workflow, /HEROKU/i);
});
