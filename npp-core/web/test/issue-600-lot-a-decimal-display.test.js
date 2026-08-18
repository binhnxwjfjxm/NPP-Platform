import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addExactDecimal,
  formatExactDecimal,
  formatSignedExactDecimal,
  subtractExactDecimal,
} from '../lib/decimal-display.js';

const tripWorkspaceSource = readFileSync(new URL('../app/logistics/trip-reconciliation/trip-reconciliation-workspace.tsx', import.meta.url), 'utf8');
const tripPrintSource = readFileSync(new URL('../app/logistics/trip-reconciliation/TripReconciliationPrintDock.tsx', import.meta.url), 'utf8');
const salesPrintSource = readFileSync(new URL('../app/sales/sales-orders/SalesOrderPrintSheet.tsx', import.meta.url), 'utf8');
const adjustmentSource = readFileSync(new URL('../app/inventory/adjustments/workspace.tsx', import.meta.url), 'utf8');

test('Issue #600 Lot A keeps exact decimals while removing redundant zeroes', () => {
  assert.equal(formatExactDecimal('1.000000'), '1');
  assert.equal(formatExactDecimal('2.000000'), '2');
  assert.equal(formatExactDecimal('1.500000'), '1.5');
  assert.equal(formatExactDecimal('0.125000'), '0.125');
  assert.equal(formatExactDecimal('1.500001'), '1.500001');
  assert.equal(formatExactDecimal('12345678901234567890.000000000001'), '12345678901234567890.000000000001');
});

test('exact decimal helpers add and subtract inventory quantities without JavaScript float', () => {
  assert.equal(subtractExactDecimal('100', '10'), '90');
  assert.equal(subtractExactDecimal('10.000000000001', '0.000000000002'), '9.999999999999');
  assert.equal(addExactDecimal('10', '-2.5'), '7.5');
  assert.equal(addExactDecimal('12345678901234567890.000000000001', '0.000000000009'), '12345678901234567890.00000000001');
  assert.equal(formatSignedExactDecimal('90.000000'), '+90');
  assert.equal(formatSignedExactDecimal('-4.000000'), '-4');
  assert.equal(formatSignedExactDecimal('0.000000'), '0');
});

test('Issue #600 Lot A routes obvious reconciliation quantity displays through the shared formatter', () => {
  assert.match(tripWorkspaceSource, /formatExactDecimal/);
  for (const field of ['issuedBaseQuantity', 'deliveredBaseQuantity', 'returnedBaseQuantity', 'outstandingBaseQuantity']) {
    assert.match(tripWorkspaceSource, new RegExp(`formatExactDecimal\\(line\\.${field}\\)`));
  }
  assert.match(tripPrintSource, /formatExactDecimal\(line\.issuedBaseQuantity\)/);
  assert.match(tripPrintSource, /formatExactDecimal\(line\.deliveredBaseQuantity\)/);
  assert.match(tripPrintSource, /formatExactDecimal\(line\.returnedBaseQuantity\)/);
  assert.match(tripPrintSource, /formatExactDecimal\(line\.outstandingBaseQuantity\)/);
  assert.doesNotMatch(tripPrintSource, /const quantity = \(value: string\)/);
});

test('Issue #600 Lot A formats Sales print and inventory adjustment quantities without changing editable values', () => {
  assert.match(salesPrintSource, /formatQuantity\(line\.quantity\)/);
  assert.match(adjustmentSource, /formatQuantity\(item\.on_hand_quantity\)/);
  assert.match(adjustmentSource, /formatQuantity\(item\.available_quantity\)/);
  assert.match(adjustmentSource, /formatQuantity\(line\.quantity\)/);
  assert.match(adjustmentSource, /formatQuantity\(line\.baseQuantity\)/);
  assert.match(adjustmentSource, /value=\{draft\.quantity\}/);
  assert.match(adjustmentSource, /placeholder="0"/);
  assert.doesNotMatch(adjustmentSource, /placeholder="0\.000000"/);
});
