import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { salesOrderSearchPreviewInternals } from '../src/services/sales-order-search-preview.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Lô B chọn kho mặc định trong đúng warehouse scope và ưu tiên kho chính', () => {
  const branchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const warehouseOne = '11111111-1111-4111-8111-111111111111';
  const warehouseTwo = '22222222-2222-4222-8222-222222222222';
  const warehouseThree = '33333333-3333-4333-8333-333333333333';
  const context = { scopes: { warehouseIds: [warehouseOne, warehouseTwo], branchIds: [branchId] } };
  const warehouses = [
    { id: warehouseOne, branch_id: branchId, warehouse_type: 'distribution', is_active: true },
    { id: warehouseTwo, branch_id: branchId, warehouse_type: 'main', is_active: true },
    { id: warehouseThree, branch_id: branchId, warehouse_type: 'main', is_active: true },
  ];
  assert.equal(salesOrderSearchPreviewInternals.pickDefaultWarehouseId(warehouses, context), warehouseTwo);
});

test('Lô B search backend nhận đủ context và không đẩy phép tính Kho xuống browser', async () => {
  const [route, service, repository, entry] = await Promise.all([
    read('src/routes/sales-orders.js'),
    read('src/services/sales-order-search-preview.js'),
    read('src/db/repositories/sales-order-search-preview.js'),
    read('src/services/sales-order-entry.js'),
  ]);
  for (const field of ['warehouseId', 'salesChannelId', 'customerId', 'pricingAt']) {
    assert.match(route, new RegExp(field));
  }
  assert.match(service, /quantity: '1'/);
  assert.match(service, /allowMissingBasePrice: true/);
  assert.match(service, /pricingService\.resolvePrice/);
  assert.match(repository, /inventory\.inventory_balances/);
  assert.match(repository, /sales\.sales_order_fulfillment_demands/);
  assert.match(repository, /is_inventory_managed/);
  assert.match(repository, /on_hand_quantity/);
  assert.match(repository, /available_quantity/);
  assert.match(entry, /defaultWarehouseId/);
});

test('Lô B giữ tương thích cho caller tìm SKU cũ không gửi preview context', async () => {
  const service = await read('src/services/sales-order-search-preview.js');
  assert.match(service, /const previewContextRequested = Boolean/);
  assert.match(service, /if \(!previewContextRequested\) \{[\s\S]*return legacy\.searchSalesOrderSkuOptions/);
});

test('Lô B phân biệt không quản lý tồn với hết hàng', () => {
  assert.deepEqual(
    salesOrderSearchPreviewInternals.inventoryPreview({ is_inventory_managed: false }),
    { status: 'NOT_MANAGED', onHandQuantity: null, availableQuantity: null, unitCode: null },
  );
  const tracked = salesOrderSearchPreviewInternals.inventoryPreview({
    is_inventory_managed: true,
    base_variant_count: 1,
    base_variant_id: 'base-1',
    base_unit_code: 'THUNG',
    on_hand_quantity: '12.000000000000',
    available_quantity: '10.000000000000',
  });
  assert.equal(tracked.status, 'TRACKED');
  assert.equal(tracked.onHandQuantity, '12.000000000000');
  assert.equal(tracked.availableQuantity, '10.000000000000');
});
