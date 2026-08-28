import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { salesOrderSearchPreviewInternals } from '../src/services/sales-order-search-preview.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('progressive SKU preview only accepts a bounded, unique UUID list', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(salesOrderSearchPreviewInternals.normalizeVariantIds([first, first, second]), [first, second]);
  assert.equal(salesOrderSearchPreviewInternals.normalizeVariantIds(['not-a-uuid']), null);
  const tooMany = Array.from({ length: 51 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
  assert.equal(salesOrderSearchPreviewInternals.normalizeVariantIds(tooMany), null);
});

test('progressive SKU preview keeps warehouse scope and orderable-SKU checks on the server', async () => {
  const [route, service, repository] = await Promise.all([
    read('src/routes/sales-orders.js'),
    read('src/services/sales-order-search-preview.js'),
    read('src/db/repositories/sales-order.js'),
  ]);
  assert.match(route, /pathname === '\/api\/sales-orders\/sku-previews'/);
  assert.match(route, /variantIds: url\.searchParams\.getAll\('variantId'\)/);
  assert.match(service, /export async function getSalesOrderSkuPreviews/);
  assert.match(service, /resolvePreviewContext/);
  assert.match(service, /listOrderableSalesVariantIds/);
  assert.match(repository, /pv\.id = ANY\(\$2::uuid\[\]\)/);
});
