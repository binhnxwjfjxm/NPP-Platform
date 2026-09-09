import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workspacePath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url));
const formPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url));
const managementPath = fileURLToPath(new URL('../app/sales/order-management/OrderManagementWorkspace.tsx', import.meta.url));
const managementPagePath = fileURLToPath(new URL('../app/sales/order-management/page.tsx', import.meta.url));
const printDocumentPath = fileURLToPath(new URL('../app/components/print-document.tsx', import.meta.url));
const printSheetPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderPrintSheet.tsx', import.meta.url));

test('danh sách đơn giữ thứ tự ngày tạo khi đơn cũ thay đổi trạng thái', async () => {
  const source = await readFile(workspacePath, 'utf8');
  assert.match(source, /function sortOrdersByCreatedAt/);
  assert.match(source, /right\.createdAt\.localeCompare\(left\.createdAt\)/);
  assert.match(source, /const sorted = sortOrdersByCreatedAt\(next\)/);
  assert.match(source, /return sortOrdersByCreatedAt\(next\)/);
  assert.doesNotMatch(source, /right\.updatedAt\.localeCompare\(left\.updatedAt\)/);
});

test('ô đơn giá hiển thị phân tách hàng nghìn nhưng giữ dữ liệu số thuần', async () => {
  const source = await readFile(formPath, 'utf8');
  assert.match(source, /export function formatVndInput/);
  assert.match(source, /digits\.replace\(\/\\B\(\?=\(\\d\{3\}\)\+\(\?!\\d\)\)\/g, '\.'\)/);
  assert.match(source, /value=\{formatVndInput\(line\.manualUnitPriceMinor/);
  assert.match(source, /event\.target\.value\.replace\(\/\\D\/g, ''\)/);
});

test('quản lý đơn chỉ nối thao tác kế tiếp và tái dùng API hiện có', async () => {
  const [source, page] = await Promise.all([
    readFile(managementPath, 'utf8'),
    readFile(managementPagePath, 'utf8'),
  ]);
  assert.match(page, /loadSalesOrderPermissionKeys/);
  assert.match(page, /permissionKeys=\{permissionKeys\}/);
  assert.match(source, /type QuickAction = 'issue-stock' \| 'complete' \| 'settle-full'/);
  assert.match(source, /return 'issue-stock'/);
  assert.match(source, /return 'complete'/);
  assert.match(source, /return 'settle-full'/);
  assert.match(source, /\/api\/sales-orders\/\$\{fresh\.id\}\/issue-stock/);
  assert.match(source, /\/api\/manual-sales-orders\/\$\{fresh\.id\}\/complete/);
  assert.match(source, /\/api\/manual-sales-orders\/\$\{fresh\.id\}\/settlement/);
  assert.match(source, /mutationKey\(prefix\)/);
  assert.match(source, />Thu<\/button>/);
  assert.doesNotMatch(source, /Thu khác/);
  assert.match(source, /bulkAction/);
  assert.match(source, /QUICK_ACTION_LABELS\[bulkAction\]/);
});

test('thu đủ là thao tác nhanh còn thu mới bung hàng nhập nhỏ', async () => {
  const source = await readFile(managementPath, 'utf8');
  assert.match(source, /paymentMethod: 'CASH'/);
  assert.match(source, /className=\{styles\.quickSettlementRow\}/);
  assert.match(source, /Số tiền thực thu/);
  assert.match(source, /Hình thức nhận tiền/);
  assert.match(source, /partialSettlement\.amount\.trim\(\) === ''/);
});

test('phiếu bán hàng truyền tên khách và ngày đơn vào chân trang động có số trang', async () => {
  const [documentSource, sheetSource, managementSource] = await Promise.all([
    readFile(printDocumentPath, 'utf8'),
    readFile(printSheetPath, 'utf8'),
    readFile(managementPath, 'utf8'),
  ]);
  assert.match(documentSource, /data-print-footer/);
  assert.match(documentSource, /clonePrintSurfaceForOutput/);
  assert.match(documentSource, /@bottom-center/);
  assert.match(documentSource, /counter\(page\)/);
  assert.match(documentSource, /counter\(pages\)/);
  assert.match(documentSource, /document\.head\.appendChild\(pageStyle\)/);
  assert.match(documentSource, /style\[data-print-page-style\]/);
  assert.match(documentSource, /0 0 7mm 0/);
  assert.match(sheetSource, /footerText=\{`\$\{displayCustomer\} - \$\{dateText\(version\.confirmedAt \?\? version\.createdAt\)\}`\}/);
  assert.match(managementSource, /document\.querySelectorAll\('style\[data-print-page-style\]'\)/);
  assert.match(managementSource, /const printable = clonePrintSurfaceForOutput\(target, `bulk-/);
  assert.doesNotMatch(managementSource, /printRoot\.appendChild\(pageStyle\)/);
});
