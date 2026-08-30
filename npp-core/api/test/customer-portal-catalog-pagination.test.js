import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { customerPortalCatalogInternals } from '../src/services/customer-portal.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Customer Ordering maps canonical SKU kinds to lẻ/thùng filters', () => {
  assert.equal(customerPortalCatalogInternals.purchaseModeFor({ variant_kind: 'BASE' }), 'retail');
  assert.equal(customerPortalCatalogInternals.purchaseModeFor({ variant_kind: 'OTHER' }), 'retail');
  assert.equal(customerPortalCatalogInternals.purchaseModeFor({ variant_kind: 'CARTON' }), 'case');
  assert.deepEqual(customerPortalCatalogInternals.variantKindsForPurchaseMode('retail'), ['BASE', 'OTHER']);
  assert.deepEqual(customerPortalCatalogInternals.variantKindsForPurchaseMode('case'), ['CARTON']);
  assert.equal(customerPortalCatalogInternals.variantKindsForPurchaseMode(null), null);
});

test('Customer Ordering catalog search and filters execute on the server before pricing', async () => {
  const [route, service, repository] = await Promise.all([
    read('src/routes/customer-portal.js'),
    read('src/services/customer-portal.js'),
    read('src/db/repositories/customer-portal-catalog.js'),
  ]);

  assert.match(route, /categoryId: \(url\.searchParams\.get\('categoryId'\)/);
  assert.match(route, /purchaseMode: \(url\.searchParams\.get\('purchaseMode'\)/);
  assert.match(route, /includeCategories: url\.searchParams\.get\('includeCategories'\) === '1'/);
  assert.match(service, /searchPortalCatalogOptions/);
  assert.match(service, /limit: normalizedLimit \+ 1/);
  assert.match(service, /const pageRows = catalogRows\.slice\(0, normalizedLimit\)/);
  assert.match(service, /mapWithConcurrency\(pageRows, CATALOG_PRICE_CONCURRENCY/);
  assert.match(repository, /WITH RECURSIVE category_tree/);
  assert.match(repository, /pv\.variant_kind = ANY\(\$5::text\[\]\)/);
  assert.match(repository, /pv\.sku ILIKE \$3/);
  assert.match(repository, /brand\.name, ''\) ILIKE \$3/);
});
