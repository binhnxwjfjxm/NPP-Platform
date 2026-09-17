import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Admin giữ nguyên các mục báo cáo cũ và chỉ thêm bộ lọc nhóm vào đúng mục', () => {
  const workspace = read('app/reports/business/business-report-workspace.tsx');

  for (const label of ['Khách hàng', 'Loại khách', 'Kênh bán', 'Sản phẩm', 'Nhóm hàng', 'Nhân viên bán hàng']) {
    assert.match(workspace, new RegExp(label));
  }

  assert.match(workspace, /selectedDimension === 'customers'/);
  assert.match(workspace, /Lọc khách hàng theo nhóm/);
  assert.match(workspace, /name="customerGroupId"/);
  assert.match(workspace, /selectedDimension === 'products'/);
  assert.match(workspace, /Lọc sản phẩm theo nhóm/);
  assert.match(workspace, /name="productGroupId"/);
  assert.match(workspace, /name="includeZeroProducts"/);

  assert.doesNotMatch(workspace, /Sản lượng sản phẩm theo nhóm khách hàng/);
  assert.doesNotMatch(workspace, /matrixExportHref/);
  assert.doesNotMatch(workspace, /classificationFilters/);
});

test('Admin dùng total canonical ở cuối bảng cũ, kể cả giao diện điện thoại', () => {
  const data = read('app/reports/business-report-data.ts');
  const workspace = read('app/reports/business/business-report-workspace.tsx');
  const styles = read('app/reports/business/business-workspace.module.css');

  assert.match(data, /breakdownTotals:/);
  assert.match(data, /record\(data\.breakdownTotals\)/);
  assert.match(workspace, /report\.breakdownTotals\[selectedDimension\]/);
  assert.match(workspace, /<tfoot>/);
  assert.match(workspace, /styles\.totalRow/);
  assert.match(workspace, /styles\.mobileTotals/);
  assert.match(styles, /\.totalRow/);
  assert.match(styles, /\.mobileTotals/);
});

test('Admin chỉ giữ bộ lọc phù hợp khi đổi kỳ, đổi mục và xuất Excel', () => {
  const workspace = read('app/reports/business/business-report-workspace.tsx');
  const exportRoute = read('app/reports/export/route.ts');

  assert.match(workspace, /targetView === 'customers'/);
  assert.match(workspace, /targetView === 'products'/);
  assert.match(workspace, /selectedDimension === 'customers'.*exportQuery\.set\('customerGroupId'/s);
  assert.match(workspace, /selectedDimension === 'products'.*exportQuery\.set\('productGroupId'/s);
  assert.match(workspace, /selectedDimension === 'products'.*exportQuery\.set\('includeZeroProducts', 'true'\)/s);

  for (const field of ['productGroupId', 'customerGroupId', 'includeZeroProducts']) {
    assert.match(exportRoute, new RegExp(field));
  }
});

test('Không còn route hoặc UI xuất ma trận riêng', () => {
  const page = read('app/reports/business/page.tsx');
  const workspace = read('app/reports/business/business-report-workspace.tsx');
  const routePath = new URL('../app/reports/business/matrix-export/route.ts', import.meta.url);

  assert.equal(existsSync(routePath), false);
  assert.doesNotMatch(page + workspace, /matrix-export|Xuất bảng phân loại|productCustomerMatrix/);
});

test('Sửa UI báo cáo không thêm DB hoặc migration', () => {
  const data = read('app/reports/business-report-data.ts');
  const page = read('app/reports/business/page.tsx');
  const workspace = read('app/reports/business/business-report-workspace.tsx');

  assert.doesNotMatch(data + page + workspace, /CREATE TABLE|ALTER TABLE|database\/migrations|DATABASE_URL/);
});
