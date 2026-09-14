import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Công Ty giữ catalog SKU local ngắn hạn và không lưu giá/tồn vào IndexedDB', async () => {
  const helper = await read('app/sales/sales-orders/sales-order-sku-local-cache.ts');

  assert.match(helper, /indexedDB\.open\(CACHE_DB_NAME, 1\)/);
  assert.match(helper, /const CATALOG_REFRESH_MS = 30 \* 60_000;/);
  assert.match(helper, /const MAX_CATALOG_ROWS = 2000;/);
  assert.match(helper, /type SalesOrderSkuCatalogRow = Omit<SalesOrderSkuSearchOption, 'pricePreview' \| 'inventoryPreview'>/);
  assert.match(helper, /searchSalesOrderSkuCatalog/);
  assert.match(helper, /tokens\.every\(\(token\) => fields\.some\(\(field\) => field\.includes\(token\)\)\)/);
  assert.match(helper, /if \(Date\.now\(\) - memorySavedAt >= CATALOG_REFRESH_MS\) \{/);
  assert.doesNotMatch(helper, /\/api\/sales-orders\/sku-previews/);
  assert.doesNotMatch(helper, /\/api\/sales-orders\/price-preview/);
});

test('Làm ấm catalog tải tuần tự, có trần và tự bỏ local nếu danh mục vượt giới hạn', async () => {
  const helper = await read('app/sales/sales-orders/sales-order-sku-local-cache.ts');

  assert.match(helper, /for \(let offset = 0; offset < MAX_CATALOG_ROWS; offset \+= CATALOG_PAGE_SIZE\)/);
  assert.doesNotMatch(helper, /Promise\.all\(offsets/);
  assert.match(helper, /const overflow = await fetchCatalogPage\(MAX_CATALOG_ROWS\)/);
  assert.match(helper, /catalogDisabledForSession = true/);
  assert.match(helper, /savedAt: memorySavedAt, rows: memoryRows/);
});

test('Local SKU chỉ dùng sau khi nhận thuế mặc định hiện hành và luôn phủ thuế mới lên cache', async () => {
  const helper = await read('app/sales/sales-orders/sales-order-sku-local-cache.ts');
  const ui = await read('app/sales/sales-orders/sales-order-ui.ts');

  assert.match(helper, /configureSalesOrderSkuCatalogDefaults/);
  assert.match(helper, /!currentTaxDefaults\) return null/);
  assert.match(helper, /matches\.map\(\(row\) => Object\.freeze\(\{ \.\.\.row, \.\.\.currentTaxDefaults \}\)\)/);
  assert.match(ui, /configureSalesOrderSkuCatalogDefaults\(payload\.data\)/);
});

test('Tìm SKU dùng local trước, nhưng vẫn fallback backend và làm ấm cache từ cấu hình lập đơn', async () => {
  const ui = await read('app/sales/sales-orders/sales-order-ui.ts');

  assert.match(ui, /warmSalesOrderSkuCatalog/);
  assert.match(ui, /path === '\/api\/sales-orders\/entry-settings'/);
  assert.match(ui, /const cachedSkuSearch = await readSalesOrderSkuSearchCache<T>\(path, requestInit\)/);
  assert.match(ui, /if \(cachedSkuSearch !== null\) return cachedSkuSearch/);
  assert.match(ui, /const response = await fetch\(path,/);
  assert.match(ui, /rememberSalesOrderSkuSearchRows\(payload\.data\)/);
});

test('Xếp hạng local giữ đúng ưu tiên tìm kiếm hiện tại: SKU, mã hàng, barcode, tên chính xác rồi tiền tố', async () => {
  const helper = await read('app/sales/sales-orders/sales-order-sku-local-cache.ts');
  const expectedRanks = [
    "toUpperCase() === exact) return 0",
    "productCode ?? '').toUpperCase() === exact) return 1",
    "barcode ?? '').toUpperCase() === exact) return 2",
    'normalizeSearchText(row.productName) === normalizedTerm) return 3',
    'normalizeSearchText(row.variantName) === normalizedTerm) return 4',
    'normalizeSearchText(row.productName).startsWith(normalizedTerm)) return 5',
    'normalizeSearchText(row.variantName).startsWith(normalizedTerm)) return 6',
  ];
  for (const marker of expectedRanks) assert.ok(helper.includes(marker), marker);
});
