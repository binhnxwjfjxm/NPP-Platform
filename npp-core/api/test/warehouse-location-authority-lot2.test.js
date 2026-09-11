import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const migration132 = source('../../../database/migrations/sales/132_warehouse_location_authority_allocation.sql');
const migrationIndex = source('../src/migrations/index.js');
const remapRepository = source('../src/db/repositories/warehouse-location-reservation-remap.js');
const directStockIssue = source('../src/services/sales-direct-stock-issue.js');
const adjustment = source('../src/services/inventory-adjustment.js');
const bulkAdjustment = source('../src/services/inventory-adjustment-bulk.js');
const openingBalanceOperator = source('../src/routes/opening-balance-operator.js');
const goodsReceiptRepository = source('../src/db/repositories/goods-receipt.js');
const goodsReceiptTrackingRepository = source('../src/db/repositories/goods-receipt-tracking.js');
const fulfillmentRepository = source('../src/db/repositories/sales-fulfillment-operations.js');
const ledgerCore = source('../src/services/inventory-ledger-core.js');
const salesLedger = source('../src/services/sales-inventory-ledger.js');
const transferReceiptRepository = source('../src/db/repositories/inventory-transfer-receipt.js');

test('migration 132 keeps warehouse as location authority and remaps pre-execution allocations safely', () => {
  assert.match(migrationIndex, /132_warehouse_location_authority_allocation/);
  assert.match(migration132, /warehouse\.location_management_mode/);
  assert.match(migration132, /npp\.warehouse_location_mode_remap/);
  assert.match(migration132, /warehouseLocationModeRunId/);
  assert.match(migration132, /relocatedFromReservationId/);
  assert.match(migration132, /relocatedFromAllocationId/);
  assert.match(migration132, /allocation\.state <> 'RELEASED'/);
  assert.match(migration132, /allocation_context = 'fulfillment_release_service'/);
  assert.match(migration132, /RETURN NEW;/);
  assert.match(migration132, /DEPRECATED for runtime location decisions/);
  assert.doesNotMatch(migration132, /policy_record\.location_required/);
});

test('reservation remap establishes one transaction-scoped run context before release/replacement events', () => {
  assert.match(remapRepository, /setWarehouseLocationModeRemapContext/);
  assert.match(remapRepository, /npp\.warehouse_location_mode_remap/);
  assert.match(remapRepository, /warehouseLocationModeRunId/);
  assert.match(remapRepository, /fulfillment_release_service/);
  assert.match(remapRepository, /relocatedFromReservationId|metadata/);
});

test('direct sales stock issue uses warehouse mode for candidate scope and negative-stock eligibility', () => {
  assert.match(directStockIssue, /warehouse\.location_management_mode/);
  assert.match(directStockIssue, /warehouse\.location_management_mode = 'UNMANAGED'/);
  assert.match(directStockIssue, /warehouse\.location_management_mode = 'MANAGED'/);
  assert.match(directStockIssue, /\(warehouse\.location_management_mode = 'MANAGED'\) AS location_required/);
  assert.doesNotMatch(directStockIssue, /policy\.location_required/);
});

test('inventory adjustment validates location by warehouse and uses shared canonical idempotency contract', () => {
  assert.match(adjustment, /createIdempotencyKey, IDEMPOTENCY_KEY_PATTERN/);
  assert.match(adjustment, /warehouse-location-mode\.js/);
  assert.match(adjustment, /WAREHOUSE_LOCATION_MODE_REQUIRED/);
  assert.match(adjustment, /LOCATION_NOT_ALLOWED/);
  assert.match(adjustment, /INVENTORY_ADJUSTMENT_LOCATION_MODE_CHANGED/);
  assert.doesNotMatch(adjustment, /A-Za-z0-9\._:-/);
  assert.doesNotMatch(adjustment, /const candidate = `\$\{parentKey\}:\$\{suffix\}`/);
});

test('bulk adjustment never auto-selects a warehouse location and supports common stock for unmanaged warehouses', () => {
  assert.match(bulkAdjustment, /warehouse\.location_management_mode/);
  assert.match(bulkAdjustment, /locationRequired = warehouse\.location_management_mode === 'MANAGED'/);
  assert.match(bulkAdjustment, /locationAutoFilled: false/);
  assert.match(bulkAdjustment, /location_id: null/);
  assert.match(bulkAdjustment, /LOCATION_NOT_ALLOWED/);
  assert.doesNotMatch(bulkAdjustment, /locationCodes\.length === 1/);
});

test('opening balance operator hides location for common-stock warehouses and requires explicit storage location for managed warehouses', () => {
  assert.match(openingBalanceOperator, /locationManagementMode/);
  assert.match(openingBalanceOperator, /warehouse\.location_management_mode === 'MANAGED'/);
  assert.match(openingBalanceOperator, /warehouse\.location_management_mode === 'UNMANAGED'/);
  assert.match(openingBalanceOperator, /location_type = 'storage'/);
  assert.match(openingBalanceOperator, /locations: Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(openingBalanceOperator, /policy\.location_required/);
  assert.doesNotMatch(openingBalanceOperator, /variant\.location_required/);
});

test('goods receipt read/tracking compatibility field is derived from warehouse mode, not SKU policy', () => {
  assert.match(goodsReceiptRepository, /tracking_warehouse\.location_management_mode/);
  assert.match(goodsReceiptRepository, /\(tracking_warehouse\.location_management_mode = 'MANAGED'\) AS location_required/);
  assert.doesNotMatch(goodsReceiptRepository, /tracking_policy\.location_required/);
  assert.match(goodsReceiptTrackingRepository, /warehouse\.location_management_mode/);
  assert.match(goodsReceiptTrackingRepository, /\(warehouse\.location_management_mode = 'MANAGED'\) AS location_required/);
  assert.doesNotMatch(goodsReceiptTrackingRepository, /policy\.location_required/);
});

test('central ledger, sales fulfillment and transfer receipt all use warehouse authority', () => {
  assert.match(ledgerCore, /location_management_mode/);
  assert.doesNotMatch(ledgerCore, /policy\.location_required/);
  assert.match(salesLedger, /location_management_mode/);
  assert.doesNotMatch(salesLedger, /policy\.location_required/);
  assert.match(fulfillmentRepository, /warehouse\.location_management_mode/);
  assert.doesNotMatch(fulfillmentRepository, /policy\.location_required/);
  assert.match(transferReceiptRepository, /location_management_mode/);
  assert.doesNotMatch(transferReceiptRepository, /policy\.location_required/);
});
