import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { warehouseLocationModeInternals } from '../src/services/warehouse-location-mode.js';

const serviceSource = await readFile(new URL('../src/services/warehouse-location-mode.js', import.meta.url), 'utf8');

function balance({
  locationId = null,
  baseVariantId = '33333333-3333-4333-8333-333333333333',
  lotId = null,
  onHand = '0.000000000000',
  reserved = '0.000000000000',
} = {}) {
  return {
    location_id: locationId,
    base_variant_id: baseVariantId,
    lot_id: lotId,
    on_hand_quantity: onHand,
    reserved_quantity: reserved,
  };
}

test('warehouse mode conversion treats negative and mixed balances as relocation work, not blockers', () => {
  const { modeShape, parse12, transferLegs } = warehouseLocationModeInternals;
  const shape = modeShape([
    balance({
      locationId: '11111111-1111-4111-8111-111111111111',
      onHand: '-5.250000000000',
    }),
    balance({ onHand: '10.000000000000' }),
  ]);

  assert.equal(shape.located.length, 1);
  assert.equal(shape.unlocated.length, 1);
  assert.equal(shape.negative.length, 1);
  assert.deepEqual(transferLegs(parse12('-5.250000000000')), {
    sourceDirection: 'IN',
    sourceBaseQuantityDelta: '5.250000000000',
    destinationDirection: 'OUT',
    destinationBaseQuantityDelta: '-5.250000000000',
    negativeRelocation: true,
  });
  assert.deepEqual(transferLegs(parse12('7.000000000000')), {
    sourceDirection: 'OUT',
    sourceBaseQuantityDelta: '-7.000000000000',
    destinationDirection: 'IN',
    destinationBaseQuantityDelta: '7.000000000000',
    negativeRelocation: false,
  });
});

test('reservation already in the target-compatible scope remains untouched', () => {
  const { reservationPlan } = warehouseLocationModeInternals;
  const baseVariantId = '33333333-3333-4333-8333-333333333333';
  const result = reservationPlan([
    {
      reservation: {
        id: 'reservation-in-common-stock',
        source_domain: 'OTHER',
        source_document_type: 'OTHER',
        source_document_id: 'other-document',
        warehouse_id: '22222222-2222-4222-8222-222222222222',
        location_id: null,
        base_variant_id: baseVariantId,
        lot_id: null,
        quantity: '2.000000000000',
      },
      allocation: null,
    },
  ], [
    balance({
      baseVariantId,
      onHand: '5.000000000000',
      reserved: '2.000000000000',
    }),
  ], 'UNMANAGED', null);

  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.relocations, []);
});

test('negative stock and mixed location shape are not conversion blockers anymore', () => {
  assert.doesNotMatch(serviceSource, /NEGATIVE_STOCK_PRESENT/);
  assert.doesNotMatch(serviceSource, /WAREHOUSE_LOCATION_MODE_UNRESOLVED/);
  assert.doesNotMatch(serviceSource, /WAREHOUSE_LOCATION_DATA_MISMATCH/);
  assert.match(serviceSource, /storedMode === normalizedTargetMode && sourceRows\.length === 0/);
  assert.match(serviceSource, /npp\.warehouse_location_mode_negative_relocation/);
  assert.match(serviceSource, /negativeScopeCount/);
});

test('migration 133 permits only paired canonical negative relocation and preserves Sales guard', () => {
  const migration = CORE_API_MIGRATIONS.find(({ id }) => id === '133_warehouse_location_negative_relocation');
  assert.ok(migration);
  assert.match(migration.sql, /WAREHOUSE_LOCATION_MODE_SERVICE/);
  assert.match(migration.sql, /WAREHOUSE_LOCATION_MODE_RUN/);
  assert.match(migration.sql, /TRANSFER_RECEIPT/);
  assert.match(migration.sql, /TRANSFER_ISSUE/);
  assert.match(migration.sql, /negativeRelocation/);
  assert.match(migration.sql, /source_line\.base_quantity_delta = abs\(NEW\.base_quantity_delta\)/);
  assert.match(migration.sql, /inventory_negative_stock_denied/);
  assert.match(migration.sql, /core\.inventory\.negative-stock\.issue/);
  assert.match(migration.sql, /SALES_DELIVERY_ISSUE/);
});
