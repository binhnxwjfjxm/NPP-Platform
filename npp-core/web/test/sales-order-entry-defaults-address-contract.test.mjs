import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('sales order create form keeps account defaults compact beside warehouse and delivery fields', async () => {
  const [form, types] = await Promise.all([
    read('app/sales/sales-orders/SalesOrderCommercialForm.tsx'),
    read('lib/sales-order-types.ts'),
  ]);

  assert.match(form, /data-testid="sales-warehouse-default-toggle"/);
  assert.match(form, /data-testid="sales-delivery-default-toggle"/);
  assert.match(form, /width: 14/);
  assert.match(form, /Dùng làm mặc định/);
  assert.match(form, /settings\.defaultDeliveryChoice/);
  assert.match(form, /entryDefaults:/);
  assert.match(form, /entrySettings\?\.savedWarehouseId/);
  assert.match(form, /entrySettings\?\.savedDeliveryChoice/);
  assert.match(types, /defaultDeliveryChoice: SalesOrderDeliveryChoice/);
  assert.match(types, /savedWarehouseId: string \| null/);
});

test('delivery address is optional and the order form does not add a separate one-off address field', async () => {
  const form = await read('app/sales/sales-orders/SalesOrderCommercialForm.tsx');

  assert.doesNotMatch(form, /deliveryExecutionMode === 'TRIP' && !addressId/);
  assert.doesNotMatch(form, /sales-order-direct-delivery-address/);
  assert.doesNotMatch(form, /Địa chỉ giao riêng của đơn/);
  assert.match(form, /addresses\.length > 0/);
  assert.match(form, /Địa chỉ giao hàng \(tùy chọn\)/);
  assert.doesNotMatch(form, /quickAddressKey/);
  assert.doesNotMatch(form, /api\/customers\/\$\{created\.id\}\/addresses/);
});

test('sales order preview makes product name primary and removes SKU text from the commercial line preview', async () => {
  const detail = await read('app/sales/sales-orders/SalesOrderDetail.tsx');
  assert.match(detail, /<span>Sản phẩm<\/span>/);
  assert.match(detail, /<span><b>\{line\.itemName\}<\/b><\/span>/);
  assert.doesNotMatch(detail, /<span><b>\{line\.sku\}<\/b><small>\{line\.itemName\}<\/small><\/span>/);
});

test('customer table visual hierarchy places customer name before customer code without changing filters', async () => {
  const [workspace, css] = await Promise.all([
    read('app/customers/customer-workspace.tsx'),
    read('app/customers/customers.module.css'),
  ]);
  assert.match(workspace, /data-testid="customers-status-filter"/);
  assert.match(workspace, /data-testid="customers-group-filter"/);
  assert.match(workspace, /data-testid="customers-employee-filter"/);
  assert.match(css, /strong\.code\s*\{[\s\S]*order:\s*2/);
  assert.match(css, /strong\.code \+ span\s*\{[\s\S]*order:\s*1/);
});