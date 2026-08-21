import assert from 'node:assert/strict';
import test from 'node:test';

import { searchSalesOrderSkuOptions } from '../src/services/sales-order-entry-legacy.js';

function skuRow(index, selectable) {
  return {
    id: `variant-${index}`,
    product_id: `product-${index}`,
    sku: `SKU${String(index).padStart(3, '0')}`,
    name: `Quy cách ${index}`,
    product_code: `P${String(index).padStart(3, '0')}`,
    product_name: `Sản phẩm ${index}`,
    product_is_active: true,
    product_is_orderable: selectable,
    variant_is_active: true,
    is_sellable: true,
    unit_id: `unit-${index}`,
    conversion_to_base: '1',
    unit_code: 'EA',
    unit_name: 'Cái',
    unit_is_active: true,
    allows_fractional: false,
    barcode: null,
  };
}

function fakeCatalogClient() {
  const rows = Array.from({ length: 80 }, (_, index) => skuRow(index, index >= 40));
  const catalogOffsets = [];
  return {
    catalogOffsets,
    async query(sql, params) {
      if (sql.includes('FROM shared.sales_order_settings settings')) {
        return { rows: [{ default_tax_mode: 'EXCLUSIVE', default_tax_rate: '0' }] };
      }
      if (sql.includes('FROM shared.product_variants pv')) {
        const limit = Number(params.at(-2));
        const offset = Number(params.at(-1));
        catalogOffsets.push(offset);
        return { rows: rows.slice(offset, offset + limit) };
      }
      throw new Error(`Unexpected SQL in catalog pagination test: ${sql.slice(0, 80)}`);
    },
  };
}

const requestContext = { installationId: 'installation-test' };

test('phân trang SKU tính sau khi loại các dòng chưa đủ điều kiện bán', async () => {
  const client = fakeCatalogClient();
  const result = await searchSalesOrderSkuOptions(client, {
    requestContext,
    search: '',
    retailSearch: true,
    limit: 20,
    offset: 0,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.skuOptions.map((row) => row.sku),
    Array.from({ length: 20 }, (_, index) => `SKU${String(index + 40).padStart(3, '0')}`));
  assert.deepEqual(client.catalogOffsets, [0, 50]);
});

test('offset của trang tiếp theo áp dụng trên tập SKU hợp lệ, không áp dụng trên dòng thô', async () => {
  const client = fakeCatalogClient();
  const result = await searchSalesOrderSkuOptions(client, {
    requestContext,
    search: '',
    retailSearch: true,
    limit: 10,
    offset: 15,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.skuOptions.map((row) => row.sku),
    Array.from({ length: 10 }, (_, index) => `SKU${String(index + 55).padStart(3, '0')}`));
  assert.deepEqual(client.catalogOffsets, [0, 50]);
});
