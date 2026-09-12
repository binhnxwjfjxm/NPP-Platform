import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Báo cáo bán hàng mở cửa sổ xuất theo đúng chiều và bộ lọc đã áp dụng', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  assert.match(workspace, /SalesReportingExportDialog/);
  assert.match(workspace, /dimension=\{activeDimension\}/);
  assert.match(workspace, /filters=\{applied\}/);
});

test('Cửa sổ xuất có Excel, CSV, chọn tất cả, bỏ chọn và cột mặc định', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');
  assert.match(dialog, /Excel \(\.xlsx\)/);
  assert.match(dialog, /CSV \(\.csv\)/);
  assert.match(dialog, /Chọn tất cả/);
  assert.match(dialog, /Bỏ chọn/);
  assert.match(dialog, /Mặc định/);
  assert.match(dialog, /DEFAULT_COLUMNS/);
  assert.match(dialog, /COLUMN_OPTIONS/);
  assert.match(dialog, /selectedColumns\.length === 0/);
  assert.match(
    dialog,
    /products: Object\.freeze\(\['code', 'name', 'currencyCode', 'unitName', 'quantity', 'revenue'/,
  );
});

test('Trình duyệt chỉ yêu cầu file từ server, không tự dựng CSV/XLSX từ dòng đang hiển thị', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');
  assert.match(dialog, /\/api\/reporting\/sales\/export/);
  assert.match(dialog, /query\.append\('column', key\)/);
  assert.match(dialog, /from: filters\.from/);
  assert.match(dialog, /to: filters\.to/);
  assert.match(dialog, /query\.set\('warehouseId', filters\.warehouseId\)/);
  assert.match(dialog, /response\.blob\(\)/);
  assert.doesNotMatch(dialog, /join\(','\)|buildMultiSheetXlsx|report\.breakdowns/);
  assert.match(dialog, /không phụ thuộc số dòng đang hiển thị/);
});

test('Proxy export giữ session server-side và chỉ chấp nhận XLSX/CSV từ Công Ty API', () => {
  const gateway = read('lib/sales-reporting-export-gateway.ts');
  const route = read('app/api/reporting/sales/export/route.ts');
  assert.match(gateway, /import 'server-only'/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.match(gateway, /\/api\/reporting\/sales-export/);
  assert.match(gateway, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(gateway, /text\/csv/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /Cache-Control/);
  assert.doesNotMatch(gateway + route, /sales-profit/);
});
