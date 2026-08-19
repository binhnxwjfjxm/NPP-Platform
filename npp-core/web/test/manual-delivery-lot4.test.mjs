import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const settlementPath = fileURLToPath(new URL('../app/sales/sales-orders/ManualSalesOrderSettlement.tsx', import.meta.url));
const detailPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderDetail.tsx', import.meta.url));
const workspacePath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url));
const permissionsPath = fileURLToPath(new URL('../lib/sales-order-permissions.ts', import.meta.url));
const gatewayPath = fileURLToPath(new URL('../lib/manual-sales-order-gateway.ts', import.meta.url));

test('Issue #622 separates Hoàn tất giao from collecting customer money', async () => {
  const [settlement, detail] = await Promise.all([
    readFile(settlementPath, 'utf8'),
    readFile(detailPath, 'utf8'),
  ]);
  assert.match(settlement, /['"]Hoàn tất giao['"]/);
  assert.match(settlement, /['"]Ghi nhận tiền thu['"]/);
  assert.match(settlement, /Hoàn tất giao ghi nhận doanh số và khoản phải thu; thu tiền là bước riêng/);
  assert.match(detail, /isManual && hasIssued/);
  assert.match(detail, /ManualSalesOrderSettlement/);
});

test('collecting money requires a positive amount after delivery completion and supports remaining debt', async () => {
  const settlement = await readFile(settlementPath, 'utf8');
  assert.match(settlement, /paidAmount.*useState\(''\)/s);
  assert.match(settlement, /order\.status === 'closed'/);
  assert.match(settlement, /\['pending', 'partially_paid'\]\.includes/);
  assert.match(settlement, /Phần chưa thu tiếp tục là công nợ khách hàng/);
  assert.match(settlement, /<option value="CASH">Tiền mặt<\/option>/);
  assert.match(settlement, /<option value="BANK_TRANSFER">Chuyển khoản<\/option>/);
  assert.doesNotMatch(settlement, /Nhập 0 nếu ghi nợ toàn bộ/);
  assert.doesNotMatch(settlement, /issue-stock/);
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
