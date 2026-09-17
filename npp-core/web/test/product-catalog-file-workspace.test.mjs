import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const updaterPath = new URL('../app/products/product-bulk-update-workspace.tsx', import.meta.url);
const importerPath = new URL('../app/products/product-import-workspace.tsx', import.meta.url);
const backendPath = new URL('../../api/src/services/product-bulk-update.js', import.meta.url);
const expandedBackendPath = new URL('../../api/src/services/product-bulk-update-expanded.js', import.meta.url);

test('Danh mục sản phẩm là nơi làm việc trực tiếp cho Nhập sản phẩm và Cập nhật sản phẩm', async () => {
  const updater = await readFile(updaterPath, 'utf8');
  const importer = await readFile(importerPath, 'utf8');

  assert.match(updater, /Nhập \/ cập nhật sản phẩm/);
  assert.match(updater, />Nhập sản phẩm<\/button>/);
  assert.match(updater, />Cập nhật sản phẩm<\/button>/);
  assert.match(updater, /<ProductImportWorkspace/);
  assert.match(importer, /buildDataExchangeImportActions/);
  assert.match(importer, /DataExchangeImportPreview/);
  assert.match(importer, /prepareImport\('products', file\)/);
  assert.doesNotMatch(importer, /href=["']\/operations\/data-exchange/);
  assert.doesNotMatch(updater, /href=["']\/operations\/data-exchange/);
});

test('Cập nhật sản phẩm mở đủ nhóm thuộc tính và tự nhận tiêu đề Loại sản phẩm', async () => {
  const updater = await readFile(updaterPath, 'utf8');

  for (const mapping of [
    'PRODUCT_NAME', 'CATALOG_NAME', 'CATEGORY_CODE', 'BRAND_CODE', 'DESCRIPTION', 'NOTES',
    'PRODUCT_CATALOG_VISIBLE', 'PRODUCT_ORDERABLE', 'PRODUCT_INVENTORY_MANAGED', 'PRODUCT_ACTIVE',
    'VARIANT_NAME', 'VARIANT_KIND', 'INVENTORY_BASE', 'SELLABLE', 'VARIANT_CATALOG_VISIBLE', 'VARIANT_ACTIVE',
    'UNIT_CODE', 'CONVERSION_TO_BASE', 'PURCHASABLE', 'NET_CONTENT_VALUE', 'NET_CONTENT_UOM',
    'SOURCE_UNIT_LABEL', 'SOURCE_PACKAGE_DESCRIPTION', 'WEIGHT_VALUE', 'WEIGHT_UOM',
  ]) assert.match(updater, new RegExp(`'${mapping}'`));

  assert.match(updater, /\['LOAI SAN PHAM', 'CATEGORY_CODE'\]/);
  assert.match(updater, /initialMappings\(columns, rows\[0\] \?\? \[\], skipFirst\)/);
  assert.match(updater, /Cột 1 luôn là SKU/);
  assert.match(updater, /Một thuộc tính chỉ được chọn cho một cột/);
  assert.match(updater, /SKU hoặc dòng lỗi được báo và bỏ qua/);
});

test('Backend cập nhật hàng loạt giữ lỗi theo dòng, mở trần đủ file hiện tại và dùng service chuẩn', async () => {
  const backend = await readFile(backendPath, 'utf8');
  const expanded = await readFile(expandedBackendPath, 'utf8');

  assert.match(backend, /const MAX_ROWS = 5000/);
  assert.match(backend, /EXTENDED_PRODUCT_UPDATE_MAPPINGS/);
  assert.match(expanded, /productCrudService\.updateProduct/);
  assert.match(expanded, /productService\.updateProductVariant/);
  assert.match(expanded, /productUnitService\.assignVariantUnit/);
  assert.match(expanded, /SAVEPOINT/);
  assert.match(expanded, /ROW_UPDATE_CONFLICT/);
  assert.match(expanded, /SKU không tồn tại; dòng này sẽ được bỏ qua/);
});
