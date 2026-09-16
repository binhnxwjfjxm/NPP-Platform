import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Màn Lãi gộp xuất theo đúng kỳ/kho đã áp dụng và cho chọn nội dung/cột', () => {
  const workspace = source('../app/components/gross-margin-reporting-workspace.tsx');
  const dialog = source('../app/components/gross-margin-reporting-export-dialog.tsx');
  assert.match(workspace, /GrossMarginReportingExportDialog/);
  assert.match(workspace, /from: report\.filters\.from/);
  assert.match(workspace, /to: report\.filters\.to/);
  assert.match(workspace, /warehouseId: report\.filters\.warehouseId \?\? ''/);
  assert.match(dialog, /customers: 'Theo khách hàng'/);
  assert.match(dialog, /skus: 'Theo SKU'/);
  assert.match(dialog, /lines: 'Chi tiết dòng'/);
  assert.match(dialog, /exceptions: 'Ngoại lệ'/);
  assert.match(dialog, /Chọn tất cả/);
  assert.match(dialog, /Bỏ chọn/);
  assert.match(dialog, /Mặc định/);
  assert.match(dialog, /Excel \(\.xlsx\)/);
  assert.match(dialog, /CSV \(\.csv\)/);
  assert.match(dialog, /\/api\/reporting\/gross-margin\/export/);
});

test('Proxy xuất lãi gộp giữ session server-side và chỉ nhận file Excel/CSV', () => {
  const gateway = source('../lib/gross-margin-reporting-export-gateway.ts');
  const route = source('../app/api/reporting/gross-margin/export/route.ts');
  assert.match(gateway, /import 'server-only'/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.match(gateway, /\/api\/reporting\/gross-margin-export/);
  assert.match(gateway, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(gateway, /text\/csv/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /X-Content-Type-Options/);
});

test('Màn Lãi gộp dùng ngôn ngữ văn phòng trong phạm vi được chạm', () => {
  const workspace = source('../app/components/gross-margin-reporting-workspace.tsx');
  assert.doesNotMatch(workspace, /Phase 7|cost fact|lineage/i);
  assert.match(workspace, /Giá vốn/);
});
