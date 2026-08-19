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

test('bulk input treats actual stock as final quantity and accepts zero', () => {
  const result = inventoryAdjustmentBulkInternals.normalizeBulkRows({ warehouseId, rows: [row()] });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].actualQuantity, '0');
  assert.equal(result.rows[0].actualScaled6, 0n);
});

test('bulk input flags duplicate SKU scope before preview', () => {
  const result = inventoryAdjustmentBulkInternals.normalizeBulkRows({
    warehouseId,
    rows: [row({ actualQuantity: '3' }), row({ actualQuantity: '4' })],
  });
  assert.equal(result.ok, true);
  assert.ok(result.rows.every((item) => item.errors.some((error) => error.code === 'DUPLICATE_ROW')));
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

test('bulk preview is read-only and confirm reuses canonical adjustment creation', () => {
  assert.match(routeSource, /bulk-preview/);
  assert.match(routeSource, /bulk-confirm/);
  assert.match(routeSource, /executeRequestWithIdempotency/);
  assert.match(routeSource, /expectedAuditCount/);
  assert.match(routeSource, /expectedOutboxCount/);
  assert.match(bulkSource, /currentScopeVersions/);
  assert.match(bulkSource, /lock:\s*true/);
  assert.match(bulkSource, /createAdjustment/);
  assert.match(bulkSource, /DUPLICATE_STOCK_SCOPE/);
  assert.doesNotMatch(bulkSource, /UPDATE\s+inventory\.inventory_balances/i);
  assert.doesNotMatch(bulkSource, /INSERT\s+INTO\s+inventory\.inventory_balances/i);
});