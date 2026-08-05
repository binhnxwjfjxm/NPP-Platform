import test from 'node:test';
import assert from 'node:assert/strict';
import { customerPaymentInternals } from '../src/services/customer-payment.js';

const {
  decimalToScaled,
  scaledToDecimal,
  normalizeAllocationItems,
  mapDatabaseError,
} = customerPaymentInternals;

test('customer payment decimal conversion is exact to six fractional digits', () => {
  assert.equal(decimalToScaled('120000.123456'), 120000123456n);
  assert.equal(scaledToDecimal(120000123456n), '120000.123456');
  assert.equal(scaledToDecimal(-500000n), '-0.500000');
  assert.equal(decimalToScaled('0'), null);
  assert.equal(decimalToScaled('0', { allowZero: true }), 0n);
  assert.equal(decimalToScaled('1.0000001'), null);
  assert.equal(decimalToScaled('-1'), null);
});

test('multi-allocation validation sorts lock order and rejects duplicate targets', () => {
  const first = '22222222-2222-4222-8222-222222222222';
  const second = '11111111-1111-4111-8111-111111111111';
  const normalized = normalizeAllocationItems([
    { receivableDocumentId: first, amount: '20' },
    { receivableDocumentId: second, amount: '10.5' },
  ]);
  assert.equal(normalized.ok, true);
  assert.deepEqual(
    normalized.items.map((item) => item.targetDocumentId),
    [second, first],
  );
  assert.deepEqual(
    normalized.items.map((item) => item.amount),
    [10500000n, 20000000n],
  );

  const duplicate = normalizeAllocationItems([
    { receivableDocumentId: first, amount: '1' },
    { receivableDocumentId: first, amount: '2' },
  ]);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'DUPLICATE_ALLOCATION_TARGET');
});

test('allocation validation rejects invalid rows and oversized batches', () => {
  assert.equal(normalizeAllocationItems([]).code, 'INVALID_ALLOCATIONS');
  assert.equal(
    normalizeAllocationItems([{ receivableDocumentId: 'bad', amount: '1' }]).code,
    'INVALID_TARGET_DOCUMENT_ID',
  );
  assert.equal(
    normalizeAllocationItems([{
      receivableDocumentId: '11111111-1111-4111-8111-111111111111',
      amount: '0',
    }]).code,
    'INVALID_ALLOCATION_AMOUNT',
  );
  assert.equal(
    normalizeAllocationItems(Array.from({ length: 101 }, (_, index) => ({
      receivableDocumentId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      amount: '1',
    }))).code,
    'INVALID_ALLOCATIONS',
  );
});

test('database allocation conflicts map to stable public errors', () => {
  const source = mapDatabaseError(new Error('allocation_exceeds_source_remaining'));
  assert.equal(source.ok, false);
  assert.equal(source.code, 'ALLOCATION_EXCEEDS_SOURCE');
  assert.equal(source.retryable, true);

  const customer = mapDatabaseError(new Error('allocation_customer_mismatch'));
  assert.equal(customer.ok, false);
  assert.equal(customer.code, 'ALLOCATION_CUSTOMER_MISMATCH');

  assert.equal(mapDatabaseError(new Error('unexpected database error')), null);
});
