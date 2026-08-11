import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const preview = read('app/operations/data-exchange/data-exchange-preview.tsx');
const actions = read('app/operations/data-exchange/data-exchange-import-actions.ts');

test('product import preview keeps identity visible and combines product/SKU settings in one table', () => {
  assert.match(preview, /Tên sản phẩm/);
  assert.match(preview, /Tên SKU \/ quy cách/);
  assert.match(preview, /Phân loại sản phẩm/);
  assert.match(preview, /Kho & truy xuất/);
  assert.match(preview, /Hiển thị sản phẩm/);
  assert.match(preview, /Cho bán SKU/);
  assert.doesNotMatch(preview, /choiceDetails/);
});

test('product import supports bulk selection without requiring operators to remember row numbers or codes', () => {
  assert.match(preview, /data-testid="product-import-bulk-editor"/);
  assert.match(preview, /Thiết lập hàng loạt/);
  assert.match(preview, /Mở rộng cùng Mã SP/);
  assert.match(preview, /Đơn vị lẻ/);
  assert.match(preview, /Thùng/);
  assert.match(preview, /Áp dụng cho \{selected\.size \|\| 0\} dòng/);
  assert.match(preview, /item\.name} — \{item\.code/);
  assert.match(preview, /unit\.name} — \{unit\.code/);
});

test('product-level edits synchronize all SKU rows for the same product', () => {
  assert.match(preview, /function productIndices/);
  assert.match(preview, /upper\(row\.productCode\) === code/);
  assert.match(preview, /function setProductField/);
  assert.match(preview, /PRODUCT_FIELDS\.has\(bulkField\)/);
  assert.match(preview, /codes\.has\(upper\(row\.productCode\)\)/);
});

test('category and brand errors are rejected before import with operator-facing messages', () => {
  assert.match(actions, /\/api\/product-categories\?limit=1000/);
  assert.match(actions, /\/api\/product-brands\?limit=1000/);
  assert.match(actions, /Loại sản phẩm “\$\{categoryCode\}” không tồn tại/);
  assert.match(actions, /Nhãn hàng “\$\{brandCode\}” không tồn tại/);
  assert.match(actions, /begin\(\);\s*try \{\s*const \[categories, brands\] = await Promise\.all/);
  assert.match(actions, /validateProductRows\(rows, categories, brands\)/);
  assert.match(actions, /catch \(cause\) \{ fail\(cause\); \} finally \{ setBusy\(false\); \}/);
});
