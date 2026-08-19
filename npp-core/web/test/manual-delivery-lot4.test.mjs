import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const settlementPath = fileURLToPath(new URL('../app/sales/sales-orders/ManualSalesOrderSettlement.tsx', import.meta.url));
const detailPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderDetail.tsx', import.meta.url));
const workspacePath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url));
const permissionsPath = fileURLToPath(new URL('../lib/sales-order-permissions.ts', import.meta.url));
const gatewayPath = fileURLToPath(new URL('../lib/manual-sales-order-gateway.ts', import.meta.url));

test('Issue #622 separates Hoàn thành đơn from Nộp tiền / Nợ', async () => {
  const [settlement, detail] = await Promise.all([
    readFile(settlementPath, 'utf8'),
    readFile(detailPath, 'utf8'),
  ]);
  assert.match(settlement, /['"]Hoàn thành đơn['"]/);
  assert.match(settlement, /['"]Nộp tiền \/ Nợ['"]/);
  assert.match(settlement, /Hoàn thành đơn ghi nhận doanh số và khoản phải thu; tiền thu hoặc nợ được xử lý riêng/);
  assert.match(detail, /isManual && hasIssued/);
  assert.match(detail, /ManualSalesOrderSettlement/);
});

test('Nộp tiền / Nợ supports full debt, partial payment and full payment after completion', async () => {
  const settlement = await readFile(settlementPath, 'utf8');
  assert.match(settlement, /paidAmount.*useState\('0'\)/s);
  assert.match(settlement, /order\.status === 'closed'/);
  assert.match(settlement, /\['pending', 'partially_paid'\]\.includes/);
  assert.match(settlement, /phần chưa thu tiếp tục là công nợ khách hàng/);
  assert.match(settlement, /<option value="CASH">Tiền mặt<\/option>/);
  assert.match(settlement, /<option value="BANK_TRANSFER">Chuyển khoản<\/option>/);
  assert.match(settlement, /Nhập 0 nếu ghi nợ toàn bộ/);
  assert.match(settlement, /debtOnly/);
  assert.match(settlement, /Khoản phải thu của đơn được giữ nguyên/);
  assert.match(settlement, />\s*Nộp đủ\s*</);
  assert.match(settlement, /order\.receivableRemainingAmount/);
  assert.match(settlement, /setPaidAmount\(editableAmount\(remainingAmount\)\)/);
  assert.match(settlement, /onChange=\{\(event\) => setPaidAmount\(event\.target\.value\)\}/);
  assert.doesNotMatch(settlement, /issue-stock/);
});

test('manual receipt can record an optional remitting employee without replacing the actor', async () => {
  const settlement = await readFile(settlementPath, 'utf8');
  assert.match(settlement, /customer-payments\/remitting-employees/);
  assert.match(settlement, /Nhân viên nộp tiền \(không bắt buộc\)/);
  assert.match(settlement, /remittingEmployeeId \? \{ remittingEmployeeId \} : \{\}/);
  assert.match(settlement, /fingerprint = `\$\{order\.revision\}\|\$\{normalizedAmount\}\|\$\{paymentMethod\}\|\$\{remittingEmployeeId\}`/);
});

test('same retry reuses canonical key while changed payment intent gets a new key', async () => {
  const settlement = await readFile(settlementPath, 'utf8');
  assert.match(settlement, /mutationKey\(prefix\)/);
  assert.match(settlement, /current\?\.orderId === orderId && current\.fingerprint === fingerprint/);
  assert.match(settlement, /completeKeyRef\.current = null/);
  assert.match(settlement, /settlementKeyRef\.current = null/);
  assert.match(settlement, /manual-order-complete/);
  assert.match(settlement, /manual-order-settlement/);
});

test('web reuses payment permission and backend-only gateway', async () => {
  const [workspace, permissions, gateway] = await Promise.all([
    readFile(workspacePath, 'utf8'),
    readFile(permissionsPath, 'utf8'),
    readFile(gatewayPath, 'utf8'),
  ]);
  assert.match(permissions, /recordCustomerPayment: 'core\.customer-payment\.create'/);
  assert.match(workspace, /canSettle=\{canSettle\}/);
  assert.match(gateway, /isValidIdempotencyKey/);
  assert.match(gateway, /\/api\/manual-sales-orders\/\$\{salesOrderId\(id\)\}\/\$\{action\}/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
});
