import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('sales order create form exposes account defaults next to warehouse and delivery method', async () => {
  const [form, types] = await Promise.all([
    read('app/sales/sales-orders/SalesOrderCommercialForm.tsx'),
    read('lib/sales-order-types.ts'),
  ]);

  assert.match(form, /data-testid="sales-entry-default-controls"/);
  assert.match(form, /Dùng kho này làm mặc định/);
  assert.match(form, /Dùng cách giao này làm mặc định/);
  assert.match(form, /settings\.defaultDeliveryChoice/);
  assert.match(form, /entryDefaults:/);
  assert.match(form, /entrySettings\?\.savedWarehouseId/);
  assert.match(form, /entrySettings\?\.savedDeliveryChoice/);
  assert.match(types, /defaultDeliveryChoice: SalesOrderDeliveryChoice/);
  assert.match(types, /savedWarehouseId: string \| null/);
});

test('manual delivery can omit address while trip delivery requires saved or one-off destination', async () => {
  const form = await read('app/sales/sales-orders/SalesOrderCommercialForm.tsx');

  assert.match(form, /deliveryExecutionMode === 'TRIP' && !addressId && !deliveryAddressLine1\.trim\(\)/);
  assert.match(form, /deliveryAddress:\s*\{/);
  assert.match(form, /Địa chỉ giao riêng của đơn/);
  assert.match(form, /không lưu vào hồ sơ khách/);
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
