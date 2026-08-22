import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listSalesOrderProductMetadata } from '../src/db/repositories/sales-order-product-metadata.js';

const serviceSource = await readFile(new URL('../src/services/sales-order-entry-legacy.js', import.meta.url), 'utf8');

test('sales order SKU metadata reads canonical Công Ty category and brand without changing SKU eligibility', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          product_id: '11111111-1111-4111-8111-111111111111',
          category_id: '22222222-2222-4222-8222-222222222222',
          category_code: 'TS-SUA',
          category_name: 'Sữa đặc',
          parent_category_id: '33333333-3333-4333-8333-333333333333',
          parent_category_code: 'TRA-SUA',
          parent_category_name: 'Trà sữa',
          brand_id: '44444444-4444-4444-8444-444444444444',
          brand_code: 'HP',
          brand_name: 'Hưng Phát',
        }],
      };
    },
  };

  const rows = await listSalesOrderProductMetadata(client, {
    installationId: 'npp-a',
    productIds: ['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'],
  });

  assert.equal(rows.length, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['npp-a', ['11111111-1111-4111-8111-111111111111']]);
  assert.match(calls[0].sql, /shared\.product_categories category/);
  assert.match(calls[0].sql, /shared\.product_categories parent_category/);
  assert.match(calls[0].sql, /shared\.product_brands brand/);
});

test('sales order SKU response carries canonical product metadata for MCP without touching order mutations', () => {
  assert.match(serviceSource, /sales-order-product-metadata\.js/);
  assert.match(serviceSource, /categoryCode: metadata\?\.category_code/);
  assert.match(serviceSource, /categoryName: metadata\?\.category_name/);
  assert.match(serviceSource, /parentCategoryName: metadata\?\.parent_category_name/);
  assert.match(serviceSource, /brandName: metadata\?\.brand_name/);
  assert.match(serviceSource, /evaluateSalesOrderSkuEligibility\(row\)/);
});
