import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Đơn mua hàng mở xuất dữ liệu với đúng tìm kiếm và trạng thái đang áp dụng', () => {
  const workspace = read('app/purchasing/purchase-orders/PurchaseOrderWorkspace.tsx');
  assert.match(workspace, /PurchaseOrderExportDialog/);
  assert.match(workspace, /search=\{search\}/);
  assert.match(workspace, /status=\{statusFilter\}/);
  assert.match(workspace, /buttonClassName=\{shellStyles\.actionButton\}/);
  assert.doesNotMatch(workspace, /kho nhận hoặc mã hàng…/);
});

test('Cửa sổ xuất hỗ trợ Excel, CSV và chọn cột theo ngôn ngữ vận hành', () => {
  const dialog = read('app/purchasing/purchase-orders/components/PurchaseOrderExportDialog.tsx');
  const model = read('lib/purchase-order-export-model.ts');
  assert.match(dialog, /Excel \(\.xlsx\)/);
  assert.match(dialog, /CSV \(\.csv\)/);
  assert.match(dialog, /Chọn tất cả/);
  assert.match(dialog, /Bỏ chọn/);
  assert.match(dialog, /Mặc định/);
  assert.match(dialog, /PURCHASE_ORDER_EXPORT_DEFAULT_COLUMNS/);
  assert.match(model, /Số đơn/);
  assert.match(model, /Nhà cung cấp/);
  assert.match(model, /Kho nhận/);
  assert.match(model, /Tổng giá trị/);
  assert.doesNotMatch(model, /['"](?:id|supplierId|warehouseId|createdBy|updatedBy)['"]\s*:/);
});

test('Trình duyệt chỉ tải file do server tạo, không dựng file từ danh sách đang hiển thị', () => {
  const dialog = read('app/purchasing/purchase-orders/components/PurchaseOrderExportDialog.tsx');
  assert.match(dialog, /\/api\/purchase-orders\/export/);
  assert.match(dialog, /query\.set\('search', search\.trim\(\)\)/);
  assert.match(dialog, /query\.set\('status', status\)/);
  assert.match(dialog, /query\.append\('column', key\)/);
  assert.match(dialog, /response\.blob\(\)/);
  assert.match(dialog, /không phụ thuộc số dòng đang hiển thị/);
  assert.doesNotMatch(dialog, /visibleItems|purchaseOrders\.map\(.*join\(','\)/s);
});

test('Route export lấy dữ liệu canonical qua gateway, phân trang và không cắt âm thầm', () => {
  const route = read('app/api/purchase-orders/export/route.ts');
  assert.match(route, /listPurchaseOrders<PurchaseOrder>/);
  assert.match(route, /PAGE_SIZE = 1000/);
  assert.match(route, /MAX_EXPORT_ROWS/);
  assert.match(route, /MAX_SCAN_ROWS/);
  assert.match(route, /PURCHASE_ORDER_EXPORT_ROW_LIMIT_EXCEEDED/);
  assert.match(route, /PURCHASE_ORDER_EXPORT_SCAN_LIMIT_EXCEEDED/);
  assert.match(route, /matchesSearch/);
  assert.match(route, /warehouseCode/);
  assert.match(route, /warehouseName/);
});

test('Route export whitelist định dạng và cột, tạo XLSX/CSV an toàn', () => {
  const route = read('app/api/purchase-orders/export/route.ts');
  assert.match(route, /createTabularXlsx/);
  assert.match(route, /TABULAR_XLSX_MIME/);
  assert.match(route, /text\/csv; charset=utf-8/);
  assert.match(route, /isPurchaseOrderExportColumnKey/);
  assert.match(route, /guardCsvFormula/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /Cache-Control/);
  assert.match(route, /X-Content-Type-Options/);
});
