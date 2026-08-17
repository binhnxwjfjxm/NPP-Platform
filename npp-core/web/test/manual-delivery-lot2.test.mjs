import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const formPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url));
const workspacePath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url));
const detailPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderDetail.tsx', import.meta.url));
const printPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderPrintSheet.tsx', import.meta.url));
const printActionPath = fileURLToPath(new URL('../app/components/print-document.tsx', import.meta.url));
const uiPath = fileURLToPath(new URL('../app/sales/sales-orders/sales-order-ui.ts', import.meta.url));
const typesPath = fileURLToPath(new URL('../lib/sales-order-types.ts', import.meta.url));

test('Issue #622 Lô 2 exposes exactly the three office-language delivery choices', async () => {
  const [form, detail, print, types] = await Promise.all([
    readFile(formPath, 'utf8'),
    readFile(detailPath, 'utf8'),
    readFile(printPath, 'utf8'),
    readFile(typesPath, 'utf8'),
  ]);

  assert.match(form, /Hình thức giao nhận/);
  assert.match(form, /<option value="TRIP">Giao theo chuyến<\/option>/);
  assert.match(form, /<option value="MANUAL">Giao thủ công<\/option>/);
  assert.match(form, /<option value="PICKUP">Khách nhận tại kho<\/option>/);
  assert.match(form, /deliveryExecutionMode: deliveryExecutionMode \?\? 'TRIP'/);
  assert.match(types, /SalesOrderDeliveryExecutionMode = 'TRIP' \| 'MANUAL'/);
  assert.match(detail, /deliveryMethodLabel\(current\)/);
  assert.match(print, /Hình thức giao nhận/);
  assert.doesNotMatch(form, /<span>Nhận hàng<\/span>/);
});

test('confirmed manual order uses one direct Sửa đơn action without exposing version workflow', async () => {
  const [form, workspace, detail, ui] = await Promise.all([
    readFile(formPath, 'utf8'),
    readFile(workspacePath, 'utf8'),
    readFile(detailPath, 'utf8'),
    readFile(uiPath, 'utf8'),
  ]);

  assert.match(form, /SalesOrderFormMode = 'create' \| 'draft' \| 'amendment' \| 'manual-edit'/);
  assert.match(form, /\/api\/sales-orders\/\$\{props\.orderId\}\/manual-edit/);
  assert.match(form, /'Lưu thay đổi'/);
  assert.match(workspace, /onEditManual=\{\(\) => openForm\('manual-edit', activeVersion\(selected\)\)\}/);
  assert.match(workspace, /savedMode === 'manual-edit'/);
  assert.match(detail, />Sửa đơn<\/button>/);
  assert.match(detail, /!isManual && order\.versions/);
  assert.match(detail, /!isManual && amendment/);
  assert.match(detail, /Đơn đã Xuất kho nên không thể sửa hoặc xuất lại/);
  assert.match(ui, /manual-edit/);
});

test('printing stays presentation-only and warns after the displayed order changes', async () => {
  const [print, printAction] = await Promise.all([
    readFile(printPath, 'utf8'),
    readFile(printActionPath, 'utf8'),
  ]);

  assert.match(print, /Đơn đã thay đổi sau lần in gần nhất\. Hãy in lại nếu cần\./);
  assert.match(print, /<PrintAction label="In đơn" onPrint=\{recordPrint\} \/>/);
  assert.match(print, /window\.localStorage\.setItem\(printKey, printFingerprint\)/);
  assert.match(printAction, /window\.print\(\)/);
  assert.match(printAction, /onPrint\?\.\(\)/);
  assert.doesNotMatch(printAction, /fetch\(/);
  assert.doesNotMatch(printAction, /apiRequest/);
});