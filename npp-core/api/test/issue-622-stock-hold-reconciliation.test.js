import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('inventory reporting and order availability share the same business hold composition', () => {
  const businessHolds = read('../src/services/inventory-business-holds.js');
  const reporting = read('../src/routes/reporting-inventory-safe.js');
  const orderHold = read('../src/services/sales-fulfillment-hold.js');

  assert.match(businessHolds, /sum\(balance\.reserved_quantity\)/);
  assert.match(businessHolds, /demand\.reserved_base_quantity - demand\.allocated_base_quantity/);
  assert.match(businessHolds, /exact_held_quantity[\s\S]*demand_held_quantity/);
  assert.match(businessHolds, /on_hand_quantity[\s\S]*exact_held_quantity[\s\S]*demand_held_quantity/);

  assert.match(orderHold, /inventory_scope\.exact_reserved \+ other_fulfillment\.warehouse_reserved/);
  assert.match(orderHold, /inventory_scope\.on_hand[\s\S]*inventory_scope\.exact_reserved[\s\S]*other_fulfillment\.warehouse_reserved/);

  assert.match(reporting, /listWarehouseBusinessHoldSummary/);
  assert.match(reporting, /reservedQuantity: hold\.heldBaseQuantity/);
  assert.match(reporting, /availableQuantity: hold\.availableBaseQuantity/);
});

test('held-order breakdown does not double count allocation-backed quantity', () => {
  const source = read('../src/services/inventory-business-holds.js');
  assert.match(source, /reservation\.state = 'ACTIVE'/);
  assert.match(source, /exact_by_demand\.exact_held_quantity/);
  assert.match(source, /demand\.reserved_base_quantity - demand\.allocated_base_quantity/);
  assert.doesNotMatch(source, /demand\.reserved_base_quantity \+ demand\.allocated_base_quantity/);
});

test('held-order breakdown excludes current order from both exact and demand holds', () => {
  const source = read('../src/services/inventory-business-holds.js');
  assert.match(source, /demand\.warehouse_id = \$2/);
  assert.match(source, /demand\.base_variant_id = \$3/);
  assert.match(source, /demand\.sales_order_id <> \$4::uuid/);
  assert.match(source, /demand\.sales_order_id = \$4::uuid/);
  assert.match(source, /inventory_scope\.exact_held_quantity - excluded_exact\.quantity/);
  assert.match(source, /demand\.state = 'ACTIVE'/);
});

test('inventory held-order route is read-only, scoped and permission guarded', () => {
  const route = read('../src/routes/inventory-holds.js');
  const router = read('../src/routes/inventory.js');
  assert.match(route, /method !== 'GET'/);
  assert.match(route, /coreFulfillmentRead/);
  assert.match(route, /coreReportingInventoryRead/);
  assert.match(route, /WAREHOUSE_SCOPE_DENIED/);
  assert.match(router, /handleInventoryHoldRoutes/);
  assert.match(router, /\/api\/inventory\/holds/);
});

test('package Sales SKU resolves through product identity to one active inventory base variant', () => {
  const repository = read('../src/db/repositories/sales-fulfillment.js');
  const service = read('../src/services/sales-fulfillment.js');

  assert.match(repository, /base_variant\.product_id = selected_variant\.product_id/);
  assert.match(repository, /base_variant\.is_inventory_base = true/);
  assert.match(repository, /base_variant\.is_active = true/);
  assert.match(service, /row\.base_variant_ids\.length !== 1/);
  assert.match(service, /baseVariantId: row\.base_variant_ids\[0\]/);
  assert.doesNotMatch(service, /TDOTDOT|TDOTDO/);
});

test('all three user surfaces expose the same held-order eye drill-down', () => {
  const inventory = read('../../web/app/components/inventory-reporting-workspace.tsx');
  const sales = read('../../web/app/sales/sales-orders/SalesOrderDetail.tsx');
  const fulfillment = read('../../web/app/inventory/fulfillment/fulfillment-workspace.tsx');

  assert.match(inventory, /StockHoldBreakdown/);
  assert.match(inventory, /title="Xem các đơn đang giữ hàng"/);
  assert.match(sales, /excludeSalesOrderId=\{order\.id\}/);
  assert.match(sales, /title="Xem các đơn khác đang giữ hàng"/);
  assert.match(fulfillment, /excludeSalesOrderId=\{item\.salesOrderId\}/);
  assert.match(fulfillment, /Kho xử lý: <strong>\{selectedOrder\.warehouseCode\} — \{selectedOrder\.warehouseName\}<\/strong>/);
});

test('manual delivery remains outside preparation queue', () => {
  const repository = read('../src/db/repositories/sales-fulfillment-operations.js');
  assert.match(repository, /version\.delivery_mode = 'DELIVERY'/);
  assert.match(repository, /COALESCE\(version\.delivery_execution_mode, 'TRIP'\) = 'MANUAL'/);
});
