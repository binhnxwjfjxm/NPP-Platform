import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Admin giữ nguyên các mục báo cáo cũ và chỉ thêm bộ lọc nhóm vào đúng mục', () => {
  const page = read('app/reports/business/page.tsx');

  for (const label of ['Khách hàng', 'Loại khách', 'Kênh bán', 'Sản phẩm', 'Nhóm hàng', 'Nhân viên bán hàng']) {
    assert.match(page, new RegExp(label));
  }

  assert.match(page, /selectedDimension === 'customers'/);
  assert.match(page, /Lọc khách hàng theo nhóm/);
  assert.match(page, /name="customerGroupId"/);
  assert.match(page, /selectedDimension === 'products'/);
  assert.match(page, /Lọc sản phẩm theo nhóm/);
  assert.match(page, /name="productGroupId"/);
  assert.match(page, /name="includeZeroProducts"/);

  assert.doesNotMatch(page, /Sản lượng sản phẩm theo nhóm khách hàng/);
  assert.doesNotMatch(page, /matrixExportHref/);
  assert.doesNotMatch(page, /classificationFilters/);
});

test('Admin dùng total canonical ở cuối bảng cũ, kể cả giao diện điện thoại', () => {
  const data = read('app/reports/business-report-data.ts');
  const page = read('app/reports/business/page.tsx');
  const styles = read('app/reports/business/business-workspace.module.css');

  assert.match(data, /breakdownTotals:/);
  assert.match(data, /record\(data\.breakdownTotals\)/);
  assert.match(page, /report\.breakdownTotals\[selectedDimension\]/);
  assert.match(page, /<tfoot>/);
  assert.match(page, /styles\.totalRow/);
  assert.match(page, /styles\.mobileTotals/);
  assert.match(styles, /\.totalRow/);
  assert.match(styles, /\.mobileTotals/);
});

test('Admin chỉ giữ bộ lọc phù hợp khi đổi kỳ, đổi mục và xuất Excel', () => {
  const page = read('app/reports/business/page.tsx');
  const exportRoute = read('app/reports/export/route.ts');

  assert.match(page, /targetView === 'customers'/);
  assert.match(page, /targetView === 'products'/);
  assert.match(page, /selectedDimension === 'customers'.*exportQuery\.set\('customerGroupId'/s);
  assert.match(page, /selectedDimension === 'products'.*exportQuery\.set\('productGroupId'/s);
  assert.match(page, /selectedDimension === 'products'.*exportQuery\.set\('includeZeroProducts', 'true'\)/s);

  for (const field of ['productGroupId', 'customerGroupId', 'includeZeroProducts']) {
    assert.match(exportRoute, new RegExp(field));
  }
});

test('Không còn route hoặc UI xuất ma trận riêng', () => {
  const page = read('app/reports/business/page.tsx');
  const routePath = new URL('../app/reports/business/matrix-export/route.ts', import.meta.url);

  assert.equal(existsSync(routePath), false);
  assert.doesNotMatch(page, /matrix-export|Xuất bảng phân loại|productCustomerMatrix/);
});

test('Sửa UI báo cáo không thêm DB hoặc migration', () => {
  const data = read('app/reports/business-report-data.ts');
  const page = read('app/reports/business/page.tsx');

  assert.doesNotMatch(data + page, /CREATE TABLE|ALTER TABLE|database\/migrations|DATABASE_URL/);
});
