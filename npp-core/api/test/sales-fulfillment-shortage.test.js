import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fulfillmentShortageInternals,
} from '../src/services/sales-fulfillment-shortage.js';

const { normalizeShortagePayload, evaluatePickingCloseState } = fulfillmentShortageInternals;

test('Lane C shortage captures picked, observed and reason as separate canonical inputs', () => {
  const value = normalizeShortagePayload({
    actualPickedQuantity: '3',
    observedQuantity: '4',
    reason: 'Tồn thực tế thiếu',
  });
  assert.equal(value.ok, true);
  assert.equal(value.pickedQuantity, '3.000000000000');
  assert.equal(value.observedQuantity, '4.000000000000');
  assert.equal(normalizeShortagePayload({
    actualPickedQuantity: '-1',
    observedQuantity: '0',
    reason: 'x',
  }).ok, false);
});

test('Lane C close state blocks partial close while shortage fact or alternative source is missing', () => {
  const demand = {
    ordered_base_quantity: '10',
    allocated_base_quantity: '10',
    picked_base_quantity: '6',
    backordered_base_quantity: '0',
  };
  const missing = evaluatePickingCloseState([demand], [{ has_shortage: false }], [], null);
  assert.equal(missing.canClosePartial, false);
  assert.equal(missing.reasonCode, 'SHORTAGE_FACT_REQUIRED');

  const alternative = evaluatePickingCloseState([demand], [{ has_shortage: true }], [{
    warehouse_id: '11111111-1111-4111-8111-111111111111',
    location_id: null,
    location_code: null,
    location_name: null,
    base_variant_id: '22222222-2222-4222-8222-222222222222',
    lot_id: null,
    lot_code: null,
    available_quantity: '4',
  }], null);
  assert.equal(alternative.canClosePartial, false);
  assert.equal(alternative.reasonCode, 'ALTERNATIVE_SOURCE_AVAILABLE');

  const ready = evaluatePickingCloseState([demand], [{ has_shortage: true }], [], null);
  assert.equal(ready.canClosePartial, true);
});

test('Lane C full close requires every ordered quantity picked with no backorder', () => {
  const ready = evaluatePickingCloseState([{
    ordered_base_quantity: '10',
    allocated_base_quantity: '10',
    picked_base_quantity: '10',
    backordered_base_quantity: '0',
  }], [], [], null);
  assert.equal(ready.canCloseFull, true);

  const backordered = evaluatePickingCloseState([{
    ordered_base_quantity: '10',
    allocated_base_quantity: '8',
    picked_base_quantity: '8',
    backordered_base_quantity: '2',
  }], [], [], null);
  assert.equal(backordered.canCloseFull, false);
  assert.equal(backordered.canClosePartial, true);
});

test('Lane C persists two independent shortage facts and never auto-adjusts inventory balances', () => {
  const migration = readFileSync(
    new URL('../../../database/migrations/sales/081_sales_fulfillment_shortage_discrepancy.sql', import.meta.url),
    'utf8',
  );
  const repository = readFileSync(
    new URL('../src/db/repositories/sales-fulfillment-shortage.js', import.meta.url),
    'utf8',
  );
  const service = readFileSync(
    new URL('../src/services/sales-fulfillment-shortage.js', import.meta.url),
    'utf8',
  );
  const route = readFileSync(
    new URL('../src/routes/fulfillment-shortages.js', import.meta.url),
    'utf8',
  );
  const registry = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');

  assert.match(migration, /sales_order_fulfillment_shortages/);
  assert.match(migration, /inventory_discrepancy_observations/);
  assert.match(migration, /observed_base_quantity - book_base_quantity/);
  assert.match(migration, /sales_order_fulfillment_pick_closures/);
  assert.match(repository, /balance\.on_hand_quantity/);
  assert.match(repository, /insertShortage/);
  assert.match(repository, /insertDiscrepancyObservation/);
  assert.match(service, /core\.sales_order\.fulfillment\.shortage_recorded/);
  assert.match(service, /core\.sales_order\.fulfillment\.pick_closed/);
  assert.doesNotMatch(service, /UPDATE\s+inventory\.inventory_balances/i);
  assert.doesNotMatch(repository, /UPDATE\s+inventory\.inventory_balances/i);
  assert.match(route, /fulfillment-allocations.*shortage/s);
  assert.match(route, /picking-close-state/);
  assert.match(route, /picking-close/);
  assert.match(registry, /081_sales_fulfillment_shortage_discrepancy/);
});
