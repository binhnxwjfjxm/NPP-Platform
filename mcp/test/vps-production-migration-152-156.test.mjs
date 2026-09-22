import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('VPS workforce production migration 152-156 is exact-main, manual-only and serialized', async () => {
  const workflow = await source('.github/workflows/vps-production-migration-152-156-manual.yml');
  assert.match(workflow, /name: VPS production DB migrations 152-156/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/migrate-vps-production-152-156'/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  for (const id of ['152','153','154','155','156']) assert.match(workflow, new RegExp(id));
  assert.doesNotMatch(workflow, /push:|pull_request:/);
});

test('VPS workforce production migration 152-156 proves backup, restore rehearsal, rerun and verification', async () => {
  const script = await source('npp-core/api/scripts/vps-production-migrate-workforce-152-156.sh');
  assert.match(script, /pg_dump -Fc/);
  assert.match(script, /pg_restore --exit-on-error/);
  assert.match(script, /npp_migration_rehearsal_/);
  assert.match(script, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(script, /PRODUCTION_VERIFY=PASS/);
  assert.match(script, /PROTECTED_ROWS_UNCHANGED=PASS/);
  assert.match(script, /RUNTIME_PRIVILEGES=PASS/);
  assert.match(script, /152_workforce_leave_balance_ledger/);
  assert.match(script, /156_workforce_payroll_closeout/);
  assert.doesNotMatch(script, /DATABASE_URL|postgresql:\/\//);
});
