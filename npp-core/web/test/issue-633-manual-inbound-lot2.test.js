import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = await readFile(new URL('../app/inventory/manual-inbounds/manual-inbound-workspace.tsx', import.meta.url), 'utf8');
const spreadsheet = await readFile(new URL('../lib/spreadsheet-reader.ts', import.meta.url), 'utf8');
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

test('bảng hàng tách Tên sản phẩm, ĐVT và Số lượng thành các cột độc lập', () => {
  assert.match(workspace, /<th>SKU \*<\/th><th>Tên sản phẩm<\/th><th>ĐVT<\/th><th>Số lượng \*<\/th><th>Giá vốn<\/th>/);
  assert.match(workspace, /resolvedItems/);
  assert.match(workspace, /resolved\.productName/);
  assert.match(workspace, /resolved\.sourceUnitCode/);
  assert.doesNotMatch(workspace, /row\.sourceQuantity\}\{row\.sourceUnitCode/);
});

test('preview dùng bảng nghiệp vụ rõ cột và phân biệt dữ liệu cần bổ sung với lỗi cấu hình', () => {
  assert.match(workspace, /<th>SKU<\/th><th>Tên sản phẩm<\/th><th>ĐVT<\/th><th>Số lượng<\/th><th>Kho<\/th><th>Vị trí<\/th><th>Lô<\/th><th>HSD<\/th><th>Giá vốn<\/th><th>Trạng thái<\/th>/);
  assert.match(workspace, /Cần quản trị/);
  assert.match(workspace, /Cần bổ sung/);
  assert.match(workspace, /Cần chỉnh/);
  assert.match(workspace, /dòng cần xử lý/);
});

test('Lô 2 vẫn giữ bước nhập trực tiếp và Excel xlsx\/CSV trước khi ghi tồn', () => {
  assert.match(workspace, /accept="\.xlsx,\.csv"/);
  assert.match(spreadsheet, /DecompressionStream/);
  assert.match(spreadsheet, /xl\/workbook\.xml/);
  assert.match(workspace, /Kiểm tra dữ liệu/);
  assert.match(workspace, /Chưa làm thay đổi tồn kho/);
});

test('giao diện chỉ hỏi dữ liệu bổ sung sau kết quả kiểm tra', () => {
  const coreTable = workspace.indexOf('<thead><tr><th>#</th><th>SKU *</th><th>Tên sản phẩm</th><th>ĐVT</th><th>Số lượng *</th><th>Giá vốn</th>');
  const conditionalFields = workspace.indexOf("row.requiredFields.includes('LOCATION')");
  assert.ok(coreTable > 0 && conditionalFields > coreTable);
  for (const field of ["'LOCATION'", "'LOT'", "'EXPIRY'", "'COST'"]) assert.match(workspace, new RegExp(field));
  assert.match(workspace, /Đã gộp/);
});
