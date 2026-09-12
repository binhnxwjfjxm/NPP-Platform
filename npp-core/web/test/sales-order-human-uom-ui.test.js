import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const workspace = read('app/sales/sales-orders/SalesOrderWorkspace.tsx');
const detail = read('app/sales/sales-orders/SalesOrderDetail.tsx');
const printSheet = read('app/sales/sales-orders/SalesOrderPrintSheet.tsx');
const printDocument = read('app/components/print-document.tsx');
const holdBreakdown = read('app/components/stock-hold-breakdown.tsx');
const salesTypes = read('lib/sales-order-types.ts');
const fulfillmentRepository = read('../api/src/db/repositories/sales-fulfillment.js');
const fulfillmentService = read('../api/src/services/sales-fulfillment.js');
const previewRepository = read('../api/src/db/repositories/sales-order-search-preview.js');
const previewService = read('../api/src/services/sales-order-search-preview.js');
const holdService = read('../api/src/services/inventory-business-holds.js');

test('danh sách đơn ưu tiên tên khách + giá trị và rút gọn số đơn cho người dùng', () => {
  assert.match(workspace, /return match \? `SO\$\{match\[1\]\}` : normalized;/);
  assert.match(workspace, /orderCardCustomerRow/);
  assert.match(workspace, /orderCardCustomerName/);
  assert.match(workspace, /orderCardCompactNumber/);
  assert.doesNotMatch(workspace, /`#\$\{compactOrderNumber\(order\.number\)\}`/);
});

test('chi tiết đơn dùng tên ĐVT và đưa thao tác giao thủ công lên đầu', () => {
  assert.match(detail, /line\.baseUnitName \|\| line\.baseUnitCode/);
  assert.match(detail, /line\.unitName \|\| line\.unitCode/);
  assert.match(detail, /baseUnitName=\{stock\.baseUnitName\}/);
  const headerIndex = detail.indexOf('<header className={styles.panelHeading}>');
  const editIndex = detail.indexOf('onClick={props.onEditManual}', headerIndex);
  const issueIndex = detail.indexOf('confirmSingleStockIssue(order.number)', headerIndex);
  const printIndex = detail.indexOf('<SalesOrderPrintSheet', headerIndex);
  assert.ok(editIndex > headerIndex && editIndex < printIndex);
  assert.ok(issueIndex > editIndex && issueIndex < printIndex);
  assert.equal(detail.match(/onClick=\{props\.onEditManual\}/g)?.length, 1);
  assert.equal(detail.match(/props\.onIssueStock\(\)/g)?.length, 1);
});

test('In đơn có biến thể text-only thay vì nút tô màu', () => {
  assert.match(printDocument, /variant\?: PrintActionVariant/);
  assert.match(printDocument, /styles\.printActionText/);
  assert.match(printSheet, /actionVariant="text"/);
});

test('contract fulfillment và giữ hàng mang tên ĐVT từ nguồn shared.units_of_measure', () => {
  assert.match(fulfillmentRepository, /base_unit\.name AS base_unit_name/);
  assert.match(fulfillmentService, /baseUnitName: line\.base_unit_name \?\? null/);
  assert.match(salesTypes, /baseUnitName\?: string \| null/);
  assert.match(holdService, /base_unit\.name AS base_unit_name/);
  assert.match(holdService, /baseUnitName: row\.base_unit_name \?\? null/);
  assert.match(holdBreakdown, /order\.baseUnitName \|\| order\.baseUnitCode/);
});

test('preview tồn mang tên ĐVT mà không hard-code mã kỹ thuật sang tiếng Việt', () => {
  assert.match(previewRepository, /array_agg\(base_unit\.name/);
  assert.match(previewService, /unitName: row\.base_unit_name \?\? null/);
  assert.match(previewService, /preview\.unitName \|\| preview\.unitCode/);
  assert.doesNotMatch(previewService, /THUNG\s*[:=].*Thùng|HOP\s*[:=].*Hộp|GOI\s*[:=].*Gói|BICH\s*[:=].*Bịch/);
});
