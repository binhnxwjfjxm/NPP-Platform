import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/core-latest-production-gate.sh', import.meta.url);

test('latest Core production gate protects migrations 042 through 052', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  for (const id of [
    '042_sales_fulfillment_reservation_demand',
    '043_sales_fulfillment_allocation_pick_pack',
    '044_sales_delivery_order_handover',
    '045_sales_inventory_issue_customer_return',
    '046_logistics_trip_planning',
    '047_logistics_trip_dispatch',
    '048_logistics_driver_delivery_read',
    '049_logistics_delivery_attempts',
    '050_logistics_delivery_attempt_outbox_schedule',
    '051_logistics_trip_reconciliation',
    '052_logistics_optional_proof_of_delivery',
  ]) {
    assert.match(source, new RegExp(id));
  }
  for (const marker of [
    'assert_allowed_pending',
    'assert_phase6e_schema',
    'pg:backups:capture',
    'pg_dump',
    'pg_restore',
    'restore_verify',
    'maintenance:on',
    'maintenance:off',
    'production_verify',
    'assert_counts_unchanged',
    '/health/live',
    '/health/ready',
    'logistics.delivery_attempts',
    'logistics.delivery_attempt_lines',
    'logistics.trip_return_receipts',
    'logistics.delivery_attempt_proofs',
    'core.delivery-attempt.record',
    'core.delivery-trip.reconciliation-read',
    'core.pod.attach',
    'sales.sales_order_lines=',
    'inventory.inventory_movements=',
  ]) {
    assert.ok(source.includes(marker), `missing ${marker}`);
  }
  assert.match(source, /test "\$HEROKU_APP_NAME" = "hung-phat"/);
  assert.match(source, /pending\.every/);
  assert.match(source, /CORE_PHASE_6E_SCHEMA=ready/);
});
