import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/core-latest-production-gate.sh', import.meta.url);

test('latest Core production gate protects migrations 042 through 062', async () => {
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
    '053_customer_receivable_ledger',
    '054_customer_payment_allocation',
    '055_customer_return_credit_refund',
    '056_cod_collection_handover',
    '057_phase6f_reconciliation_views',
    '058_inventory_transfer_in_transit_foundation',
    '059_inventory_transfer_receipt_resolution',
    '060_inventory_stocktake',
    '061_inventory_adjustments',
    '062_inventory_costing_foundation',
  ]) {
    assert.match(source, new RegExp(id));
  }
  for (const marker of [
    'assert_allowed_pending',
    'assert_phase6f_schema',
    'assert_phase7_inventory_schema',
    'phase7inventory',
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
    'accounting.receivable_documents',
    'accounting.receivable_allocations',
    'accounting.customer_return_adjustment_lines',
    'accounting.customer_refunds',
    'accounting.cod_collections',
    'accounting.cod_cash_handovers',
    'accounting.cod_cash_acceptances',
    'reporting.phase6f_closeout_anomalies',
    'core.receivable.read',
    'core.customer-payment.create',
    'core.customer-return-credit.allocate',
    'core.customer-refund.create',
    'core.cod-collection.record',
    'core.cod-reconciliation.accept',
    'inventory.inventory_transfers',
    'inventory.inventory_transfer_receipts',
    'inventory.inventory_scope_versions',
    'inventory.stocktakes',
    'inventory.inventory_adjustments',
    'inventory.inventory_cost_rebuild_runs',
    'inventory.inventory_cost_reconciliation',
    'core.inventory-transfer.receive',
    'core.stocktake.post',
    'core.inventory-adjustment.post',
    'core.inventory-cost.rebuild',
    'CORE_PHASE_7_INVENTORY_SCHEMA=ready',
    'sales.sales_order_version_lines=',
    'inventory.inventory_movements=',
  ]) {
    assert.ok(source.includes(marker), `missing ${marker}`);
  }
  assert.ok(!source.includes('sales.sales_order_lines='));
  assert.match(source, /FROM sales\.sales_order_version_lines/);
  assert.match(source, /test "\$HEROKU_APP_NAME" = "hung-phat"/);
  assert.match(source, /pending\.every/);
  assert.match(source, /migrationIdsInRange\(46, 57\)/);
  assert.match(source, /migrationIdsInRange\(58, 62\)/);
  assert.doesNotMatch(source, /CORE_API_MIGRATIONS\.slice\(-12\)/);
  assert.doesNotMatch(source, /CORE_API_MIGRATIONS\.slice\(-5\)/);
  assert.match(source, /CORE_PHASE_6F_SCHEMA=ready/);
  assert.match(source, /CORE_PHASE_7_INVENTORY_SCHEMA=ready/);
  assert.doesNotMatch(source, /CORE_PHASE_6E_SCHEMA/);
});
