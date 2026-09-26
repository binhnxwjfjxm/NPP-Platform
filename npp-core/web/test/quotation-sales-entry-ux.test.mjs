import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const workspace = fs.readFileSync(path.join(root, 'app/sales/quotations/quotation-workspace.tsx'), 'utf8');

test('Báo giá chọn khách trực tiếp từ ô tìm kiếm, không dùng hai thanh nối tiếp', () => {
  assert.match(workspace, /data-testid="quotation-customer-search"/);
  assert.match(workspace, /data-testid="quotation-customer-results"/);
  assert.match(workspace, /onClick=\{\(\) => selectCustomer\(customer\)\}/);
  assert.match(workspace, /data-testid="quotation-selected-customer"/);
  assert.doesNotMatch(workspace, /<select value=\{customerId\}/);
});

test('Theo mã hàng dùng đúng contract tìm SKU của màn Ra đơn và chọn nhiều hàng', () => {
  assert.match(workspace, /MIN_PRODUCT_SEARCH_LENGTH/);
  assert.match(workspace, /\/api\/sales-orders\/sku-search/);
  assert.match(workspace, /Tên sản phẩm, mã hàng, SKU hoặc barcode/);
  assert.match(workspace, /data-testid="quotation-sku-results"/);
  assert.match(workspace, /data-testid="quotation-selected-skus"/);
  assert.match(workspace, /addSelectedSku\(option\)/);
  assert.match(workspace, /removeSelectedSku\(item\.id\)/);
  assert.doesNotMatch(workspace, /<textarea[^>]*value=\{skuInput\}/);
});

test('Bảng báo giá cho sửa đơn giá tại chỗ nhưng không ghi ngược bảng giá Công Ty', () => {
  assert.match(workspace, /aria-label=\{\`Đơn giá \\?\$\{row\.sku\}\`\}/);
  assert.match(workspace, /updateManualPrice\(row\.sku, event\.target\.value\)/);
  assert.match(workspace, /Giá chỉnh trên báo giá/);
  assert.match(workspace, /useSystemPrice\(row\.sku\)/);
  assert.match(workspace, /effectiveLineTotal\(row\)/);
  assert.match(workspace, /row\.manualPrice \? 'Giá chỉnh trên báo giá' : row\.priceListCode/);
  assert.match(workspace, /không thay đổi bảng giá Công Ty/);
  assert.match(workspace, /\/api\/file-operations\/quotation/);
});
