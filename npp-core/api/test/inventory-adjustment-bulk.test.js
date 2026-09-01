import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inventoryAdjustmentBulkInternals } from '../src/services/inventory-adjustment-bulk.js';

const routeSource = readFileSync(new URL('../src/routes/inventory-adjustments.js', import.meta.url), 'utf8');
const bulkSource = readFileSync(new URL('../src/services/inventory-adjustment-bulk.js', import.meta.url), 'utf8');

const warehouseId = '11111111-1111-4111-8111-111111111111';

function row(overrides = {}) {
  return {
    sku: 'SKU001',
    actualQuantity: '0',
    locationCode: 'A01',
    lotCode: '',
    ...overrides,
  };
}

function balance({ locationCode = 'A01', locationName = 'Kệ A', lotCode = null, onHandQuantity = '10.000000000000' } = {}) {
  return {
    base_variant_id: 'base-variant',
    location_id: `${locationCode}-id`,
    location_code: locationCode,
    location_name: locationName,
    lot_id: lotCode ? `${lotCode}-id` : null,
    lot_code: lotCode,
    on_hand_quantity: onHandQuantity,
  };
}

test('bulk input treats actual stock as final quantity and accepts zero', () => {
  const result = inventoryAdjustmentBulkInternals.normalizeBulkRows({ warehouseId, rows: [row()] });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].actualQuantity, '0');
  assert.equal(result.rows[0].actualScaled6, 0n);
  assert.equal(result.rows[0].lotCode, null);
});

test('bulk input flags duplicate SKU scope before preview', () => {
  const result = inventoryAdjustmentBulkInternals.normalizeBulkRows({
    warehouseId,
    rows: [row({ actualQuantity: '3' }), row({ actualQuantity: '4' })],
  });
  assert.equal(result.ok, true);
  assert.ok(result.rows.every((item) => item.errors.some((error) => error.code === 'DUPLICATE_ROW')));
});

test('bulk scope auto-fills the sole valid required lot instead of asking for a file column', () => {
  const input = { ...row({ actualQuantity: '8', locationCode: null, lotCode: null }), actualScaled6: 8n };
  const source = { lot_tracking_mode: 'REQUIRED' };
  const resolved = inventoryAdjustmentBulkInternals.resolveScopeSelection(input, source, [
    balance({ locationCode: 'A01', lotCode: 'LO-001' }),
  ]);
  assert.equal(resolved.lotCode, 'LO-001');
  assert.equal(resolved.locationCode, 'A01');
  assert.equal(resolved.lotAutoFilled, true);
  assert.equal(resolved.locationAutoFilled, true);
  assert.equal(resolved.requiresLotSelection, false);
  assert.equal(resolved.requiresLocationSelection, false);
});

test('bulk scope requires a user lot choice when tracking policy has multiple valid lots', () => {
  const input = { ...row({ actualQuantity: '8', locationCode: null, lotCode: null }), actualScaled6: 8n };
  const source = { lot_tracking_mode: 'REQUIRED' };
  const resolved = inventoryAdjustmentBulkInternals.resolveScopeSelection(input, source, [
    balance({ locationCode: 'A01', lotCode: 'LO-001' }),
    balance({ locationCode: 'A01', lotCode: 'LO-002' }),
  ]);
  assert.equal(resolved.locationCode, 'A01');
  assert.equal(resolved.locationAutoFilled, true);
  assert.equal(resolved.lotCode, null);
  assert.equal(resolved.requiresLotSelection, true);
  assert.equal(resolved.requiresLocationSelection, false);
  assert.deepEqual(resolved.scopeOptions.map((item) => item.lotCode), ['LO-001', 'LO-002']);
});

