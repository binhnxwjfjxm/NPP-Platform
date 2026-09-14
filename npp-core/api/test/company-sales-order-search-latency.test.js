import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as searchRepository from '../src/db/repositories/sales-order-sku-search.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Tìm hàng Công Ty giữ tìm không dấu nhiều từ nhưng bỏ quét unnest/strpos', async () => {
  const calls = [];
  const client = {
    totalCount: 2,
    idleCount: 1,
    waitingCount: 0,
    async query(statement, params) {
      calls.push({ statement, params });
      return { rows: [] };
    },
  };

  await searchRepository.searchSalesOrderSkuOptions(client, {
    installationId: '66666666-6666-4666-8666-666666666666',
    search: 'thạch dừa vải',
    limit: 30,
    offset: 0,
  });

  assert.equal(calls.length, 1);
  const { statement, params } = calls[0];
  assert.equal(params[1], 'THẠCH DỪA VẢI');
  assert.equal(params[2], 'thach dua vai');
  assert.deepEqual(params.slice(4, 7), ['%thach%', '%dua%', '%vai%']);
  assert.equal(params.at(-2), 30);
  assert.equal(params.at(-1), 0);
  assert.doesNotMatch(statement, /unnest\(/i);
  assert.doesNotMatch(statement, /strpos\(/i);
  assert.match(statement, /translate\(lower\(pv\.sku\)/);
  assert.match(statement, /translate\(lower\(p\.name\)/);
  assert.match(statement, /LIKE \$5/);
  assert.match(statement, /matching_barcode\.normalized_barcode/);
});

test('Tìm hàng Công Ty có index trigram đúng biểu thức và được đăng ký migration 135', () => {
  const migration = source('../../../database/migrations/shared/135_sales_order_sku_search_indexes.sql');
  const migrationIndex = source('../src/migrations/index.js');
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(migration, /product_variants_sales_search_sku_trgm_idx/);
  assert.match(migration, /product_variants_sales_search_name_trgm_idx/);
  assert.match(migration, /products_sales_search_code_trgm_idx/);
  assert.match(migration, /products_sales_search_name_trgm_idx/);
  assert.match(migration, /product_barcodes_sales_search_value_trgm_idx/);
  assert.match(migration, /USING gin/);
  assert.match(migration, /gin_trgm_ops/);
  assert.match(migrationIndex, /135_sales_order_sku_search_indexes/);
});

test('Luồng Công Ty dùng search riêng và ghi thời gian sku-search/sku-previews cùng áp lực pool', () => {
  const searchService = source('../src/services/sales-order-sku-search.js');
  const previewService = source('../src/services/sales-order-search-preview.js');
  assert.match(previewService, /import \* as skuSearchService from '\.\/sales-order-sku-search\.js'/);
  assert.match(previewService, /skuSearchService\.searchSalesOrderSkuOptions/);
  assert.match(searchService, /sales_order_sku_search_latency/);
  assert.match(searchRepository.searchSalesOrderSkuOptions.toString(), /sales_order_sku_search_db/);
  assert.match(previewService, /sales_order_sku_previews_latency/);
  for (const field of ['poolTotal', 'poolIdle', 'poolWaiting']) {
    assert.match(searchService, new RegExp(field));
    assert.match(previewService, new RegExp(field));
  }
});
