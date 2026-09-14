import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('catalog local dùng updated_at hiện có, không cần migration hay bảng đồng bộ mới', async () => {
  const repository = await read('src/db/repositories/sales-order-local-catalog.js');

  assert.match(repository, /pv\.updated_at/);
  assert.match(repository, /p\.updated_at/);
  assert.match(repository, /u\.updated_at/);
  assert.match(repository, /max\(pb\.updated_at\) AS barcode_updated_at/);
  assert.match(repository, /GREATEST\(/);
  assert.match(repository, /max\(changed_at\)/);
  assert.match(repository, /interval '1 second'/);
  assert.doesNotMatch(repository, /INSERT INTO|UPDATE .*catalog|CREATE TABLE/i);
});

test('delta trả upsert cho SKU còn bán được và tombstone cho SKU đã ngưng', async () => {
  const service = await read('src/services/sales-order-local-catalog.js');

  assert.match(service, /if \(row\.eligible === true\) upserts\.push\(mapUpsert\(row\)\)/);
  assert.match(service, /else if \(cursor\) removeIds\.push\(row\.id\)/);
  assert.match(service, /full: cursor === null/);
  assert.match(service, /barcodes: Object\.freeze\(barcodes\)/);
});

test('API catalog local giữ đúng quyền đọc Đơn bán hàng và không cache response', async () => {
  const route = await read('src/routes/product-sales-order-local-catalog.js');
  const aggregator = await read('src/routes/products.js');

  assert.match(route, /\/api\/products\/sales-order-local-catalog/);
  assert.match(route, /options\.PERMISSIONS\.coreSalesOrderRead/);
  assert.match(route, /Cache-Control', 'no-store'/);
  assert.match(aggregator, /handleProductSalesOrderLocalCatalogRoutes/);
});
