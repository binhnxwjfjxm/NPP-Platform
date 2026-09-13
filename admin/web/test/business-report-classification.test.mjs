import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Admin Báo cáo Kinh doanh dùng cùng bộ lọc phân loại canonical với Công Ty', () => {
  const data = read('app/reports/business-report-data.ts');
  const page = read('app/reports/business/page.tsx');

  for (const field of ['productGroupId', 'customerGroupId', 'includeZeroProducts']) {
    assert.match(data, new RegExp(field));
    assert.match(page, new RegExp(field));
  }

  assert.match(data, /\/api\/reporting\/sales\?/);
  assert.match(data, /classificationOf\(data\.classification\)/);
  assert.match(page, /Tất cả nhóm sản phẩm/);
  assert.match(page, /Tất cả nhóm khách hàng/);
  assert.match(page, /Hiện sản phẩm không phát sinh/);
  assert.match(page, /method="get"/);
});

test('Admin hiển thị ma trận Sản phẩm × Nhóm khách với tổng và tỷ lệ tách theo ĐVT', () => {
  const page = read('app/reports/business/page.tsx');
  const styles = read('app/reports/business/business-workspace.module.css');

  assert.match(page, /Sản lượng sản phẩm theo nhóm khách hàng/);
  assert.match(page, /matrix\.columns\.map/);
  assert.match(page, /matrix\.rows\.map/);
  assert.match(page, /matrix\.totalsByUnit\.flatMap/);
  assert.match(page, /Tổng \{total\.unit\.name/);
  assert.match(page, /Tỷ lệ \{total\.unit\.name/);
  assert.match(page, /Không phát sinh/);
  assert.match(page, /decimalText\(row\.totalQuantity\)/);
  assert.match(page, /percentText\(cell\.sharePercent\)/);
  assert.match(styles, /\.matrixTableWrap/);
  assert.match(styles, /\.classificationFilters/);
});

test('Admin giữ bộ lọc khi đổi kỳ, đổi chiều, mở chi tiết và xuất báo cáo', () => {
  const page = read('app/reports/business/page.tsx');
  const exportRoute = read('app/reports/export/route.ts');

  assert.match(page, /keepClassification = true/);
  assert.match(page, /report\.filters\.productGroupId/);
  assert.match(page, /report\.filters\.customerGroupId/);
  assert.match(page, /report\.filters\.includeZeroProducts/);
  assert.match(page, /exportQuery\.set\('productGroupId'/);
  assert.match(page, /exportQuery\.set\('customerGroupId'/);
  assert.match(page, /exportQuery\.set\('includeZeroProducts', 'true'\)/);

  for (const field of ['productGroupId', 'customerGroupId', 'includeZeroProducts']) {
    assert.match(exportRoute, new RegExp(field));
  }
});

test('Admin xuất bảng phân loại dùng đúng Sales export canonical, không tự dựng Excel trong frontend', () => {
  const page = read('app/reports/business/page.tsx');
  const route = read('app/reports/business/matrix-export/route.ts');
  const download = read('lib/core-download.ts');

  assert.match(page, /\/reports\/business\/matrix-export/);
  assert.match(route, /dimension: 'productCustomerMatrix'/);
  assert.match(route, /format: 'xlsx'/);
  assert.match(route, /requestCoreSalesReportDownload/);
  assert.match(route, /\/api\/reporting\/sales-export/);
  assert.match(download, /SALES_EXPORT_PATH = '\/api\/reporting\/sales-export'/);
  assert.doesNotMatch(page + route, /buildMultiSheetXlsx|writeWorksheet|createWriteStream/);
});

test('Lô 3 chỉ nối Admin vào contract hiện có, không thêm DB hoặc migration', () => {
  const data = read('app/reports/business-report-data.ts');
  const page = read('app/reports/business/page.tsx');
  const route = read('app/reports/business/matrix-export/route.ts');

  assert.doesNotMatch(data + page + route, /CREATE TABLE|ALTER TABLE|database\/migrations|DATABASE_URL/);
  assert.match(page, /Nhóm khách hàng/);
  assert.match(page, /Nhóm sản phẩm/);
  assert.doesNotMatch(page, /Loại khách|Nhóm hàng/);
});
