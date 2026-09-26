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

test('Lô B search backend nhận đủ context, batch giá và không đẩy phép tính Kho xuống browser', async () => {
  const [route, service, pricing, repository, entry] = await Promise.all([
    read('src/routes/sales-orders.js'),
    read('src/services/sales-order-search-preview.js'),
    read('src/services/sales-order-search-pricing.js'),
    read('src/db/repositories/sales-order-search-preview.js'),
    read('src/services/sales-order-entry.js'),
  ]);
  for (const field of ['warehouseId', 'salesChannelId', 'customerId', 'priceSelectionMode', 'pricingAt']) {
    assert.match(route, new RegExp(field));
  }
  assert.match(service, /appliedPriceService\.resolveSalesOrderAppliedPricePreviews/);
  assert.match(service, /priceSelectionMode: previewContext\.priceSelectionMode/);
  assert.match(service, /const \[inventoryRows, pricingByVariantId\] = await Promise\.all/);
  assert.match(pricing, /quantity: '1'/);
  assert.match(repository, /inventory\.inventory_balances/);
  assert.match(repository, /sales\.sales_order_fulfillment_demands/);
  assert.match(repository, /is_inventory_managed/);
  assert.match(repository, /on_hand_quantity/);
  assert.match(repository, /held_quantity/);
  assert.match(repository, /available_quantity/);
  assert.match(repository, /package_unit\.name AS package_unit_name/);
  assert.match(repository, /package_variant\.conversion_to_base/);
  assert.match(entry, /defaultWarehouseId/);
});

test('Lô B caller không gửi preview context vẫn dùng tìm SKU Công Ty tối ưu', async () => {
  const service = await read('src/services/sales-order-search-preview.js');
  assert.match(service, /import \* as skuSearchService from '\.\/sales-order-sku-search\.js'/);
  assert.match(service, /if \(!previewContextRequested\) \{[\s\S]*return skuSearchService\.searchSalesOrderSkuOptions/);
  assert.doesNotMatch(service, /legacy\.searchSalesOrderSkuOptions/);
});

test('Lô B phân biệt không quản lý tồn với hết hàng và trả dữ liệu quy đổi ĐVT', () => {
  assert.deepEqual(
    salesOrderSearchPreviewInternals.inventoryPreview({ is_inventory_managed: false }),
    {
      status: 'NOT_MANAGED',
      onHandQuantity: null,
      availableQuantity: null,
      heldQuantity: null,
      unitCode: null,
      unitName: null,
      packageUnitName: null,
      packageConversionToBase: null,
    },
  );
  const tracked = salesOrderSearchPreviewInternals.inventoryPreview({
    is_inventory_managed: true,
    base_variant_count: 1,
    base_variant_id: 'base-1',
    base_unit_code: 'THUNG',
    base_unit_name: 'Chai',
    package_unit_name: 'Thùng',
    package_conversion_to_base: '24.000000000000',
    on_hand_quantity: '77.000000000000',
    available_quantity: '53.000000000000',
    held_quantity: '24.000000000000',
  });
  assert.equal(tracked.status, 'TRACKED');
  assert.equal(tracked.onHandQuantity, '77.000000000000');
  assert.equal(tracked.availableQuantity, '53.000000000000');
  assert.equal(tracked.heldQuantity, '24.000000000000');
  assert.equal(tracked.unitName, 'Chai');
  assert.equal(tracked.packageUnitName, 'Thùng');
  assert.equal(tracked.packageConversionToBase, '24.000000000000');
});

test('Lô B không còn trả thông báo chọn được dư thừa', async () => {
  const legacy = await read('src/services/sales-order-entry-legacy.js');
  assert.doesNotMatch(legacy, /Có thể chọn để bán\./);
  assert.match(legacy, /code: 'ELIGIBLE', message: ''/);
});
