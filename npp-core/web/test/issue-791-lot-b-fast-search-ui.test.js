import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Lô B frontend hiện SKU trước rồi gửi đúng context để cập nhật giá/tồn/khả dụng', async () => {
  const [form, types, gateway, previewGateway] = await Promise.all([
    read('app/sales/sales-orders/SalesOrderCommercialForm.tsx'),
    read('lib/sales-order-types.ts'),
    read('lib/sales-order-gateway.ts'),
    read('lib/sales-order-preview-gateway.ts'),
  ]);
  for (const field of ['warehouseId', 'salesChannelId', 'pricingAt', "previewQuery.set('customerId'"]) {
    assert.match(form, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(form, /\/api\/sales-orders\/sku-previews/);
  assert.match(form, /skuSearchRunRef/);
  for (const field of ['warehouseId', 'salesChannelId', 'customerId', 'pricingAt']) {
    assert.match(previewGateway, new RegExp(`searchParams\\.get\\('${field}'`));
  }
  assert.match(previewGateway, /new URLSearchParams\(\{ warehouseId, salesChannelId, pricingAt/);
  assert.match(previewGateway, /query\.set\('customerId'/);
  assert.match(gateway, /INVALID_SALES_CHANNEL_ID/);
  assert.match(gateway, /INVALID_PRICING_AT/);
  assert.match(form, /option\.pricePreview/);
  assert.match(form, /option\.inventoryPreview/);
  assert.match(form, /Không quản lý tồn/);
  assert.match(types, /defaultWarehouseId: string \| null/);
  assert.match(types, /pricePreview: SalesOrderSkuPricePreview/);
  assert.match(types, /inventoryPreview: SalesOrderSkuInventoryPreview/);
});

test('Lô B Add tập trung Số lượng và select toàn bộ, không trả focus ngay về ô tìm', async () => {
  const form = await read('app/sales/sales-orders/SalesOrderCommercialForm.tsx');
  assert.match(form, /clientLineId: crypto\.randomUUID\(\)/);
  assert.match(form, /focusLineQuantity\(pending\.clientLineId\)/);
  assert.match(form, /quantityRefs\.current\.get\(clientLineId\)/);
  assert.match(form, /onFocus=\{\(event\) => event\.currentTarget\.select\(\)\}/);
  assert.match(form, /onClick=\{\(event\) => event\.currentTarget\.select\(\)\}/);
  assert.doesNotMatch(form, /finally \{\n\s*window\.setTimeout\(\(\) => searchRef\.current\?\.focus\(\), 0\)/);
});
