import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { salesFulfillmentInternals } from '../src/services/sales-fulfillment.js';
import { inboundScopesFromMovementLines } from '../src/services/sales-fulfillment-replenishment.js';

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

test('fulfillment quantities require the dedicated read permission', () => {
  assert.equal(
    salesFulfillmentInternals.canReadFulfillment({ permissions: ['core.sales-order.read'] }),
    false,
  );
  assert.equal(
    salesFulfillmentInternals.canReadFulfillment({
      permissions: ['core.sales-order.read', 'core.fulfillment.read'],
    }),
    true,
  );
});

test('migration 042 owns warehouse demand without stealing lot allocation from Phase 6D.2', async () => {
  const migration = await read('../../database/migrations/sales/042_sales_fulfillment_reservation_demand.sql');

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
  const [service, fulfillmentService, fulfillmentRepository, reservationRepository, migrations] = await Promise.all([
    read('src/services/sales-order.js'),
    read('src/services/sales-fulfillment.js'),
    read('src/db/repositories/sales-fulfillment.js'),
    read('src/db/repositories/inventory-reservations.js'),
    read('src/migrations/index.js'),
  ]);

  const confirmPosition = service.indexOf('await legacy.confirmSalesOrder');
  const demandPosition = service.indexOf('await fulfillmentService.replaceSalesOrderFulfillmentDemand');
  assert.ok(confirmPosition >= 0);
  assert.ok(demandPosition > confirmPosition);
  assert.match(service, /if \(!fulfillment\.ok\) return fulfillment/);
  assert.match(service, /cancelSalesOrderFulfillmentDemand/);
  assert.match(service, /loadSalesOrderFulfillment/);
  assert.match(fulfillmentService, /permissions\.includes\('core\.fulfillment\.read'\)/);

  assert.match(fulfillmentRepository, /demand\.sales_order_id <> \$4/);
  assert.match(fulfillmentRepository, /reserved_base_quantity - demand\.allocated_base_quantity/);
  assert.match(fulfillmentRepository, /allowBackorder: result\.rows\[0\]\?\.allow_backorder !== false/);
  assert.match(fulfillmentRepository, /sales-fulfillment-scope/);
  assert.doesNotMatch(fulfillmentRepository, /revision = revision \+ 1/);
  assert.match(reservationRepository, /sales-fulfillment-scope/);
  assert.match(migrations, /042_sales_fulfillment_reservation_demand/);
});

test('posted inbound deduplicates warehouse/SKU scopes and never treats outbound as replenishment', () => {
  const incoming = inboundScopesFromMovementLines([
    { direction: 'IN', warehouse_id: 'warehouse-b', base_variant_id: 'sku-2', base_quantity_delta: '5.000000000000' },
    { direction: 'IN', warehouseId: 'warehouse-b', baseVariantId: 'sku-2', baseQuantityDelta: '1' },
    { direction: 'OUT', warehouseId: 'warehouse-a', baseVariantId: 'sku-1', baseQuantityDelta: '-7' },
    { direction: 'IN', warehouseId: 'warehouse-a', baseVariantId: 'sku-1', baseQuantityDelta: '3' },
  ]);
  assert.deepEqual(incoming, [
    { warehouseId: 'warehouse-a', baseVariantId: 'sku-1' },
    { warehouseId: 'warehouse-b', baseVariantId: 'sku-2' },
  ]);
});

test('every inbound posting path and new order confirmation reuse the same queue', async () => {
  const sources = await Promise.all([
    read('src/services/sales-fulfillment.js'),
    read('src/services/inventory-ledger-core.js'),
    read('src/services/sales-inventory-ledger.js'),
    read('src/services/inventory-transfer-receipt.js'),
    read('src/services/inventory-stocktake.js'),
    read('src/services/inventory-adjustment.js'),
    read('src/services/sales-fulfillment-replenishment.js'),
  ]);
  assert.match(sources[0], /await replenishPendingHoldScopes\(client/);
  for (const source of sources.slice(1, 6)) {
    assert.match(source, /await replenishAfterPostedMovement\(client/);
  }
  assert.match(sources[6], /orders\.confirmed_at ASC NULLS LAST/);
  assert.match(sources[6], /demand\.backordered_base_quantity > 0/);
  assert.match(sources[6], /reconcileDemandHold\(client/);
  assert.match(sources[6], /orders\.status = 'confirmed'/);
});

test('concurrent stock replenishment shares one warehouse/SKU lock order with confirmation and cancellation', async () => {
  const [hold, queue, sale, fulfillment, operation, inbound, salesLedger, transfer, adjust, stocktake] = await Promise.all([
    read('src/services/sales-fulfillment-hold.js'),
    read('src/services/sales-fulfillment-replenishment.js'),
    read('src/services/sales-order.js'),
    read('src/services/sales-fulfillment.js'),
    read('src/services/sales-fulfillment-operations.js'),
    read('src/services/inventory-ledger-core.js'),
    read('src/services/sales-inventory-ledger.js'),
    read('src/services/inventory-transfer-receipt.js'),
    read('src/services/inventory-adjustment.js'),
    read('src/services/inventory-stocktake.js'),
  ]);
  assert.ok(hold.indexOf('const scopeResult') < hold.indexOf("FOR UPDATE OF demand"));
  assert.match(queue, /lockOrderStockScopes/);
  assert.match(queue, /lockPostedStockScopes/);
  assert.match(queue, /version\.version_number = \$3/);
  assert.match(sale, /await lockOrderStockScopes\(client/);
  assert.ok(fulfillment.indexOf('await lockOrderStockScopes') < fulfillment.indexOf('await lockActiveSalesOrderDemands'));
  assert.ok(operation.indexOf('const scopeResult = await client.query(') < operation.indexOf('const demand = await repository.getActiveDemandForUpdate'));
  for (const source of [inbound, salesLedger, transfer, adjust, stocktake]) {
    assert.match(source, /await lockPostedStockScopes\(client/);
  }
});
