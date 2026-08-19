import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function webSource(relativePath) { return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'); }
const page = webSource('app/accounting/customer-payments/page.tsx');
const workspace = webSource('app/accounting/customer-payments/customer-payment-workspace.tsx');
const gateway = webSource('lib/customer-payment-gateway.ts');
const collectionRoute = webSource('app/api/customer-payments/route.ts');
const allocationRoute = webSource('app/api/customer-payments/[id]/allocations/route.ts');
const allocationReverseRoute = webSource('app/api/receivable-allocations/[id]/reverse/route.ts');
const employeeRoute = webSource('app/api/customer-payments/remitting-employees/route.ts');
const navigation = webSource('app/components/app-shell-core.tsx');

test('customer payment page explains the accounting task without extending delivery or MCP', () => {
  assert.match(page, /title="Thu tiền khách hàng"/); assert.match(page, /ghi tiền vào đúng đơn hàng/); assert.match(page, /CustomerPaymentWorkspace/); assert.doesNotMatch(page, /MCP|\bcod\b|hoàn tiền|hàng trả/i);
});
test('workspace supports one receipt allocated to many receivables', () => {
  assert.match(workspace, /data-testid="customer-payment-form"/); assert.match(workspace, /data-testid="customer-payment-create-allocation-table"/); assert.match(workspace, /data-testid="customer-payment-allocation-form"/); assert.match(workspace, /allocations: createRows\.length \? createRows : undefined/); assert.match(workspace, /allocations: existingRows/); assert.match(workspace, /allocationRows\(createAmounts, createTargets\)/); assert.match(workspace, /allocationRows\(existingAmounts, existingTargets\)/); assert.match(workspace, /Phần còn lại là tiền chưa gắn với đơn/); assert.doesNotMatch(workspace, /paid\s*=\s*true/i); assert.doesNotMatch(workspace, /\bcod\b|hoàn tiền|write[-_ ]?off/i);
});
test('large customer and order lists have office-facing quick filters', () => {
  assert.match(workspace, /data-testid="customer-payment-customer-search"/);
  assert.match(workspace, /data-testid="customer-payment-order-search"/);
  assert.match(workspace, /includesSearch\(customerSearch, customer\.code, customer\.name\)/);
  assert.match(workspace, /includesSearch\(\s*orderSearch,/);
  assert.match(workspace, /includesSearch\(\s*existingOrderSearch,/);
  assert.match(workspace, /Không tìm thấy đơn phù hợp/);
});
test('history separates unapplied receipt money from the current customer debt', () => {
  assert.match(workspace, /payment\.relatedRemainingAmount/);
  assert.match(workspace, /payment\.relatedReceivableCount > 0/);
  assert.match(workspace, /Tiền chưa gắn với đơn: \{money\(selected\.remainingAmount/);
  assert.match(workspace, /Nhân viên nộp/);
  assert.doesNotMatch(workspace, /Phân bổ|phân bổ|Đảo|đảo/);
});
test('web gateway keeps workforce sessions server-only and forwards idempotency keys', () => {
  assert.match(gateway, /import 'server-only'/); assert.match(gateway, /CORE_API_INTERNAL_URL/); assert.match(gateway, /requireNppWorkforceSessionToken/); assert.doesNotMatch(gateway, /process\.env\.CORE_API_SERVER_TOKEN/); assert.match(gateway, /'Idempotency-Key':\s*idempotencyKey/); assert.match(gateway, /\/api\/customer-payments\/\$\{uuid\(id/); assert.match(gateway, /\/api\/receivable-allocations\/\$\{uuid\(id/); assert.doesNotMatch(gateway, /NEXT_PUBLIC_.*TOKEN/);
});
test('web API surface exposes collection, multi-allocation and compensating reversal', () => {
  assert.match(collectionRoute, /createCustomerPayment/); assert.match(collectionRoute, /listCustomerPayments/); assert.match(allocationRoute, /allocateCustomerPayment/); assert.match(allocationReverseRoute, /reverseReceivableAllocation/); assert.match(employeeRoute, /listCustomerPaymentRemittingEmployees/); for (const source of [collectionRoute, allocationRoute, allocationReverseRoute, employeeRoute]) { assert.match(source, /customerPaymentRequestId/); assert.match(source, /customerPaymentErrorResponse/); }
});
test('accounting navigation exposes customer payments as its own task', () => { assert.match(navigation, /href: '\/accounting\/customer-payments'/); assert.match(navigation, /label: 'Thu tiền khách hàng'/); assert.match(navigation, /testId: 'nav-customer-payments'/); });
