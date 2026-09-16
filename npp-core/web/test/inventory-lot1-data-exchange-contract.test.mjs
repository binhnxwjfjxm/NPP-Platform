import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Tồn đầu kỳ nhận Excel/CSV thật và dùng parser bảng tính dùng chung', () => {
  const workspace = read('app/inventory/opening-balances/opening-balance-csv-workspace.tsx');
  assert.match(workspace, /readSpreadsheetRows/);
  assert.match(workspace, /accept="\.xlsx,\.csv"/);
  assert.match(workspace, /Chỉ nhận tệp Excel \(\.xlsx\) hoặc CSV \(\.csv\)/);
  assert.match(workspace, /spreadsheet-upload-operator/);
  assert.doesNotMatch(workspace, /Chỉ nhận tệp CSV UTF-8/);
  assert.doesNotMatch(workspace, /csv-upload-operator/);
});

test('Tồn đầu kỳ dùng canonical Idempotency-Key và retry giữ đúng key của cùng thao tác', () => {
  const workspace = read('app/inventory/opening-balances/opening-balance-csv-workspace.tsx');
  assert.match(workspace, /createIdempotencyKey\('opening-balance-post'\)/);
  assert.match(workspace, /pendingPost = useRef<PendingMutation \| null>/);
  assert.match(workspace, /pendingPost\.current = pending/);
  assert.match(workspace, /headers: \{ 'Idempotency-Key': pending\.key \}/);
  assert.match(workspace, /body: pending\.body/);
  assert.doesNotMatch(workspace, /`opening-\$\{contentChecksum\}`/);
});

test('Nhập kho thủ công gắn xuất dữ liệu theo đúng bộ lọc lịch sử đang áp dụng', () => {
  const workspace = read('app/inventory/manual-inbounds/manual-inbound-workspace.tsx');
  const dialog = read('app/inventory/manual-inbounds/manual-inbound-export-dialog.tsx');
  assert.match(workspace, /ManualInboundExportDialog/);
  assert.match(workspace, /inboundType=\{historyType\}/);
  assert.match(workspace, /referenceNumber=\{historyReference\}/);
  assert.match(dialog, /query\.set\('inboundType', inboundType\)/);
  assert.match(dialog, /query\.set\('referenceNumber', referenceNumber\.trim\(\)\)/);
  assert.match(dialog, /không phụ thuộc 12 dòng đang hiển thị/);
});

test('Xuất lịch sử nhập kho hỗ trợ Excel, CSV, chọn cột và không lộ ID nội bộ', () => {
  const dialog = read('app/inventory/manual-inbounds/manual-inbound-export-dialog.tsx');
  const model = read('lib/manual-inbound-export-model.ts');
  assert.match(dialog, /Excel \(\.xlsx\)/);
  assert.match(dialog, /CSV \(\.csv\)/);
  assert.match(dialog, /Chọn tất cả/);
  assert.match(dialog, /Bỏ chọn/);
  assert.match(dialog, /Mặc định/);
  assert.match(model, /Ngày chứng từ/);
  assert.match(model, /Kho nhập/);
  assert.match(model, /Trạng thái/);
  assert.doesNotMatch(model, /['"](?:id|warehouseId|createdBy|updatedBy)['"]\s*:/);
});

test('Route xuất nhập kho lấy canonical history qua gateway, phân trang theo cap backend và không cắt âm thầm', () => {
  const route = read('app/api/inventory/manual-inbounds/export/route.ts');
  const gateway = read('lib/manual-inbound-operator-gateway.ts');
  assert.match(route, /searchManualInboundOperatorHistory<ManualInboundExportDocument\[]>/);
  assert.match(route, /PAGE_SIZE = 200/);
  assert.match(route, /MAX_EXPORT_ROWS/);
  assert.match(route, /MAX_SCAN_ROWS/);
  assert.match(route, /MANUAL_INBOUND_EXPORT_ROW_LIMIT_EXCEEDED/);
  assert.match(route, /MANUAL_INBOUND_EXPORT_SCAN_LIMIT_EXCEEDED/);
  assert.match(gateway, /limit = 100/);
  assert.match(gateway, /offset = 0/);
  assert.match(gateway, /query\.set\('offset', String\(offset\)\)/);
});

test('Route xuất whitelist cột/định dạng và tạo XLSX/CSV an toàn', () => {
  const route = read('app/api/inventory/manual-inbounds/export/route.ts');
  assert.match(route, /createTabularXlsx/);
  assert.match(route, /TABULAR_XLSX_MIME/);
  assert.match(route, /text\/csv; charset=utf-8/);
  assert.match(route, /isManualInboundExportColumnKey/);
  assert.match(route, /guardCsvFormula/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /Cache-Control/);
  assert.match(route, /X-Content-Type-Options/);
});
