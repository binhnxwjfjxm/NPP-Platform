import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readWeb = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const readApi = (path) => readFileSync(new URL(`../../api/${path}`, import.meta.url), 'utf8');

const form = readWeb('app/sales/sales-orders/SalesOrderCommercialForm.tsx');
const salesPrint = readWeb('app/sales/sales-orders/SalesOrderPrintSheet.tsx');
const types = readWeb('lib/sales-order-types.ts');
const repository = readApi('src/db/repositories/sales-order.js');
const service = readApi('src/services/sales-order-legacy.js');
const templates = readApi('src/services/document-print-templates.js');

test('SKU vừa thêm đứng đầu danh sách và vẫn focus vào SL của dòng mới', () => {
  assert.match(form, /setLines\(\(current\) => \[pending, \.\.\.current\]\);/);
  assert.doesNotMatch(form, /setLines\(\(current\) => \[\.\.\.current, pending\]\);/);
  assert.match(form, /focusLineQuantity\(pending\.clientLineId\);/);
  assert.match(form, /lines: lines\.map\(\(line\) => \(\{/);
});

test('phiếu bán hàng ưu tiên tên ĐVT đã chốt và chỉ dùng tên hiện tại cho dữ liệu cũ', () => {
  assert.match(repository, /COALESCE\(sovl\.unit_name_snapshot, u\.name\) AS unit_name/);
  assert.match(repository, /LEFT JOIN shared\.units_of_measure u/);
  assert.match(service, /unitName: line\.unit_name \?\? line\.unit_code_snapshot/);
  assert.match(types, /unitName: string \| null;/);
  assert.match(salesPrint, /unit: line\.unitName \|\| line\.unitCode/);
});

test('thiết lập mẫu in bán hàng có tùy chọn Tổng khối lượng', () => {
  assert.match(templates, /\['total_weight', 'Tổng khối lượng'\]/);
  assert.match(salesPrint, /key: 'total_weight', label: 'Tổng khối lượng'/);
});
