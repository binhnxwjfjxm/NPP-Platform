import assert from 'node:assert/strict';
import test from 'node:test';

import * as repository from '../src/db/repositories/sales-order.js';
import { searchSalesOrderSkuOptions } from '../src/services/sales-order-entry-legacy.js';

function eligibleRow(index) {
  return {
    id: `variant-${index}`,
    product_id: `product-${index}`,
    sku: `SKU${String(index).padStart(3, '0')}`,
    name: `Quy cách ${index}`,
    product_code: `P${String(index).padStart(3, '0')}`,
    product_name: `Sản phẩm ${index}`,
    product_is_active: true,
    product_is_orderable: true,
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

const requestContext = { installationId: 'installation-test' };

test('SQL loại SKU chưa đủ điều kiện bán trước LIMIT/OFFSET', async () => {
  let captured = null;
  const client = {
    async query(statement, params) {
      captured = { statement, params };
      return { rows: [] };
    },
  };

  await repository.searchSalesOrderSkuOptions(client, {
    installationId: requestContext.installationId,
    search: '',
    retailSearch: true,
    limit: 30,
    offset: 60,
  });

  assert.ok(captured);
  const statement = captured.statement;
  const limitIndex = statement.indexOf('LIMIT $6 OFFSET $7');
  assert.ok(limitIndex > 0);
  for (const condition of [
    'p.is_active = true',
    'p.is_orderable = true',
    'pv.is_active = true',
    'pv.is_sellable = true',
    'pv.unit_id IS NOT NULL',
    'u.is_active = true',
    'pv.conversion_to_base IS NOT NULL',
    'pv.conversion_to_base > 0',
  ]) {
    const conditionIndex = statement.indexOf(condition);
    assert.ok(conditionIndex > 0, `Thiếu điều kiện ${condition}`);
    assert.ok(conditionIndex < limitIndex, `${condition} phải đứng trước LIMIT/OFFSET`);
  }
  assert.equal(captured.params.at(-2), 30);
  assert.equal(captured.params.at(-1), 60);
});

test('service chuyển đúng limit/offset đã chuẩn hóa và không quét lặp nhiều trang', async () => {
  const catalogCalls = [];
  const client = {
    async query(statement, params) {
      if (statement.includes('FROM shared.sales_order_settings settings')) {
        return { rows: [{ default_tax_mode: 'EXCLUSIVE', default_tax_rate: '0' }] };
      }
      if (statement.includes('FROM shared.product_variants pv')) {
        catalogCalls.push({ statement, params });
        return { rows: Array.from({ length: 10 }, (_, index) => eligibleRow(index + 15)) };
      }
      throw new Error(`Unexpected SQL in catalog pagination test: ${statement.slice(0, 80)}`);
    },
  };

  const result = await searchSalesOrderSkuOptions(client, {
    requestContext,
    search: '',
    retailSearch: true,
    limit: 10,
    offset: 15,
  });

  assert.equal(result.ok, true);
  assert.equal(catalogCalls.length, 1);
  assert.equal(catalogCalls[0].params.at(-2), 10);
  assert.equal(catalogCalls[0].params.at(-1), 15);
  assert.deepEqual(result.skuOptions.map((row) => row.sku),
    Array.from({ length: 10 }, (_, index) => `SKU${String(index + 15).padStart(3, '0')}`));
});
