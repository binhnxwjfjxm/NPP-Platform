import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { salesOrderSearchPreviewInternals } from '../src/services/sales-order-search-preview.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Lô B chọn kho mặc định trong đúng warehouse scope và ưu tiên kho chính', () => {
  const context = { scopes: { warehouseIds: ['w-1', 'w-2'], branchIds: ['b-1'] } };
  const warehouses = [
    { id: 'w-1', branch_id: 'b-1', warehouse_type: 'distribution', is_active: true },
    { id: 'w-2', branch_id: 'b-1', warehouse_type: 'main', is_active: true },
    { id: 'w-3', branch_id: 'b-1', warehouse_type: 'main', is_active: true },
  ];
  assert.equal(salesOrderSearchPreviewInternals.pickDefaultWarehouseId(warehouses, context), 'w-2');
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
