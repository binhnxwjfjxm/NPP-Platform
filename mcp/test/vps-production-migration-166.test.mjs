import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const workflow = readFileSync(new URL('../../.github/workflows/vps-production-migration-166-manual.yml', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../npp-core/api/scripts/vps-production-migrate-inventory-signed-snapshot-166.sh', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../../database/migrations/inventory/166_inventory_adjustment_signed_system_snapshot.sql', import.meta.url), 'utf8');

test('production migration 166 runs only on authorized issue command or dispatch and exact main', () => {
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /migrate-vps-production-166/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /vps-production-db-migration/);
  assert.match(workflow, /VPS_DB_SSH_KEY/);
  assert.match(workflow, /166_inventory_adjustment_signed_system_snapshot/);
  assert.match(workflow, /scripts\/vps-production-migrate-inventory-signed-snapshot-166\.sh/);
  assert.match(workflow, /issues\/958\/comments/);
});
test('migration 166 backups, rehearses, verifies and preserves operational state', () => {
  assert.match(script, /pg_dump -Fc/);
  assert.match(script, /pg_restore --exit-on-error/);
  assert.match(script, /RESTORE_REHEARSAL=PASS/);
  assert.match(script, /SET LOCAL lock_timeout = '5s'/);
  assert.match(script, /npp_migration_rehearsal_/);
  assert.match(script, /protected_counts/);
  assert.match(script, /snapshot_sums/);
  assert.match(script, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(script, /165_manual_delivery_return_receipts/);
  assert.match(script, /143_inventory_adjustment_reconciliation_batch/);
  assert.match(script, /RUNTIME_PRIVILEGES=PASS/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS inventory_adjustment_lines_system_quantity_snapshot_ck/);
  assert.doesNotMatch(sql, /UPDATE\s+inventory\.|DELETE\s+FROM\s+inventory\./i);
});
