import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Operational regressions follow the active Phase 6B.2 commercial entry owner.
const formSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url),
  'utf8',
);

test('Sales Order document discount preview keeps exact BigInt largest-remainder arithmetic', () => {
  assert.match(formSource, /const SCALE = 1_000_000n/);
  assert.match(formSource, /function documentDiscountTarget/);
  assert.match(formSource, /function largestRemainder/);
  assert.match(formSource, /const floor = numerator \/ total/);
  assert.match(formSource, /left\.remainder > right\.remainder \? -1 : 1/);
  assert.match(formSource, /left\.index - right\.index/);
  assert.doesNotMatch(formSource, /parseFloat|Number\(documentDiscountValue\)/);
  assert.doesNotMatch(formSource, /Kiểu CK thêm/);
});

test('Sales Order effects depend on stable callbacks instead of the whole props object', () => {
  assert.match(formSource, /const\s*\{\s*version,\s*onClose,\s*onError\s*\}\s*=\s*props/);
  assert.doesNotMatch(formSource, /\[[^\]]*\bprops\b[^\]]*\]/);
  assert.match(
    formSource,
    /\[customerId,\s*customerMode,\s*onError,\s*pricingAt,\s*salesChannelId,\s*skuTerm,\s*warehouseId\]/,
  );
});

test('quick customer and address retries keep stable idempotency keys per attempt', () => {
  assert.match(formSource, /const\s*\[quickCustomerKey,\s*setQuickCustomerKey\]\s*=\s*useState/);
  assert.match(formSource, /const\s*\[quickAddressKey,\s*setQuickAddressKey\]\s*=\s*useState/);
  assert.match(formSource, /'Idempotency-Key':\s*quickCustomerKey/);
  assert.match(formSource, /'Idempotency-Key':\s*quickAddressKey/);
  assert.match(formSource, /setQuickCustomerKey\(mutationKey\('sales-quick-customer'\)\)/);
  assert.match(formSource, /setQuickAddressKey\(mutationKey\('sales-quick-address'\)\)/);
});
