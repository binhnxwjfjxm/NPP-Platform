import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const shell = read('../app/components/app-shell.tsx');
const action = read('../app/inventory/inventory-export-action.tsx');
const route = read('../app/api/inventory/export/route.ts');
const model = read('../lib/inventory-data-export-model.ts');

test('Lô Kho 3 chỉ gắn xuất dữ liệu vào ba màn đã audit', () => {
  assert.match(shell, /pathname === '\/inventory\/balances'/);
  assert.match(shell, /pathname === '\/inventory\/lots'/);
  assert.match(shell, /pathname === '\/inventory\/tracking-policies'/);
  assert.match(shell, /<InventoryExportAction scope=\{exportScope\}/);
  assert.doesNotMatch(shell, /pathname === '\/inventory\/adjustments'/);
  assert.doesNotMatch(shell, /pathname === '\/inventory\/stocktakes'/);
});

test('hộp xuất dùng Excel CSV, lấy tìm kiếm hiện tại và để server tạo file', () => {
  assert.match(action, /Excel \(\.xlsx\)/);
  assert.match(action, /CSV \(\.csv\)/);
  assert.match(action, /inventory-balances-search-input/);
  assert.match(action, /inventory-lots-search-input/);
  assert.match(action, /Tìm SKU bất kỳ, SKU tồn chuẩn hoặc tên hàng/);
  assert.match(action, /query\.append\('column', column\)/);
  assert.match(action, /fetch\(`\/api\/inventory\/export\?\$\{query\.toString\(\)\}`/);
  assert.doesNotMatch(action, /createTabularXlsx/);
});

test('route xuất lấy canonical inventory data qua gateway và không cắt âm thầm', () => {
  assert.match(route, /listAllInventoryBalances/);
  assert.match(route, /listAllInventoryLots/);
  assert.match(route, /listAllInventoryTrackingPolicies/);
  assert.match(route, /listInventoryTrackingPolicyCandidates/);
  assert.match(route, /MAX_EXPORT_ROWS/);
  assert.match(route, /INVENTORY_EXPORT_ROW_LIMIT_EXCEEDED/);
  assert.match(route, /createTabularXlsx/);
  assert.match(route, /guardCsvFormula/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST|export async function PUT|export async function PATCH/);
});

test('file xuất chỉ dùng cột nghiệp vụ, không đưa khóa nội bộ thành cột chọn', () => {
  assert.match(model, /Mã sản phẩm/);
  assert.match(model, /Tên sản phẩm/);
  assert.match(model, /SKU tồn chuẩn/);
  assert.match(model, /Mã kho/);
  assert.match(model, /Tồn kho/);
  assert.match(model, /Tham chiếu nhà cung cấp/);
  assert.match(model, /Trạng thái thiết lập/);
  assert.doesNotMatch(model, /key: 'installationId'/);
  assert.doesNotMatch(model, /key: 'warehouseId'/);
  assert.doesNotMatch(model, /key: 'baseVariantId'/);
  assert.doesNotMatch(model, /key: 'lotId'/);
  assert.doesNotMatch(model, /key: 'createdBy'/);
});

test('xuất chính sách lô bao gồm cả SKU đã và chưa thiết lập nhưng không thêm bulk mutation', () => {
  assert.match(model, /policy \? 'Đã thiết lập' : 'Chưa thiết lập'/);
  assert.match(route, /policyByVariantId/);
  assert.match(route, /candidates\s*\.map/);
  assert.doesNotMatch(action, /method:\s*'POST'|method:\s*'PUT'|method:\s*'PATCH'/);
});
