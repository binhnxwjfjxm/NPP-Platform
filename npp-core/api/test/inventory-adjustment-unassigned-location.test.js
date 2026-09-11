import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inventoryAdjustmentInternals } from '../src/services/inventory-adjustment.js';
import { inventoryAdjustmentBulkInternals } from '../src/services/inventory-adjustment-bulk.js';

const warehouseId = '11111111-1111-4111-8111-111111111111';
const variantId = '22222222-2222-4222-8222-222222222222';

function scope({ locationId, locationCode, onHand = '0.000000000000' }) {
  return {
    base_variant_id: variantId,
    location_id: locationId,
    location_code: locationCode,
    location_name: locationCode ? `Vị trí ${locationCode}` : null,
    lot_id: null,
    lot_code: null,
    on_hand_quantity: onHand,
  };
}

test('bulk preview separates managed location stock from unmanaged common stock without auto-fill', () => {
  const input = {
    lineNumber: 2,
    sku: 'VAIMOC',
    actualQuantity: '0',
    actualScaled6: 0n,
    locationCode: null,
    lotCode: null,
    errors: [],
  };
  const source = { lot_tracking_mode: 'NONE' };
  const candidates = [
    scope({ locationId: null, locationCode: null, onHand: '27306.000000000000' }),
    scope({
      locationId: '33333333-3333-4333-8333-333333333333',
      locationCode: '001',
      onHand: '25030.000000000000',
    }),
  ];

  const managed = inventoryAdjustmentBulkInternals.resolveScopeSelection(input, source, candidates, 'MANAGED');
  assert.equal(managed.locationCode, null);
  assert.equal(managed.locationAutoFilled, false);
  assert.equal(managed.requiresLocationSelection, true);
  assert.deepEqual(managed.scopeOptions.map((item) => item.locationCode), ['001']);
  assert.equal(managed.candidates.length, 1);
  assert.equal(managed.candidates[0].location_id, '33333333-3333-4333-8333-333333333333');

  const unmanaged = inventoryAdjustmentBulkInternals.resolveScopeSelection(input, source, candidates, 'UNMANAGED');
  assert.equal(unmanaged.locationCode, null);
  assert.equal(unmanaged.locationAutoFilled, false);
  assert.equal(unmanaged.requiresLocationSelection, false);
  assert.deepEqual(unmanaged.scopeOptions.map((item) => item.locationCode), [null]);
  assert.equal(unmanaged.candidates.length, 1);
  assert.equal(unmanaged.candidates[0].location_id, null);
  assert.equal(unmanaged.candidates[0].on_hand_quantity, '27306.000000000000');
});

test('manual adjustment normalization leaves location authority to the selected warehouse mode', () => {
  const basePayload = {
    warehouseId,
    documentKind: 'MANUAL_ADJUSTMENT',
    reasonCode: 'MANUAL_COUNT_CORRECTION_OUT',
    reasonNote: 'Đưa tồn cũ chưa gán vị trí về đúng số thực tế',
    lines: [{ sourceLocationId: null, sourceVariantId: variantId, lotId: null, quantity: '27306' }],
  };

  const decrease = inventoryAdjustmentInternals.normalizeCreatePayload({
    ...basePayload,
    adjustmentDirection: 'OUT',
  });
  assert.equal(decrease.ok, true);
  assert.equal(decrease.value.lines[0].source_location_id, null);

  const increase = inventoryAdjustmentInternals.normalizeCreatePayload({
    ...basePayload,
    adjustmentDirection: 'IN',
    reasonCode: 'MANUAL_COUNT_CORRECTION_IN',
  });
  assert.equal(increase.ok, true);
  assert.equal(increase.value.lines[0].source_location_id, null);

  const serviceSource = readFileSync(new URL('../src/services/inventory-adjustment.js', import.meta.url), 'utf8');
  assert.match(serviceSource, /WAREHOUSE_LOCATION_MODE_REQUIRED/);
  assert.match(serviceSource, /LOCATION_REQUIRED/);
  assert.match(serviceSource, /LOCATION_NOT_ALLOWED/);
});

test('repository and migration keep null-location scope concurrency and lineage exact', () => {
  const repositorySource = readFileSync(new URL('../src/db/repositories/inventory-adjustment.js', import.meta.url), 'utf8');
  const bulkSource = readFileSync(new URL('../src/services/inventory-adjustment-bulk.js', import.meta.url), 'utf8');
  const migrationSource = readFileSync(
    new URL('../../../database/migrations/inventory/128_inventory_adjustment_unassigned_location.sql', import.meta.url),
    'utf8',
  );

  assert.match(bulkSource, /balance\.location_id IS NULL/);
  assert.match(repositorySource, /LEFT JOIN shared\.warehouse_locations source_location/);
  assert.match(repositorySource, /version\.location_id IS NOT DISTINCT FROM requested\.location_id/);
  assert.match(repositorySource, /balance\.location_id IS NOT DISTINCT FROM requested\.location_id/);
  assert.match(migrationSource, /inventory_adjustment_lines\s+ALTER COLUMN source_location_id DROP NOT NULL/);
  assert.match(migrationSource, /inventory_adjustment_posted_scopes\s+ALTER COLUMN location_id DROP NOT NULL/);
  assert.match(migrationSource, /header_direction <> 'OUT'/);
  assert.match(migrationSource, /NEW\.location_id IS DISTINCT FROM line_row\.source_location_id/);
});
