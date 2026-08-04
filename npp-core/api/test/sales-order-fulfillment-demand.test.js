import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { salesFulfillmentInternals } from '../src/services/sales-fulfillment.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

function line(lineNumber, quantity) {
  return Object.freeze({
    lineNumber,
    ordered: salesFulfillmentInternals.parseQuantity(quantity),
  });
}

test('warehouse demand reserves deterministically and reports the remainder as backorder', () => {
  const allocated = salesFulfillmentInternals.allocateWarehouseDemand(
    [line(1, '6'), line(2, '6')],
    salesFulfillmentInternals.parseQuantity('8'),
    true,
  );

  assert.equal(allocated.ok, true);
  assert.equal(
    salesFulfillmentInternals.formatQuantity(allocated.allocations[0].reserved),
    '6.000000000000',
  );
  assert.equal(
    salesFulfillmentInternals.formatQuantity(allocated.allocations[0].backordered),
    '0.000000000000',
  );
  assert.equal(
    salesFulfillmentInternals.formatQuantity(allocated.allocations[1].reserved),
    '2.000000000000',
  );
  assert.equal(
    salesFulfillmentInternals.formatQuantity(allocated.allocations[1].backordered),
    '4.000000000000',
  );
  assert.equal(
    salesFulfillmentInternals.fulfillmentStatus({
      reserved: salesFulfillmentInternals.parseQuantity('8'),
      backordered: salesFulfillmentInternals.parseQuantity('4'),
    }),
    'partially_reserved',
  );
});

test('backorder-disabled confirmation fails before any partial allocation is accepted', () => {
  const allocated = salesFulfillmentInternals.allocateWarehouseDemand(
    [line(1, '6'), line(2, '6')],
    salesFulfillmentInternals.parseQuantity('8'),
    false,
  );

  assert.equal(allocated.ok, false);
  assert.equal(allocated.code, 'SALES_ORDER_INSUFFICIENT_STOCK');
  assert.deepEqual(allocated.details, {
    requiredBaseQuantity: '12.000000000000',
    availableBaseQuantity: '8.000000000000',
  });
});

test('full and zero reservation states are explicit', () => {
  assert.equal(
    salesFulfillmentInternals.fulfillmentStatus({
      reserved: salesFulfillmentInternals.parseQuantity('5'),
      backordered: 0n,
    }),
    'reserved',
  );
  assert.equal(
    salesFulfillmentInternals.fulfillmentStatus({
      reserved: 0n,
      backordered: salesFulfillmentInternals.parseQuantity('5'),
    }),
    'backordered',
  );
});

test('migration 042 owns warehouse demand without stealing lot allocation from Phase 6D.2', async () => {
  const migration = await read('../../../database/migrations/sales/042_sales_fulfillment_reservation_demand.sql');

  assert.match(migration, /ADD COLUMN IF NOT EXISTS allow_backorder boolean NOT NULL DEFAULT true/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sales\.sales_order_fulfillment_demands/);
  assert.match(migration, /ordered_base_quantity = reserved_base_quantity \+ backordered_base_quantity/);
  assert.match(migration, /'backordered', 'partially_reserved', 'reserved'/);
  assert.match(migration, /sales-fulfillment-scope/);
  assert.match(migration, /inventory_reservations_sales_demand_guard/);
  assert.match(migration, /inventory_sales_fulfillment_reservation_denied/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS logistics\./);
  assert.doesNotMatch(migration, /delivery_trip|driver_id|vehicle_id|proof_of_delivery/i);
});

test('confirmation, amendment replacement and cancellation stay in the Sales Order transaction', async () => {
  const [service, fulfillmentRepository, reservationRepository, migrations] = await Promise.all([
    read('../src/services/sales-order.js'),
    read('../src/db/repositories/sales-fulfillment.js'),
    read('../src/db/repositories/inventory-reservations.js'),
    read('../src/migrations/index.js'),
  ]);

  const confirmPosition = service.indexOf('await legacy.confirmSalesOrder');
  const demandPosition = service.indexOf('await fulfillmentService.replaceSalesOrderFulfillmentDemand');
  assert.ok(confirmPosition >= 0);
  assert.ok(demandPosition > confirmPosition);
  assert.match(service, /if \(!fulfillment\.ok\) return fulfillment/);
  assert.match(service, /cancelSalesOrderFulfillmentDemand/);
  assert.match(service, /loadSalesOrderFulfillment/);

  assert.match(fulfillmentRepository, /demand\.sales_order_id <> \$4/);
  assert.match(fulfillmentRepository, /reserved_base_quantity - demand\.allocated_base_quantity/);
  assert.match(fulfillmentRepository, /allowBackorder: result\.rows\[0\]\?\.allow_backorder !== false/);
  assert.match(fulfillmentRepository, /sales-fulfillment-scope/);
  assert.match(reservationRepository, /sales-fulfillment-scope/);
  assert.match(migrations, /042_sales_fulfillment_reservation_demand/);
});
