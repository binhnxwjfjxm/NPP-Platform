import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierPaymentInternals } from '../src/services/supplier-payment.js';

test('supplier payment decimals preserve sign and six-digit scale', () => {
  const { decimalToScaled, scaledToDecimal } = supplierPaymentInternals;
  const amount = decimalToScaled('1250.500001');
  assert.equal(amount, 1_250_500_001n);
  assert.equal(scaledToDecimal(amount), '1250.500001');
  assert.equal(scaledToDecimal(-amount), '-1250.500001');
  assert.equal(scaledToDecimal(0n), '0.000000');
});
