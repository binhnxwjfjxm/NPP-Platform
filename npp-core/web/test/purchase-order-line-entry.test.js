import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculatePurchaseOrderDraftTotals,
  calculatePurchaseOrderLineFinancials,
  decimalToScaled,
  formatDecimalForInput,
  normalizeDecimalForApi,
  parsePurchaseOrderPasteGrid,
} from '../lib/purchase-order-line-entry.js';

test('purchase order line entry normalizes comma/dot decimals without trailing zeros', () => {
  assert.equal(normalizeDecimalForApi('001,230000'), '1.23');
  assert.equal(formatDecimalForInput('10.000000'), '10');
  assert.equal(decimalToScaled('2,5')?.toString(), '2500000');
});

test('purchase order line entry computes percent discount and tax from backend formula', () => {
  const line = calculatePurchaseOrderLineFinancials({ quantity: '2', unitPrice: '100', discountMode: 'PERCENT', discountValue: '10', taxRate: '8' });
  assert.equal(line?.gross, '200');
  assert.equal(line?.discountAmount, '20');
  assert.equal(line?.taxAmount, '14.4');
  assert.equal(line?.lineTotal, '194.4');
  const totals = calculatePurchaseOrderDraftTotals([{ quantity: '2', unitPrice: '100', discountMode: 'PERCENT', discountValue: '10', taxRate: '8' }]);
  assert.equal(totals.total, '194.4');
});

test('purchase order paste grid previews row errors without mutating draft', () => {
  const preview = parsePurchaseOrderPasteGrid('SKU-1,2,100,PERCENT,5,8,note\n,0,bad,TOTAL_AMOUNT,0,0');
  assert.equal(preview.length, 2);
  assert.deepEqual(preview[0].errors, []);
  assert.ok(preview[1].errors.some((error) => error.includes('SKU')));
  assert.ok(preview[1].errors.length >= 2);
});

