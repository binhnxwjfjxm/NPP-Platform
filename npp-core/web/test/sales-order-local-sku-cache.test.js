import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Công Ty giữ danh mục SKU local lâu dài, không lưu giá/tồn/thuế trong IndexedDB', async () => {
  const helper = await read('app/sales/sales-orders/sales-order-sku-local-cache.ts');
  const catalogRowStart = helper.indexOf('type SalesOrderSkuCatalogRow');
  const catalogRowEnd = helper.indexOf('type CatalogRecord', catalogRowStart);
  assert.ok(catalogRowStart >= 0 && catalogRowEnd > catalogRowStart);
  const persistedCatalogContract = helper.slice(catalogRowStart, catalogRowEnd);

  assert.match(helper, /indexedDB\.open\(CACHE_DB_NAME, 1\)/);
  assert.match(helper, /CACHE_KEY = 'sales-order-sku-catalog-v2'/);
  assert.match(helper, /cursor: string \| null/);
  assert.match(helper, /CATALOG_SYNC_CHECK_MS = 30_000/);
  assert.doesNotMatch(persistedCatalogContract, /pricePreview|inventoryPreview|defaultTaxMode|defaultTaxRate/);
  assert.match(helper, /defaultTaxMode: currentTaxDefaults\.defaultTaxMode/);
  assert.match(helper, /defaultTaxRate: currentTaxDefaults\.defaultTaxRate/);
});

test('Lần đầu tải full; các lần sau chỉ hỏi delta theo cursor và không có TTL làm mất local', async () => {
  const helper = await read('app/sales/sales-orders/sales-order-sku-local-cache.ts');

  assert.match(helper, /if \(cursor\) query\.set\('since', cursor\)/);
  assert.match(helper, /fetchCatalogSync\(memoryCursor\)/);
  assert.match(helper, /if \(!payload\.full\)/);
  assert.match(helper, /for \(const id of payload\.removeIds\) byId\.delete\(id\)/);
  assert.match(helper, /for \(const row of payload\.upserts\) byId\.set\(row\.id, row\)/);
  assert.doesNotMatch(helper, /CATALOG_REFRESH_MS|memorySavedAt|cache.*expired/i);
});

test('Khi local không thấy SKU thì rơi về backend search và đồng bộ lại catalog nền', async () => {
  const helper = await read('app/sales/sales-orders/sales-order-sku-local-cache.ts');
  const ui = await read('app/sales/sales-orders/sales-order-ui.ts');
  const missStart = helper.indexOf('const matches = searchSalesOrderSkuCatalog');
  const missEnd = helper.indexOf('return matches.map(toSearchOption) as T', missStart);
  assert.ok(missStart >= 0 && missEnd > missStart);
  const missFlow = helper.slice(missStart, missEnd);

  assert.match(missFlow, /if \(matches\.length === 0\) \{/);
  assert.match(missFlow, /void warmSalesOrderSkuCatalog\(true\)/);
  assert.match(missFlow, /return null/);
  assert.match(ui, /const cachedSkuSearch = await readSalesOrderSkuSearchCache<T>\(path, requestInit\)/);
  assert.match(ui, /if \(cachedSkuSearch !== null\) return cachedSkuSearch/);
  assert.match(ui, /const response = await fetch\(path/);
  assert.doesNotMatch(ui, /rememberSalesOrderSkuSearchRows/);
});

test('Tìm local giữ SKU, mã hàng, mọi barcode và tìm nhiều từ không dấu', async () => {
  const helper = await read('app/sales/sales-orders/sales-order-sku-local-cache.ts');

  assert.match(helper, /\.normalize\('NFD'\)/);
  assert.match(helper, /tokens\.every\(\(token\) => fields\.some\(\(field\) => field\.includes\(token\)\)\)/);
  assert.match(helper, /\.\.\.row\.barcodes/);
  assert.match(helper, /hasExactBarcode\(row, exact\)/);
  assert.match(helper, /toUpperCase\(\) === exact\) return 0/);
  assert.match(helper, /productCode \?\? ''\)\.toUpperCase\(\) === exact\) return 1/);
});

test('Catalog tự kiểm tra nền nhưng chỉ ghi IndexedDB khi rows hoặc cursor thật sự đổi', async () => {
  const helper = await read('app/sales/sales-orders/sales-order-sku-local-cache.ts');

  assert.match(helper, /scheduleNextSync/);
  assert.match(helper, /document\.visibilityState === 'visible'/);
  assert.match(helper, /const rowsChanged = !sameRows\(memoryRows, nextRows\)/);
  assert.match(helper, /const cursorChanged = memoryCursor !== payload\.cursor/);
  assert.match(helper, /if \(rowsChanged \|\| cursorChanged\) \{/);
});

test('Web proxy catalog dùng backend Công Ty và không đưa token xuống browser', async () => {
  const route = await read('app/api/products/sales-order-local-catalog/route.ts');

  assert.match(route, /requireNppWorkforceSessionToken/);
  assert.match(route, /CORE_API_INTERNAL_URL/);
  assert.match(route, /\/api\/products\/sales-order-local-catalog/);
  assert.match(route, /cache: 'no-store'/);
});

test('Tìm hàng local không còn debounce 200 ms; sản phẩm hiện trước giá và tồn', async () => {
  const form = await read('app/sales/sales-orders/SalesOrderCommercialForm.tsx');

  assert.match(form, /const SEARCH_DELAY_MS = 0;/);
  assert.match(form, /setSkuResults\(rows\.map\(withPendingSearchPreview\)\)/);
  assert.match(form, /\/api\/sales-orders\/sku-previews/);
  assert.match(form, /if \(!preview\) return \[\]/);
});
