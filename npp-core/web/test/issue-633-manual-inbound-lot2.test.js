import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = await readFile(new URL('../app/inventory/manual-inbounds/manual-inbound-workspace.tsx', import.meta.url), 'utf8');
const spreadsheet = await readFile(new URL('../lib/spreadsheet-reader.ts', import.meta.url), 'utf8');
const proxy = await readFile(new URL('../app/api/inventory/manual-inbounds/operator/[action]/route.ts', import.meta.url), 'utf8');
const gateway = await readFile(new URL('../lib/manual-inbound-operator-gateway.ts', import.meta.url), 'utf8');
const navigation = await readFile(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');

test('Nhập kho thủ công nằm trong Kho với ngôn ngữ nghiệp vụ', () => {
  assert.match(navigation, /\/inventory\/manual-inbounds/);
  assert.match(navigation, /Nhập kho thủ công/);
  assert.match(workspace, /Thông tin chứng từ/);
  assert.match(workspace, /Kho nhập/);
  assert.match(workspace, /Loại nhập/);
  assert.match(workspace, /Ngày chứng từ/);
  assert.match(workspace, /Số chứng từ \/ hóa đơn tham chiếu/);
});

test('Lô 2 hỗ trợ nhập trực tiếp và Excel xlsx/CSV nhưng chưa có thao tác ghi tồn', () => {
  assert.match(workspace, /SKU \*/);
  assert.match(workspace, /Số lượng \*/);
  assert.match(workspace, /Giá vốn/);
  assert.match(workspace, /accept="\.xlsx,\.csv"/);
  assert.match(spreadsheet, /DecompressionStream/);
  assert.match(spreadsheet, /xl\/workbook\.xml/);
  assert.match(workspace, /Kiểm tra dữ liệu/);
  assert.match(workspace, /Chưa làm thay đổi tồn kho/);
  assert.doesNotMatch(workspace, /XÁC NHẬN NHẬP/);
  assert.doesNotMatch(gateway, /Idempotency-Key/);
  assert.doesNotMatch(proxy, /Idempotency-Key/);
});

test('giao diện chỉ hỏi dữ liệu bổ sung sau kết quả kiểm tra', () => {
  const coreTable = workspace.indexOf('<thead><tr><th>#</th><th>SKU *</th><th>Số lượng *</th><th>Giá vốn</th>');
  const conditionalFields = workspace.indexOf("row.requiredFields.includes('LOCATION')");
  assert.ok(coreTable > 0 && conditionalFields > coreTable);
  for (const field of ["'LOCATION'", "'LOT'", "'EXPIRY'", "'COST'"]) assert.match(workspace, new RegExp(field));
  assert.match(workspace, /Đã gộp/);
});
