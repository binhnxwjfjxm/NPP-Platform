import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const formSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url),
  'utf8',
);

test('Sales Order per-unit discount preview keeps six-place exact arithmetic', () => {
  assert.match(
    formSource,
    /discount\s*=\s*halfUp\(quantity\s*\*\s*discountInput,\s*SCALE\s*\*\s*SCALE\)/,
  );
  assert.doesNotMatch(formSource, /quantity\s*\*\s*\(discountInput\s*\/\s*SCALE\)/);
});

test('Sales Order effects depend on stable callbacks instead of the whole props object', () => {
  assert.match(formSource, /const\s*\{[^}]*onError[^}]*onClose[^}]*\}\s*=\s*props/s);
  assert.doesNotMatch(formSource, /\[[^\]]*\bprops\b[^\]]*\]/);
  assert.match(formSource, /\[onError,\s*skuTerm\]/);
});

test('quick customer and address retries keep stable idempotency keys per attempt', () => {
  assert.match(formSource, /const\s*\[quickCustomerKey,\s*setQuickCustomerKey\]\s*=\s*useState/);
  assert.match(formSource, /const\s*\[quickAddressKey,\s*setQuickAddressKey\]\s*=\s*useState/);
  assert.match(formSource, /'Idempotency-Key':\s*quickCustomerKey/);
  assert.match(formSource, /'Idempotency-Key':\s*quickAddressKey/);
  assert.match(formSource, /setQuickCustomerKey\(mutationKey\('sales-quick-customer'\)\)/);
  assert.match(formSource, /setQuickAddressKey\(mutationKey\('sales-quick-address'\)\)/);
});
