import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateLargestRemainder,
  canonicalPricingFingerprint,
  documentDiscountTarget,
  normalizeDocumentDiscount,
  parseScaledDecimal,
  taxAfterDiscount,
} from '../src/services/sales-order-commercial.js';

const discountPermission = Object.freeze({
  permissions: Object.freeze(['core.sales-order.discount.override']),
});

test('document percent discount uses exact HALF_UP target', () => {
  const value = parseScaledDecimal('10');
  assert.equal(documentDiscountTarget({ mode: 'PERCENT', valueScaled: value, grossTotalMinor: 101n }), 10n);
  assert.equal(documentDiscountTarget({ mode: 'PERCENT', valueScaled: value, grossTotalMinor: 105n }), 11n);
});

test('largest remainder allocation is deterministic and reconciles', () => {
  const result = allocateLargestRemainder([100n, 100n, 100n], 100n);
  assert.equal(result.ok, true);
  assert.deepEqual(result.allocations, [34n, 33n, 33n]);
  assert.equal(result.allocations.reduce((sum, value) => sum + value, 0n), 100n);
});

test('largest remainder tie breaks by ascending line number', () => {
  const result = allocateLargestRemainder([1n, 1n, 1n, 1n], 2n);
  assert.equal(result.ok, true);
  assert.deepEqual(result.allocations, [1n, 1n, 0n, 0n]);
});

test('zero gross lines never receive document discount', () => {
  const result = allocateLargestRemainder([0n, 50n, 50n], 25n);
  assert.equal(result.ok, true);
  assert.deepEqual(result.allocations, [0n, 13n, 12n]);
});

test('document discount cannot exceed eligible gross', () => {
  const result = allocateLargestRemainder([10n, 20n], 31n);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DOCUMENT_DISCOUNT_EXCEEDS_GROSS');
});

test('positive document discount requires separate permission and reason', () => {
  assert.equal(normalizeDocumentDiscount({ documentDiscountMode: 'TOTAL_AMOUNT', documentDiscountValue: '10', documentDiscountReason: 'Owner approval' }, { permissions: [] }).code, 'DOCUMENT_DISCOUNT_FORBIDDEN');
  assert.equal(normalizeDocumentDiscount({ documentDiscountMode: 'TOTAL_AMOUNT', documentDiscountValue: '10' }, discountPermission).code, 'DOCUMENT_DISCOUNT_REASON_REQUIRED');
  const accepted = normalizeDocumentDiscount({ documentDiscountMode: 'TOTAL_AMOUNT', documentDiscountValue: '10', documentDiscountReason: 'Owner approval' }, discountPermission);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value, '10');
});

test('tax is recomputed after allocated discount for exclusive and inclusive modes', () => {
  const rate = parseScaledDecimal('10');
  assert.deepEqual(
    taxAfterDiscount({ grossMinor: 100n, discountMinor: 10n, taxMode: 'EXCLUSIVE', taxRateScaled: rate }),
    { ok: true, lineSubtotalMinor: 100n, taxMinor: 9n, lineTotalMinor: 99n },
  );
  assert.deepEqual(
    taxAfterDiscount({ grossMinor: 110n, discountMinor: 11n, taxMode: 'INCLUSIVE', taxRateScaled: rate }),
    { ok: true, lineSubtotalMinor: 101n, taxMinor: 9n, lineTotalMinor: 99n },
  );
});

test('pricing fingerprint is stable for canonical ordered trace', () => {
  const resolution = {
    variant: { id: 'variant-1' },
    currencyCode: 'VND',
    quantity: '2',
    priceAt: '2026-07-31T00:00:00.000Z',
    channelId: 'channel-1',
    customerGroupId: null,
    customerId: null,
    baseUnitPriceMinor: '100',
    systemUnitPriceMinor: '90',
    steps: [{ kind: 'BASE', afterUnitPriceMinor: '100' }, { kind: 'RULE', priceListId: 'list-1', beforeUnitPriceMinor: '100', afterUnitPriceMinor: '90', priority: 200 }],
  };
  assert.equal(canonicalPricingFingerprint(resolution), canonicalPricingFingerprint(structuredClone(resolution)));
  assert.notEqual(canonicalPricingFingerprint(resolution), canonicalPricingFingerprint({ ...resolution, systemUnitPriceMinor: '89' }));
});
