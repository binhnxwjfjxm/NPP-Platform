import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function webSource(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const page = webSource('app/accounting/customer-payments/page.tsx');
const workspace = webSource('app/accounting/customer-payments/customer-payment-workspace.tsx');
const gateway = webSource('lib/customer-payment-gateway.ts');
const collectionRoute = webSource('app/api/customer-payments/route.ts');
const allocationRoute = webSource('app/api/customer-payments/[id]/allocations/route.ts');
const allocationReverseRoute = webSource('app/api/receivable-allocations/[id]/reverse/route.ts');
const navigation = webSource('app/components/app-shell-core.tsx');

test('customer payment page explains the accounting task without extending delivery or MCP', () => {
  assert.match(page, /title="Thu tiền khách hàng"/);
  assert.match(page, /phân bổ một lần vào nhiều khoản nợ/);
  assert.match(page, /CustomerPaymentWorkspace/);
  assert.doesNotMatch(page, /MCP|COD|hoàn tiền|hàng trả/i);
});

test('workspace supports one receipt allocated to many receivables', () => {
  assert.match(workspace, /data-testid="customer-payment-form"/);
  assert.match(workspace, /data-testid="customer-payment-create-allocation-table"/);
  assert.match(workspace, /data-testid="customer-payment-allocation-form"/);
  assert.match(workspace, /allocations: createRows\.length \? createRows : undefined/);
  assert.match(workspace, /allocations: existingRows/);
  assert.match(workspace, /allocationRows\(createAmounts, createTargets\)/);
  assert.match(workspace, /allocationRows\(existingAmounts, existingTargets\)/);
  assert.match(workspace, /Phần còn lại sẽ là tiền chưa phân bổ/);
  assert.doesNotMatch(workspace, /paid\s*=\s*true/i);
  assert.doesNotMatch(workspace, /COD|hoàn tiền|write[-_ ]?off/i);
});

test('web gateway keeps tokens server-only and forwards idempotency keys', () => {
  assert.match(gateway, /import 'server-only'/);
  assert.match(gateway, /CORE_API_INTERNAL_URL/);
  assert.match(gateway, /CORE_API_SERVER_TOKEN/);
  assert.match(gateway, /'Idempotency-Key': idempotencyKey/);
  assert.match(gateway, /\/api\/customer-payments\/\$\{assertUuid\(id/);
  assert.match(gateway, /\/api\/receivable-allocations\/\$\{assertUuid\(id/);
  assert.doesNotMatch(gateway, /NEXT_PUBLIC_.*TOKEN/);
});

test('web API surface exposes collection, multi-allocation and compensating reversal', () => {
  assert.match(collectionRoute, /createCustomerPayment/);
  assert.match(collectionRoute, /listCustomerPayments/);
  assert.match(allocationRoute, /allocateCustomerPayment/);
  assert.match(allocationReverseRoute, /reverseReceivableAllocation/);
  for (const source of [collectionRoute, allocationRoute, allocationReverseRoute]) {
    assert.match(source, /customerPaymentRequestId/);
    assert.match(source, /customerPaymentErrorResponse/);
  }
});

test('accounting navigation exposes customer payments as its own task', () => {
  assert.match(navigation, /href: '\/accounting\/customer-payments'/);
  assert.match(navigation, /label: 'Thu tiền khách hàng'/);
  assert.match(navigation, /testId: 'nav-customer-payments'/);
});
