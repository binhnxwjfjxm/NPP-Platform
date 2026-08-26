import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectRoot = new URL('../', import.meta.url);

async function readText(relativePath) {
  return readFile(new URL(relativePath, projectRoot), 'utf8');
}

test('Danh mục sản phẩm tải tiếp các trang sau mốc 1000', async () => {
  const pagination = await readText('lib/product-catalog-pagination.ts');
  const page = await readText('app/products/page.tsx');
  const route = await readText('app/api/products/route.ts');

  assert.match(pagination, /const PRODUCT_PAGE_SIZE = 1000/);
  assert.match(pagination, /pageParams\.set\('offset', String\(offset\)\)/);
  assert.match(pagination, /if \(page\.length < PRODUCT_PAGE_SIZE\) return products/);
  assert.match(page, /listAllProducts<Product>\(requestId\)/);
  assert.doesNotMatch(page, /listProducts<Product>\(requestId, new URLSearchParams\(\{ limit: '1000' \}\)\)/);
  assert.match(route, /params\.get\('limit'\) === '1000' && !params\.has\('offset'\)/);
  assert.match(route, /listAllProducts<unknown>\(requestId, params\)/);
});