test('bulk scope requires location only when exact scope is still ambiguous', () => {
  const input = { ...row({ actualQuantity: '8', locationCode: null, lotCode: null }), actualScaled6: 8n };
  const requiredLot = inventoryAdjustmentBulkInternals.resolveScopeSelection(input, { lot_tracking_mode: 'REQUIRED' }, [
    balance({ locationCode: 'A01', lotCode: 'LO-001' }),
    balance({ locationCode: 'B01', lotCode: 'LO-001' }),
  ]);
  assert.equal(requiredLot.lotCode, 'LO-001');
  assert.equal(requiredLot.lotAutoFilled, true);
  assert.equal(requiredLot.locationCode, null);
  assert.equal(requiredLot.requiresLocationSelection, true);

  const noLotTracking = inventoryAdjustmentBulkInternals.resolveScopeSelection(input, { lot_tracking_mode: 'NONE' }, [
    balance({ locationCode: 'A01', lotCode: null }),
  ]);
  assert.equal(noLotTracking.lotRequired, false);
  assert.equal(noLotTracking.requiresLotSelection, false);
  assert.equal(noLotTracking.locationCode, 'A01');
  assert.equal(noLotTracking.requiresLocationSelection, false);
});

test('bulk scope uses active warehouse locations even when a SKU has no balance there yet', () => {
  const input = { ...row({ actualQuantity: '8', locationCode: null, lotCode: null }), actualScaled6: 8n };
  const source = { lot_tracking_mode: 'NONE' };

  const soleLocation = inventoryAdjustmentBulkInternals.resolveScopeSelection(input, source, [
    balance({ locationCode: 'A01', onHandQuantity: '0.000000000000' }),
  ]);
  assert.equal(soleLocation.locationCode, 'A01');
  assert.equal(soleLocation.locationAutoFilled, true);
  assert.equal(soleLocation.requiresLocationSelection, false);

  const multipleLocations = inventoryAdjustmentBulkInternals.resolveScopeSelection(input, source, [
    balance({ locationCode: 'A01', onHandQuantity: '10.000000000000' }),
    balance({ locationCode: 'B01', locationName: 'Kệ B', onHandQuantity: '0.000000000000' }),
  ]);
  assert.equal(multipleLocations.locationCode, null);
  assert.equal(multipleLocations.locationAutoFilled, false);
  assert.equal(multipleLocations.requiresLocationSelection, true);
  assert.deepEqual(multipleLocations.scopeOptions.map((item) => item.locationCode), ['A01', 'B01']);
});

test('bulk delta uses exact conversion and falls back to base unit for break-pack differences', () => {
  const source = {
    source_variant_id: 'sales-variant',
    base_variant_id: 'base-variant',
    source_unit_code: 'THUNG',
    base_unit_code: 'CHAI',
    conversion_to_base: '12.000000',
  };
  const fullCase = inventoryAdjustmentBulkInternals.canonicalQuantityForDelta(12n * 1_000_000_000_000n, source);
  assert.deepEqual(fullCase, { sourceVariantId: 'sales-variant', quantity: '1', unitCode: 'THUNG' });

  const twoPieces = inventoryAdjustmentBulkInternals.canonicalQuantityForDelta(2n * 1_000_000_000_000n, source);
  assert.deepEqual(twoPieces, { sourceVariantId: 'base-variant', quantity: '2', unitCode: 'CHAI' });
});

test('bulk preview seeds every active warehouse location and confirm reuses canonical adjustment creation', () => {
  assert.match(routeSource, /bulk-preview/);
  assert.match(routeSource, /bulk-confirm/);
  assert.match(routeSource, /executeRequestWithIdempotency/);
  assert.match(routeSource, /expectedAuditCount/);
  assert.match(routeSource, /expectedOutboxCount/);
  assert.match(bulkSource, /currentScopeVersions/);
  assert.match(bulkSource, /lock:\s*true/);
  assert.match(bulkSource, /createAdjustment/);
  assert.match(bulkSource, /WITH requested AS \([\s\S]*?unnest\(\$3::uuid\[\]\) AS base_variant_id[\s\S]*?JOIN shared\.warehouse_locations location[\s\S]*?location\.is_active = true[\s\S]*?LEFT JOIN inventory\.inventory_balances balance/);
  assert.match(bulkSource, /LOT_SELECTION_REQUIRED/);
  assert.match(bulkSource, /LOCATION_SELECTION_REQUIRED/);
  assert.doesNotMatch(bulkSource, /Hãy bổ sung cột Lô/);
  assert.match(bulkSource, /DUPLICATE_STOCK_SCOPE/);
  assert.doesNotMatch(bulkSource, /UPDATE\s+inventory\.inventory_balances/i);
  assert.doesNotMatch(bulkSource, /INSERT\s+INTO\s+inventory\.inventory_balances/i);
});