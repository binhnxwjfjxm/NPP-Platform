import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { directStockIssueInternals } from '../src/services/sales-direct-stock-issue.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('PICKUP và Giao thủ công dùng cùng một direct stock issue engine, không copy Delivery Order', async () => {
  const [engine, manualWrapper, pickupWrapper] = await Promise.all([
    read('src/services/sales-direct-stock-issue.js'),
    read('src/services/sales-manual-stock-issue.js'),
    read('src/services/sales-pickup-stock-issue.js'),
  ]);

  assert.match(manualWrapper, /mode: 'MANUAL'/);
  assert.match(pickupWrapper, /mode: 'PICKUP'/);
  assert.match(engine, /deliveryMode: 'PICKUP'/);
  assert.match(engine, /deliveryExecutionMode: null/);
  assert.match(engine, /sales-pickup-stock-issue-movement/);
  assert.match(engine, /PICKUP_SALES_ORDER_STOCK_ISSUE/);
  assert.doesNotMatch(engine, /sales-delivery-inventory|sales-delivery-orders|Delivery Order/);
});

test('PICKUP chỉ nhận đơn Giao tại quầy đã Chốt, manual contract vẫn tách biệt', () => {
  const pickup = directStockIssueInternals.directMode('PICKUP');
  const manual = directStockIssueInternals.directMode('MANUAL');
  assert.equal(directStockIssueInternals.sourceMatches(pickup, {
    status: 'confirmed',
    delivery_mode: 'PICKUP',
    delivery_execution_mode: null,
  }), true);
  assert.equal(directStockIssueInternals.sourceMatches(pickup, {
    status: 'confirmed',
    delivery_mode: 'DELIVERY',
    delivery_execution_mode: 'MANUAL',
  }), false);
  assert.equal(directStockIssueInternals.sourceMatches(manual, {
    status: 'confirmed',
    delivery_mode: 'DELIVERY',
    delivery_execution_mode: 'MANUAL',
  }), true);
});

test('API xuất kho chọn engine PICKUP theo contract, Giao thủ công vẫn là mặc định cũ', async () => {
  const route = await read('src/routes/sales-orders.js');
  assert.match(route, /sales-pickup-stock-issue/);
  assert.match(route, /payload\?\.mode.*PICKUP/);
  assert.match(route, /pickupStockIssueService\.issuePickupSalesOrderStock/);
  assert.match(route, /action: pickup \? 'pickup_stock_issue' : 'manual_stock_issue'/);
  assert.match(route, /manualStockIssueService\.issueManualSalesOrderStock/);
});

test('is_inventory_managed là policy thật của giữ hàng: false bỏ qua, thiếu policy fail closed', async () => {
  const [serviceSource, repositorySource, migration] = await Promise.all([
    read('src/services/sales-fulfillment.js'),
    read('src/db/repositories/sales-fulfillment.js'),
    read('../../database/migrations/shared/093_product_inventory_management_policy.sql'),
  ]);
  assert.match(repositorySource, /product\.is_inventory_managed/);
  assert.match(repositorySource, /JOIN shared\.products product/);
  assert.match(serviceSource, /row\.is_inventory_managed === false/);
  assert.match(serviceSource, /INVENTORY_MANAGEMENT_POLICY_REQUIRED/);
  assert.match(serviceSource, /reserved === 0n && backordered === 0n\) return 'fulfilled'/);
  assert.match(migration, /is_inventory_managed/);
});
