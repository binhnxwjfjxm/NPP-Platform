import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatHoldQuantity,
  parseHoldQuantity,
} from '../src/services/sales-fulfillment-hold.js';

test('shared stock hold keeps exact quantity arithmetic', () => {
  assert.equal(parseHoldQuantity('15'), 15_000_000_000_000n);
  assert.equal(formatHoldQuantity(15_000_000_000_000n), '15.000000000000');
  assert.equal(parseHoldQuantity('0.000000000001'), 1n);
  assert.equal(parseHoldQuantity('-1'), null);
});

test('shared stock hold migration separates order need from operator allocation target', () => {
  const migration = readFileSync(
    new URL('../../../database/migrations/sales/092_sales_shared_stock_hold.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /allocation_target_base_quantity/);
  assert.match(migration, /COALESCE\(allocation_target_base_quantity, ordered_base_quantity\)/);
  assert.match(migration, /reserved_base_quantity \+ backordered_base_quantity/);
  assert.match(migration, /fulfillment_hold_service/);
  assert.match(migration, /allocation_target_base_quantity >= allocated_base_quantity/);
  assert.match(migration, /picked_base_quantity <> 0/);
  assert.match(migration, /issued_base_quantity <> 0/);
});

test('manual delivery rechecks current stock hold before deciding shortage', () => {
  const source = readFileSync(
    new URL('../src/services/sales-manual-stock-issue.js', import.meta.url),
    'utf8',
  );
  const refresh = source.indexOf('const hold = await reconcileDemandHold');
  const shortage = source.indexOf("'MANUAL_STOCK_ISSUE_SHORTAGE'");
  assert.ok(refresh >= 0, 'manual issue must refresh the stock hold');
  assert.ok(shortage > refresh, 'shortage must be decided after current stock is reconciled');
  assert.match(source, /targetBaseQuantity: demand\.ordered_base_quantity/);
});

test('current demand is not counted as stock held by other orders', () => {
  const hold = readFileSync(
    new URL('../src/services/sales-fulfillment-hold.js', import.meta.url),
    'utf8',
  );
  assert.match(hold, /other\.id <> \$2/);
  assert.match(hold, /const availableForDemand = allocated \+ free/);
  assert.match(hold, /const heldByOthers = onHand > availableForDemand/);
  assert.match(hold, /capacityBaseQuantity: formatHoldQuantity\(availableForDemand\)/);
});

test('manual quick edit replaces the active hold instead of stacking stale demand', () => {
  const orderService = readFileSync(new URL('../src/services/sales-order.js', import.meta.url), 'utf8');
  const fulfillmentService = readFileSync(new URL('../src/services/sales-fulfillment.js', import.meta.url), 'utf8');
  const fulfillmentRepository = readFileSync(new URL('../src/db/repositories/sales-fulfillment.js', import.meta.url), 'utf8');
  assert.match(orderService, /quickEditManualSalesOrder/);
  assert.match(orderService, /return confirmSalesOrder/);
  assert.match(fulfillmentService, /supersedeActiveDemands/);
  assert.match(fulfillmentService, /replaceSalesOrderFulfillmentDemand/);
  assert.match(fulfillmentRepository, /demand\.sales_order_id <> \$4/);
});

test('preparation queue excludes manual delivery and orders outside preparation lifecycle', () => {
  const repository = readFileSync(
    new URL('../src/db/repositories/sales-fulfillment-operations.js', import.meta.url),
    'utf8',
  );
  assert.match(repository, /orders\.fulfillment_status IN/);
  assert.match(repository, /partially_packed', 'packed'/);
  assert.match(repository, /version\.delivery_mode = 'DELIVERY'/);
  assert.match(repository, /COALESCE\(version\.delivery_execution_mode, 'TRIP'\) = 'MANUAL'/);
  assert.match(repository, /line\.ordered_quantity AS ordered_sales_quantity/);
  assert.match(repository, /base_unit\.code AS base_unit_code/);
});

test('manual delivery cannot enter dispatch eligibility or delivery-order creation path', () => {
  const repository = readFileSync(
    new URL('../src/db/repositories/sales-delivery-orders.js', import.meta.url),
    'utf8',
  );
  const manualGuards = repository.match(
    /COALESCE\(version\.delivery_execution_mode, 'TRIP'\) = 'MANUAL'/g,
  ) ?? [];
  assert.ok(manualGuards.length >= 2, 'manual delivery must be blocked in list and mutation lookup');
  assert.match(repository, /version\.delivery_mode = 'DELIVERY'/);
  assert.match(repository, /version\.delivery_execution_mode/);
});

test('quantity allocation exposes exact stock context and units without frontend conversion', () => {
  const service = readFileSync(
    new URL('../src/services/sales-fulfillment-operations.js', import.meta.url),
    'utf8',
  );
  const workspace = readFileSync(
    new URL('../../web/app/inventory/fulfillment/fulfillment-workspace.tsx', import.meta.url),
    'utf8',
  );
  assert.match(service, /mode === 'QUANTITY'/);
  assert.match(service, /allocatedBefore \+ requestedQuantity/);
  assert.match(service, /reconcileDemandHold/);
  assert.match(service, /warehouseOnHandBaseQuantity/);
  assert.match(service, /warehouseHeldByOthersBaseQuantity/);
  assert.match(service, /baseUnitCode/);
  assert.match(workspace, /Khách đặt → Kho/);
  assert.match(workspace, /Tồn thực tế/);
  assert.match(workspace, /Đơn khác đang giữ/);
  assert.match(workspace, /Khả dụng cho đơn này/);
  assert.match(workspace, /Còn cần phân bổ/);
  assert.match(workspace, /orderedQuantityLabel/);
  assert.doesNotMatch(workspace, /conversionFactor|conversion_to_base|\*\s*12/);
});

test('per-line allocation is operated directly from the product table', () => {
  const workspace = readFileSync(
    new URL('../../web/app/inventory/fulfillment/fulfillment-workspace.tsx', import.meta.url),
    'utf8',
  );
  assert.match(workspace, /allocationQuantities/);
  assert.match(workspace, /allocateItem\(item, 'QUANTITY'\)/);
  assert.match(workspace, /allocateItem\(item, 'AUTO'\)/);
  assert.match(workspace, />PB</);
  assert.match(workspace, />PB đủ</);
  assert.doesNotMatch(workspace, /Chọn số lượng muốn phân bổ/);
});

test('sales order detail shows canonical stock observation for every sales flow', () => {
  const fulfillmentService = readFileSync(
    new URL('../src/services/sales-fulfillment.js', import.meta.url),
    'utf8',
  );
  const fulfillmentRepository = readFileSync(
    new URL('../src/db/repositories/sales-fulfillment.js', import.meta.url),
    'utf8',
  );
  const detail = readFileSync(
    new URL('../../web/app/sales/sales-orders/SalesOrderDetail.tsx', import.meta.url),
    'utf8',
  );
  assert.match(fulfillmentService, /loadDemandHoldAvailability/);
  assert.match(fulfillmentService, /warehouseOnHandBaseQuantity/);
  assert.match(fulfillmentService, /warehouseHeldByOthersBaseQuantity/);
  assert.match(fulfillmentService, /warehouseAvailableBaseQuantity/);
  assert.match(fulfillmentRepository, /base_unit\.code AS base_unit_code/);
  assert.match(detail, /Tồn thực tế/);
  assert.match(detail, /Đơn khác đang giữ/);
  assert.match(detail, /Khả dụng cho đơn này/);
  assert.match(detail, /sales-order-stock-observation/);
});