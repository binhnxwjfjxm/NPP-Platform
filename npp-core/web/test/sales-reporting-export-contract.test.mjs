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

test('Cửa sổ xuất danh sách giữ Excel, CSV và chọn cột như cũ', () => {
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

test('Cửa sổ phân tích dùng ngôn ngữ văn phòng, chọn rõ số liệu và đúng 2 tiêu chí', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');
  assert.match(dialog, /value="analysis"/);
  assert.match(dialog, /> Phân tích</);
  assert.match(dialog, /Số liệu cần xuất/);
  assert.match(dialog, /Phân tích theo · chọn 2/);
  assert.match(dialog, /products: 'Sản phẩm'/);
  assert.match(dialog, /customerGroups: 'Loại khách'/);
  assert.match(dialog, /channels: 'Kênh bán'/);
  assert.match(dialog, /productGroups: 'Nhóm hàng'/);
  assert.match(dialog, /revenue: 'Doanh thu'/);
  assert.match(dialog, /quantity: 'Sản lượng'/);
  assert.match(dialog, /analysisMetrics\.length === 2 \? 'both'/);
  assert.doesNotMatch(dialog, />\s*Ma trận\s*</);
  assert.doesNotMatch(dialog, /Xuất Excel ma trận/);
  assert.doesNotMatch(dialog, /Tiêu chí dòng|Tiêu chí cột|Chỉ tiêu/);
});

test('Cửa sổ phân tích hiện trước đúng cột xuất và cho bỏ từng cột', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');
  assert.match(dialog, /Cột sẽ xuất/);
  assert.match(dialog, /analysisColumnOptions/);
  assert.match(dialog, /analysisSelectedColumns/);
  assert.match(dialog, /toggleAnalysisColumn/);
  assert.match(dialog, /cat:\$\{category\.key\}\|revenue/);
  assert.match(dialog, /cat:\$\{category\.key\}\|quantity/);
  assert.match(dialog, /total:revenue:/);
  assert.match(dialog, /total:quantity/);
  assert.match(dialog, /Tổng doanh thu/);
  assert.match(dialog, /Tổng sản lượng/);
});

test('ĐVT là cột trong cùng sheet, không còn hướng dẫn tách sheet theo ĐVT', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');
  assert.match(dialog, /ĐVT nằm trong cùng một sheet/);
  assert.match(dialog, /không tách báo cáo thành nhiều sheet theo đơn vị tính/);
  assert.doesNotMatch(dialog, /Sản lượng được tách riêng theo ĐVT/);
});

test('Cửa sổ xuất bán hàng luôn thoát khỏi topbar và nằm gọn trong viewport', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');
  const css = read('app/components/sales-reporting-export-dialog.module.css');
  const shellCss = read('app/components/app-shell.module.css');

  assert.match(shellCss, /\.topbar\s*\{[\s\S]*?backdrop-filter:\s*blur\(/);
  assert.match(dialog, /import \{ createPortal \} from 'react-dom'/);
  assert.match(dialog, /createPortal\([\s\S]*?document\.body/);
  assert.match(css, /\.backdrop\s*\{[\s\S]*?place-items:\s*center/);
  assert.match(css, /\.dialog\s*\{[\s\S]*?box-sizing:\s*border-box/);
  assert.match(css, /max-height:\s*min\(760px,\s*calc\(100dvh - 40px\)\)/);
  assert.match(css, /overscroll-behavior:\s*contain/);
});

test('Phân tích lấy danh sách cột từ báo cáo server theo đúng bộ lọc rồi gửi các cột được tích', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');
  const gateway = read('lib/sales-reporting-export-gateway.ts');

  assert.match(dialog, /requestAnalysisReport\(filters\)/);
  assert.match(dialog, /\/api\/reporting\/sales/);
  assert.match(dialog, /query\.set\('productGroupId', filters\.productGroupId\)/);
  assert.match(dialog, /query\.set\('customerGroupId', filters\.customerGroupId\)/);
  assert.match(dialog, /mode === 'analysis'/);
  assert.match(dialog, /analysisSelectedColumns/);
  assert.match(dialog, /query\.append\('column', key\)/);
  for (const field of ['productGroupId', 'customerGroupId', 'includeZeroProducts', 'dimension', 'format', 'column']) {
    assert.match(gateway, new RegExp(field));
  }
});

test('Trình duyệt vẫn nhận file từ server, không tự dựng CSV/XLSX trong component', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');
  assert.match(dialog, /\/api\/reporting\/sales\/export/);
  assert.match(dialog, /from: filters\.from/);
  assert.match(dialog, /to: filters\.to/);
  assert.match(dialog, /query\.set\('warehouseId', filters\.warehouseId\)/);
  assert.match(dialog, /response\.blob\(\)/);
  assert.doesNotMatch(dialog, /join\(','\)|buildMultiSheetXlsx/);
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
