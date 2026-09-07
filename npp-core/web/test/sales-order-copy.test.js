import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detailSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderDetail.tsx', import.meta.url),
  'utf8',
);
const formEntrySource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url),
  'utf8',
);
const formSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url),
  'utf8',
);

test('cancelled Sales Order exposes a safe copy link that opens the current create screen in a new tab', () => {
  assert.match(detailSource, /order\.status === 'cancelled'/);
  assert.match(detailSource, /quickAction: 'create'/);
  assert.match(detailSource, /copyFrom: orderId/);
  assert.match(detailSource, /target="_blank"/);
  assert.match(detailSource, /rel="noopener noreferrer"/);
  assert.match(detailSource, /data-testid="sales-order-copy"/);
  assert.match(detailSource, /Sao chép đơn/);
});

test('copy prefill reads the cancelled source order without mutating it and clears stale create-only data', () => {
  assert.match(
    formEntrySource,
    /apiRequest<SalesOrder>\(`\/api\/sales-orders\/\$\{encodeURIComponent\(copyFrom\)\}`\)/,
  );
  assert.match(formEntrySource, /source\.status !== 'cancelled'/);
  assert.match(formEntrySource, /activeVersion\(source\)/);
  assert.match(formEntrySource, /prepareSalesOrderCopyVersion\(sourceVersion\)/);
  assert.match(formEntrySource, /requestedDeliveryDate: null/);
  assert.match(formEntrySource, /priceSource: 'PRICE_ENGINE' as const/);
  assert.match(formEntrySource, /manualOverrideReason: null/);
  assert.match(formEntrySource, /pricingTrace: \[\]/);
  assert.doesNotMatch(formEntrySource, /localStorage|sessionStorage/);
  assert.doesNotMatch(formEntrySource, /\/clone|clone\(/i);
});

test('copied Sales Order still saves through the canonical create contract so it gets a new id and number', () => {
  assert.match(formSource, /let path = '\/api\/sales-orders';\s*let method = 'POST';/);
  assert.match(
    formSource,
    /\.\.\.\(props\.mode === 'create' \? \{\} : \{ expectedRevision: version\?\.revision \}\)/,
  );
  assert.match(formSource, /sourceType: 'MANUAL'/);
});
