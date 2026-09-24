import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

test('migration 158 is registered and keeps all attendance method combinations', () => {
  const index = source('src/migrations/index.js');
  const migration = source('../../database/migrations/shared/158_workforce_attendance_method_combinations.sql');
  assert.match(index, /158_workforce_attendance_method_combinations/);
  for (const value of ['QR', 'MANUAL', 'BOTH', 'FACE', 'QR_FACE', 'FACE_MANUAL', 'ALL', 'NONE']) {
    assert.match(migration, new RegExp("'" + value + "'"));
  }
});

test('migration 158 production operation is VPS-only, exact-main, backed up and rehearsal-gated', () => {
  const script = source('scripts/vps-production-migrate-workforce-158.sh');
  const workflow = source('../../.github/workflows/vps-production-migration-158-manual.yml');

  assert.match(script, /predecessor_id="157_workforce_face_attendance"/);
  assert.match(script, /migration_id="158_workforce_attendance_method_combinations"/);
  assert.match(script, /pg_dump -Fc/);
  assert.match(script, /pg_restore --exit-on-error/);
  assert.match(script, /POLICY_METHOD_DISTRIBUTION_UNCHANGED=PASS/);
  assert.match(script, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(script, /PRODUCTION_VERIFY=PASS/);

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: vps-production-db-migration-158/);
  assert.match(workflow, /\/migrate-vps-production-158/);
  assert.match(workflow, /Verify exact origin\/main SHA/);
  assert.match(workflow, /Fresh backup, restore rehearsal, migrate production and verify/);
  assert.doesNotMatch(workflow, /HEROKU/i);
});
