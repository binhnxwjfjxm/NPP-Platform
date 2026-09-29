import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Customer Portal catalog sync dùng cursor delta và tombstone không cần migration mới', async () => {
  const repository = await read('src/db/repositories/customer-portal-catalog.js');
  assert.match(repository, /readPortalCatalogChanges/);
  assert.match(repository, /pv\.updated_at/);
  assert.match(repository, /p\.updated_at/);
  assert.match(repository, /u\.updated_at/);
  assert.match(repository, /category\.updated_at/);
  assert.match(repository, /parent_category\.updated_at/);
  assert.match(repository, /brand\.updated_at/);
  assert.match(repository, /interval '1 second'/);
  assert.match(repository, /eligible/);
  assert.doesNotMatch(repository, /CREATE TABLE|ALTER TABLE|INSERT INTO .*catalog_cache/i);
});

test('Customer Portal sync và batch giá giữ identity khách hàng ở server', async () => {
  const service = await read('src/services/customer-portal.js');
  assert.match(service, /syncPortalCatalog/);
  assert.match(service, /removeVariantIds/);
  assert.match(service, /CATALOG_PRICE_BATCH_LIMIT = 100/);
  assert.match(service, /channelId: membership\.sales_channel_id/);
  assert.match(service, /customerId: membership\.customer_id/);
  assert.doesNotMatch(service, /payload\?\.customerId/);
  assert.doesNotMatch(service, /payload\?\.channelId/);
});

test('Customer Portal route mở sync và batch price nhưng vẫn bắt membership', async () => {
  const route = await read('src/routes/customer-portal.js');
  assert.match(route, /\/api\/customer-portal\/catalog-sync/);
  assert.match(route, /\/api\/customer-portal\/catalog\/prices/);
  assert.match(route, /service\.syncPortalCatalog/);
  assert.match(route, /service\.resolvePortalCatalogPrices/);
  assert.match(route, /authenticateMembership/);
  assert.match(route, /Cache-Control', 'no-store'/);
});
