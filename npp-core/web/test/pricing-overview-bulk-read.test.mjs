import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(process.cwd());
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

test('Bảng giá tổng hợp đọc SKU theo lô thay vì gọi từng sản phẩm', () => {
  const overview = read('app/pricing/pricing-overview.tsx');
  const route = read('app/api/products/variants/query/route.ts');
  const gateway = read('lib/product-gateway.ts');
  const coreRoute = read('../api/src/routes/products-core.js');
  const service = read('../api/src/services/product-variant-bulk-read.js');
  const repository = read('../api/src/db/repositories/product-variants.js');

  assert.match(overview, /PRODUCT_VARIANT_BATCH_SIZE = 500/);
  assert.match(overview, /\/api\/products\/variants\/query/);
  assert.match(overview, /productIds: chunk\.map\(\(product\) => product\.id\)/);
  assert.doesNotMatch(overview, /\/api\/products\/\$\{product\.id\}\/variants/);
  assert.match(gateway, /listProductVariantsForProducts/);
  assert.match(gateway, /path: '\/api\/products\/variants\/query'/);
  assert.match(route, /listProductVariantsForProducts/);
  assert.match(coreRoute, /pathname === '\/api\/products\/variants\/query'/);
  assert.match(coreRoute, /readPostPaths\.has\(pathname\)/);
  assert.match(service, /MAX_PRODUCT_IDS = 500/);
  assert.match(repository, /listProductVariantsForProducts/);
  assert.match(repository, /pv\.installation_id = \$1 AND pv\.product_id = ANY\(\$2::uuid\[\]\)/);
});
