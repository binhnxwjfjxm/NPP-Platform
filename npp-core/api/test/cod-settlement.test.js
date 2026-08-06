import test from 'node:test';
import assert from 'node:assert/strict';
import { codSettlementInternals } from '../src/services/cod-settlement.js';

test('COD money uses exact fixed-point arithmetic', () => {
  assert.equal(codSettlementInternals.decimalToScaled('0.000001'), 1n);
  assert.equal(codSettlementInternals.decimalToScaled('123.456789'), 123456789n);
  assert.equal(codSettlementInternals.scaledToDecimal(123456789n), '123.456789');
  assert.equal(codSettlementInternals.decimalToScaled('1.0000001'), null);
  assert.equal(codSettlementInternals.decimalToScaled('-1'), null);
});

test('COD payload hash is stable and does not depend on key order', () => {
  const left = codSettlementInternals.payloadHash({ b: 2, a: { y: 2, x: 1 } });
  const right = codSettlementInternals.payloadHash({ a: { x: 1, y: 2 }, b: 2 });
  assert.equal(left, right);
  assert.match(left, /^[0-9a-f]{64}$/);
});

test('not-collected COD requires a concrete promise and does not accept payment amount', () => {
  const missing = codSettlementInternals.normalizeCollectionPayload({
    collectionMethod: 'NONE',
    reasonCode: 'CUSTOMER_PROMISED',
  }, '2026-08-06T00:00:00.000Z');
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'COD_PROMISE_DETAILS_REQUIRED');

  const valid = codSettlementInternals.normalizeCollectionPayload({
    collectionMethod: 'NONE',
    reasonCode: 'CUSTOMER_PROMISED',
    promisedBy: 'Nguyễn Văn A',
    dueAt: '2026-08-07T03:00:00.000Z',
  }, '2026-08-06T00:00:00.000Z');
  assert.equal(valid.ok, true);
  assert.equal(valid.normalized.receivedAmount, 0n);
});

test('bank transfer COD requires a bank reference', () => {
  const result = codSettlementInternals.normalizeCollectionPayload({
    collectionMethod: 'BANK_TRANSFER',
    receivedAmount: '100000',
  }, '2026-08-06T00:00:00.000Z');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'COD_BANK_REFERENCE_REQUIRED');
});

test('handover normalizer rejects duplicate collection lineage', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const result = codSettlementInternals.normalizeHandoverPayload({
    lines: [
      { collectionId: id, amount: '10' },
      { collectionId: id, amount: '10' },
    ],
  }, '2026-08-06T00:00:00.000Z');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_COD_HANDOVER_LINE');
});
