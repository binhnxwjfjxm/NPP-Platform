import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
test('migration 168 production gate keeps backup, restore, data checks and exact owner trigger', () => {
  const workflow = read('.github/workflows/vps-production-migration-168-manual.yml');
  const script = read('npp-core/api/scripts/vps-production-migrate-sales-reporting-index-168.sh');
  assert.match(workflow, /\/migrate-vps-production-168/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /Verify exact origin\/main SHA/);
  assert.match(workflow, /VPS_DB_SSH_KEY/);
  assert.match(workflow, /ServerAliveInterval=15/);
  assert.match(workflow, /ServerAliveCountMax=40/);
  assert.match(script, /ACTIVE_REHEARSAL_SESSIONS/);
  assert.match(script, /DATABASE_READONLY_PREFLIGHT=PASS/);
  for (const p of ['pg_dump -Fc', 'pg_restore --exit-on-error', 'lock_timeout', 'counts()', 'sums()', 'PRODUCTION_RERUN_NOOP=PASS']) assert.ok(script.includes(p));
});
