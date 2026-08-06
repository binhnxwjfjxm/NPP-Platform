import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inventoryAdjustmentInternals } from '../src/services/inventory-adjustment.js';

const migration = readFileSync(
  new URL('../../../database/migrations/inventory/061_inventory_adjustments.sql', import.meta.url),
  'utf8',
);
const routeSource = readFileSync(new URL('../src/routes/inventory-adjustments.js', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/services/inventory-adjustment.js', import.meta.url), 'utf8');
const allocationSource = readFileSync(
  new URL('../src/db/repositories/sales-fulfillment-operations.js', import.meta.url),
  'utf8',
);
const reservationSource = readFileSync(
  new URL('../src/db/repositories/inventory-reservations.js', import.meta.url),
  'utf8',
);

test('migration 061 owns reason catalog and append-only adjustment history', () => {
  for (const permission of [
    'core.inventory-adjustment.read',
    'core.inventory-adjustment.create',
    'core.inventory-adjustment.submit',
    'core.inventory-adjustment.approve',
    'core.inventory-adjustment.post',
    'core.inventory-adjustment.cancel',
    'core.inventory-adjustment.reverse',
  ]) assert.match(migration, new RegExp(permission.replaceAll('.', '\\.')));

  for (const kind of ['MANUAL_ADJUSTMENT', 'QUARANTINE_TRANSFER', 'DAMAGED_TRANSFER', 'SCRAP']) {
    assert.match(migration, new RegExp(kind));
  }
  assert.match(migration, /inventory_adjustment_reasons/);
  assert.match(migration, /inventory_adjustment_line_history_is_append_only/);
  assert.match(migration, /inventory_adjustment_posted_scope_is_append_only/);
  assert.match(migration, /inventory_scope_versions/);
  assert.doesNotMatch(migration, /UPDATE\s+inventory\.inventory_balances/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+inventory\.inventory_balances/i);
});

test('manual adjustment accepts unsigned quantity and rejects client signed delta', () => {
  const base = {
    warehouseId: '11111111-1111-4111-8111-111111111111',
    documentKind: 'MANUAL_ADJUSTMENT',
    adjustmentDirection: 'OUT',
    reasonCode: 'MANUAL_COUNT_CORRECTION_OUT',
    reasonNote: 'Hao hụt đã xác minh',
    lines: [{
      sourceLocationId: '22222222-2222-4222-8222-222222222222',
      sourceVariantId: '33333333-3333-4333-8333-333333333333',
      quantity: '2.500000',
    }],
  };
  const valid = inventoryAdjustmentInternals.normalizeCreatePayload(base);
  assert.equal(valid.ok, true);
  assert.equal(valid.value.lines[0].source_quantity, '2.500000');

  const signed = inventoryAdjustmentInternals.normalizeCreatePayload({ ...base, signedDelta: '-2.5' });
  assert.equal(signed.ok, false);
  assert.equal(signed.code, 'SIGNED_DELTA_NOT_ALLOWED');

  const negative = inventoryAdjustmentInternals.normalizeCreatePayload({
    ...base,
    lines: [{ ...base.lines[0], quantity: '-2.5' }],
  });
  assert.equal(negative.ok, false);
  assert.equal(negative.code, 'INVALID_QUANTITY');
});

test('paired dispositions and scrap directions are server owned', () => {
  const line = { source_location_id: 'source', destination_location_id: 'destination' };
  assert.equal(inventoryAdjustmentInternals.movementTypeFor({
    document_kind: 'MANUAL_ADJUSTMENT', adjustment_direction: 'IN',
  }), 'MANUAL_ADJUSTMENT_IN');
  assert.equal(inventoryAdjustmentInternals.movementTypeFor({
    document_kind: 'MANUAL_ADJUSTMENT', adjustment_direction: 'OUT',
  }), 'MANUAL_ADJUSTMENT_OUT');
  assert.equal(inventoryAdjustmentInternals.movementTypeFor({ document_kind: 'SCRAP' }), 'SCRAP');
  assert.equal(inventoryAdjustmentInternals.scopeRows([{
    id: 'line', source_location_id: line.source_location_id,
    destination_location_id: line.destination_location_id,
    base_variant_id: 'variant', lot_id: null,
    source_snapshot_scope_version: 1,
    destination_snapshot_scope_version: 0,
  }]).length, 2);
});

test('child idempotency keys stay safe and collision resistant at the 128-character boundary', () => {
  const key = 'A'.repeat(128);
  const movement = inventoryAdjustmentInternals.childIdempotencyKey(key, 'movement');
  const reversal = inventoryAdjustmentInternals.childIdempotencyKey(key, 'reversal');
  assert.ok(movement.length <= 128);
  assert.ok(reversal.length <= 128);
  assert.notEqual(movement, reversal);
});

test('API enforces permissions, idempotency, warehouse scope, audit and outbox', () => {
  assert.match(routeSource, /executeRequestWithIdempotency/);
  assert.match(routeSource, /withAuditOutboxTransaction/);
  assert.match(routeSource, /insertAuditRecord/);
  assert.match(routeSource, /insertOutboxEvent/);
  assert.match(routeSource, /WAREHOUSE_SCOPE_DENIED/);
  assert.match(routeSource, /submit\|approve\|post\|cancel\|reverse/);
  assert.match(serviceSource, /INVENTORY_ADJUSTMENT_SELF_APPROVAL_DENIED/);
  assert.match(serviceSource, /INVENTORY_ADJUSTMENT_SCOPE_CHANGED/);
  assert.match(serviceSource, /INVENTORY_ADJUSTMENT_REVERSAL_DOWNSTREAM_CONFLICT/);
  assert.match(serviceSource, /reversalOfMovementId: adjustment\.inventory_movement_id/);
});

test('allocation remains fail closed for quarantine and damaged locations', () => {
  assert.match(allocationSource, /location\.is_active = true/);
  assert.match(allocationSource, /location\.location_type = 'storage'/);
  assert.match(reservationSource, /l\.location_type = 'storage'/);
  assert.doesNotMatch(allocationSource, /location_type\s+IN\s*\([^)]*quarantine/i);
  assert.doesNotMatch(allocationSource, /location_type\s+IN\s*\([^)]*damaged/i);
});
