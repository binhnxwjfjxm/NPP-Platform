import test from 'node:test';
import assert from 'node:assert/strict';
import { customerReturnCreditInternals } from '../src/services/customer-return-credit.js';

test('customer return credit money parser is fixed-point and exact', () => {
  assert.equal(customerReturnCreditInternals.decimalToScaled('0.000001'), 1n);
  assert.equal(customerReturnCreditInternals.decimalToScaled('123.456789'), 123456789n);
  assert.equal(customerReturnCreditInternals.scaledToDecimal(123456789n), '123.456789');
  assert.equal(customerReturnCreditInternals.decimalToScaled('1.0000001'), null);
  assert.equal(customerReturnCreditInternals.decimalToScaled('-1'), null);
});

test('refund date validation rejects normalized calendar overflow', () => {
  assert.equal(customerReturnCreditInternals.dateOnly('2026-02-29'), null);
  assert.equal(customerReturnCreditInternals.dateOnly('2026-08-06'), '2026-08-06');
});

test('refund payload hashing is stable across key order', () => {
  const left = customerReturnCreditInternals.payloadHash({ b: 2, a: { y: 2, x: 1 } });
  const right = customerReturnCreditInternals.payloadHash({ a: { x: 1, y: 2 }, b: 2 });
  assert.equal(left, right);
  assert.match(left, /^[0-9a-f]{64}$/);
});
