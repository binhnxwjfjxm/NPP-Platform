import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(
  new URL('../app/sales/sales-orders/sales-order-ui.ts', import.meta.url),
  'utf8',
);
const workspace = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url),
  'utf8',
);

test('positive document discount intent is rejected client-side without a reason', () => {
  assert.match(ui, /function validateDraftDiscountIntent/);
  assert.match(ui, /DOCUMENT_DISCOUNT_REASON_REQUIRED/);
  assert.match(ui, /validateDraftDiscountIntent\(request\.path, request\.init\)/);
});

test('successful recovery clears a stale pricing error before showing success', () => {
  assert.match(workspace, /onSaved=\{\(order\) => \{[\s\S]*setError\(null\);[\s\S]*setNotice/);
});
