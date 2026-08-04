import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deliveryOrderInternals } from '../src/services/sales-delivery-orders.js';
import { handleDeliveryOrderRoutes } from '../src/routes/delivery-orders.js';

const { parseQuantity, formatQuantity, payloadHash } = deliveryOrderInternals;

test('Delivery Order route module is loadable', () => {
  assert.equal(typeof handleDeliveryOrderRoutes, 'function');
});

test('Delivery Order quantity helpers preserve twelve-decimal quantities', () => {
  assert.equal(parseQuantity('9.123456789012'), 9123456789012n);
  assert.equal(formatQuantity(9123456789012n), '9.123456789012');
  assert.equal(parseQuantity('0.000000000001'), 1n);
  assert.equal(parseQuantity('1.0000000000001'), null);
  assert.equal(parseQuantity('-1'), null);
});

test('Delivery Order payload hashing is key-order stable', () => {
  assert.equal(
    payloadHash({ lines: [{ quantity: '1', id: 'a' }], note: null }),
    payloadHash({ note: null, lines: [{ id: 'a', quantity: '1' }] }),
  );
});

test('Phase 6D.3 migration locks packed claims, lineage and lifecycle', () => {
  const migration = readFileSync(
    new URL('../../../database/migrations/sales/044_sales_delivery_order_handover.sql', import.meta.url),
    'utf8',
  );
  const registry = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
  const repository = readFileSync(
    new URL('../src/db/repositories/sales-delivery-orders.js', import.meta.url),
    'utf8',
  );
  const service = readFileSync(
    new URL('../src/services/sales-delivery-orders.js', import.meta.url),
    'utf8',
  );
  const routes = readFileSync(new URL('../src/routes/delivery-orders.js', import.meta.url), 'utf8');
  const inventoryRoutes = readFileSync(new URL('../src/routes/inventory.js', import.meta.url), 'utf8');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS sales\.delivery_orders/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sales\.delivery_order_lines/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sales\.delivery_order_events/);
  assert.match(migration, /DRAFT|draft/);
  assert.match(migration, /ready_to_dispatch/);
  assert.match(migration, /delivery_order_quantity_exceeds_unclaimed_packed/);
  assert.match(migration, /packed_base_quantity_snapshot/);
  assert.match(migration, /inventory_reservation_id/);
  assert.match(migration, /delivery_order_lines_are_immutable/);
  assert.match(migration, /core\.delivery-order\.read/);
  assert.match(migration, /core\.delivery-order\.create/);
  assert.match(migration, /core\.delivery-order\.confirm/);
  assert.match(migration, /core\.delivery-order\.cancel/);
  assert.match(registry, /044_sales_delivery_order_handover/);
  assert.match(repository, /FOR UPDATE OF allocation/);
  assert.match(repository, /delivery_order\.status IN \('draft', 'ready_to_dispatch'\)/);
  assert.match(repository, /orders\.delivery_mode = 'PICKUP' THEN 'not_required'/);
  assert.match(service, /DELIVERY_ORDER_MIXED_SOURCE_FORBIDDEN/);
  assert.match(service, /warehouseAllowed\(requestContext, replay\.warehouse_id\)|loadDetail/);
  assert.match(service, /core\.sales\.delivery_order\.ready_to_dispatch/);
  assert.match(service, /DOCUMENT_NUMBER_SERIES_UNAVAILABLE/);
  assert.match(routes, /\/api\/delivery-orders\/eligibility/);
  assert.match(routes, /confirm\|cancel/);
  assert.match(routes, /delivery_order_unexpected_error/);
  assert.match(inventoryRoutes, /handleDeliveryOrderRoutes/);
});

test('Phase 6D.3 does not implement dispatch, Inventory OUT, POD or COD', () => {
  const migration = readFileSync(
    new URL('../../../database/migrations/sales/044_sales_delivery_order_handover.sql', import.meta.url),
    'utf8',
  );
  const service = readFileSync(
    new URL('../src/services/sales-delivery-orders.js', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(migration, /inventory_movements|delivery_trips|delivery_attempts|proof_of_delivery/i);
  assert.doesNotMatch(service, /postInventory|createTrip|assignDriver|recordPod|collectCod/i);
});
