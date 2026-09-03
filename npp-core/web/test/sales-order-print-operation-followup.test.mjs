import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('sales order thao tác mới nhất nằm trên cùng mà không đảo logic danh sách đơn', () => {
  const form = read('../app/sales/sales-orders/SalesOrderCommercialForm.tsx');
  const workspace = read('../app/sales/sales-orders/SalesOrderWorkspace.tsx');

  assert.match(form, /setLines\(\(current\) => \[pending, \.\.\.current\]\);/);
  assert.match(form, /focusLineQuantity\(pending\.clientLineId\);/);
  assert.match(workspace, /right\.updatedAt\.localeCompare\(left\.updatedAt\)/);
});

test('sales order print dùng tên ĐVT canonical và bố cục cột co theo nội dung', () => {
  const repository = read('../../api/src/db/repositories/sales-order.js');
  const service = read('../../api/src/services/sales-order-legacy.js');
  const types = read('../lib/sales-order-types.ts');
  const print = read('../app/sales/sales-orders/SalesOrderPrintSheet.tsx');

  assert.match(repository, /SELECT \$\{LINE_COLUMNS\}, u\.name AS unit_name/);
  assert.match(repository, /JOIN shared\.units_of_measure u/);
  assert.match(service, /unitName: line\.unit_name \?\? line\.unit_code_snapshot/);
  assert.match(types, /unitName: string \| null;/);
  assert.match(print, /unit: line\.unitName\?\.trim\(\) \|\| line\.unitCode/);
  assert.match(print, /fieldKey: 'line_quantity', label: 'SL'/);
  assert.doesNotMatch(print, /tableLayout="fixed"/);
  assert.match(print, /fieldKey: 'line_unit_price'[\s\S]*width: '1%'[\s\S]*wrap: 'nowrap'/);
});

test('sales order print template có Tổng khối lượng và margin an toàn riêng', () => {
  const templateService = read('../../api/src/services/document-print-templates.js');
  const printCss = read('../app/components/print-document.module.css');

  assert.match(templateService, /\['total_weight', 'Tổng khối lượng'\]/);
  assert.match(printCss, /@page document-a4-clean\s*\{[\s\S]*?margin:\s*0/);
  assert.match(printCss, /data-print-size='A4'\]\[data-print-suppress-browser-headers='true'\]\[data-print-id\^='sales-order-'\][\s\S]*?padding:\s*6mm/);
  assert.match(printCss, /data-print-size='A5'\]\[data-print-suppress-browser-headers='true'\]\[data-print-id\^='sales-order-'\][\s\S]*?padding:\s*5mm/);
});
