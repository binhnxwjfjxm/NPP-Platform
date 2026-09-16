import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Kiểm kê kho nối trực tiếp nền nhập/xuất và lịch sử file hiện có', () => {
  const dock = read('app/inventory/stocktakes/StocktakePrintDock.tsx');
  const exchange = read('app/operations/data-exchange/data-exchange-view.tsx');
  const route = read('app/api/file-operations/[...segments]/route.ts');
  assert.match(dock, /\/operations\/data-exchange\?tab=stocktake/);
  assert.match(dock, /\/operations\/import-export-history/);
  assert.match(exchange, /Nhập số kiểm kê thực tế/);
  assert.match(exchange, /Chưa gửi duyệt, chưa ghi sổ tồn/);
  assert.match(route, /sanitizeStocktakeExport/);
  assert.match(route, /systemQuantity:\s*_hidden/);
});

test('Điều chỉnh hàng loạt có mẫu Excel và CSV thật qua nền bảng tính dùng chung', () => {
  const bulk = read('app/inventory/adjustments/bulk/bulk-workspace.tsx');
  assert.match(bulk, /exportTable/);
  assert.match(bulk, /downloadTemplate\('xlsx'\)/);
  assert.match(bulk, /downloadTemplate\('csv'\)/);
  assert.match(bulk, /Tải mẫu Excel/);
  assert.match(bulk, /Tải mẫu CSV/);
  assert.doesNotMatch(bulk, /Tải mẫu Excel\/CSV/);
  assert.match(bulk, /accept="\.xlsx,\.csv/);
  assert.match(bulk, /createIdempotencyKey\('inventory-adjustment-bulk'\)/);
});

test('Điều chỉnh tồn có màn xuất theo Trạng thái và Loại phiếu với cột nghiệp vụ', () => {
  const tabs = read('app/inventory/adjustments/adjustment-tabs.tsx');
  const workspace = read('app/inventory/adjustments/export/export-workspace.tsx');
  const model = read('lib/inventory-adjustment-export-model.ts');
  assert.match(tabs, /\/inventory\/adjustments\/export/);
  assert.match(workspace, /Trạng thái/);
  assert.match(workspace, /Loại phiếu/);
  assert.match(workspace, /Excel \(\.xlsx\)/);
  assert.match(workspace, /CSV \(\.csv\)/);
  assert.match(workspace, /column/);
  assert.match(model, /adjustmentNumber: 'Số phiếu'/);
  assert.match(model, /warehouseName: 'Kho'/);
  assert.doesNotMatch(model, /inventoryMovementId|reversalMovementId|correctionOfAdjustmentId/);
});

test('Route xuất Điều chỉnh lấy canonical list qua gateway, phân trang và không cắt âm thầm', () => {
  const route = read('app/api/inventory/adjustments/export/route.ts');
  assert.match(route, /listInventoryAdjustments/);
  assert.match(route, /PAGE_SIZE = 500/);
  assert.match(route, /offset/);
  assert.match(route, /MAX_EXPORT_ROWS/);
  assert.match(route, /ROW_LIMIT_EXCEEDED/);
  assert.match(route, /SCAN_LIMIT_EXCEEDED/);
  assert.match(route, /status/);
  assert.match(route, /documentKind/);
});

test('Route xuất Điều chỉnh whitelist định dạng/cột và tạo XLSX CSV an toàn', () => {
  const route = read('app/api/inventory/adjustments/export/route.ts');
  assert.match(route, /isInventoryAdjustmentExportColumnKey/);
  assert.match(route, /isInventoryAdjustmentStatus/);
  assert.match(route, /isInventoryAdjustmentKind/);
  assert.match(route, /createTabularXlsx/);
  assert.match(route, /guardCsvFormula/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /Cache-Control/);
  assert.match(route, /X-Content-Type-Options/);
});
