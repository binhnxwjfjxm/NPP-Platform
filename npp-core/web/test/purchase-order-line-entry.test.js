import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculatePurchaseOrderDraftTotals,
  calculatePurchaseOrderLineFinancials,
  decimalToScaled,
  formatDecimalForDisplay,
  formatDecimalForInput,
  normalizeDecimalForApi,
  parsePurchaseOrderPasteGrid,
} from '../lib/purchase-order-line-entry.js';

test('purchase order line entry normalizes comma or dot decimals without trailing zeros', () => {
  assert.equal(normalizeDecimalForApi('001,230000'), '1.23');
  assert.equal(formatDecimalForInput('10.000000'), '10');
  assert.equal(formatDecimalForDisplay('80000.000000'), '80.000');
  assert.equal(formatDecimalForDisplay('1.250000'), '1,25');
  assert.equal(decimalToScaled('2,5')?.toString(), '2500000');
});

test('purchase order line entry computes percentage, per-unit and total discounts exactly', () => {
  const percent = calculatePurchaseOrderLineFinancials({ quantity: '2', unitPrice: '100', discountMode: 'PERCENT', discountValue: '10', taxRate: '8' });
  assert.equal(percent?.gross, '200');
  assert.equal(percent?.discountAmount, '20');
  assert.equal(percent?.taxAmount, '14.4');
  assert.equal(percent?.lineTotal, '194.4');

  const perUnit = calculatePurchaseOrderLineFinancials({ quantity: '3', unitPrice: '100', discountMode: 'PER_UNIT', discountValue: '5', taxRate: '10' });
  assert.equal(perUnit?.discountAmount, '15');
  assert.equal(perUnit?.lineTotal, '313.5');

  const total = calculatePurchaseOrderLineFinancials({ quantity: '3', unitPrice: '100', discountMode: 'TOTAL_AMOUNT', discountValue: '15', taxRate: '10' });
  assert.equal(total?.lineTotal, '313.5');

  const totals = calculatePurchaseOrderDraftTotals([
    { quantity: '2', unitPrice: '100', discountMode: 'PERCENT', discountValue: '10', taxRate: '8' },
    { quantity: '3', unitPrice: '100', discountMode: 'PER_UNIT', discountValue: '5', taxRate: '10' },
  ]);
  assert.equal(totals.total, '507.9');
});

test('purchase order line entry preserves legacy absolute tax snapshots until a rate is supplied', () => {
  const legacy = calculatePurchaseOrderLineFinancials({
    quantity: '2', unitPrice: '100', discountMode: 'TOTAL_AMOUNT', discountValue: '10', taxRate: '', taxAmount: '7.5',
  });
  assert.equal(legacy?.taxRate, null);
  assert.equal(legacy?.taxAmount, '7.5');
  assert.equal(legacy?.lineTotal, '197.5');

  const converted = calculatePurchaseOrderLineFinancials({
    quantity: '2', unitPrice: '100', discountMode: 'TOTAL_AMOUNT', discountValue: '10', taxRate: '8', taxAmount: '7.5',
  });
  assert.equal(converted?.taxRate, '8');
  assert.equal(converted?.taxAmount, '15.2');
  assert.equal(converted?.lineTotal, '205.2');
});

test('purchase order line entry rejects percentage values above 100', () => {
  assert.equal(calculatePurchaseOrderLineFinancials({ quantity: '1', unitPrice: '100', discountMode: 'PERCENT', discountValue: '100,000001', taxRate: '0' }), null);
  assert.equal(calculatePurchaseOrderLineFinancials({ quantity: '1', unitPrice: '100', discountMode: 'TOTAL_AMOUNT', discountValue: '0', taxRate: '100.000001' }), null);
});

test('purchase order paste grid accepts Excel tabs and semicolon rows with decimal comma', () => {
  const tabPreview = parsePurchaseOrderPasteGrid('SKU\tSố lượng\tĐơn giá\tKiểu CK\tGiá trị CK\tThuế %\tGhi chú\nSKU-1\t2,5\t100\tPERCENT\t5\t8\tGấp');
  assert.equal(tabPreview.length, 1);
  assert.deepEqual(tabPreview[0].errors, []);
  assert.equal(tabPreview[0].quantity, '2,5');
  assert.equal(tabPreview[0].rowNumber, 2);

  const semicolonPreview = parsePurchaseOrderPasteGrid('SKU-2;1,25;80.000;PER_UNIT;2,5;8;Ghi chú');
  assert.equal(semicolonPreview.length, 1);
  assert.deepEqual(semicolonPreview[0].errors, []);
  assert.equal(normalizeDecimalForApi(semicolonPreview[0].unitPrice), '80');

  const wholeAmount = parsePurchaseOrderPasteGrid('SKU-2;1,25;80000;PER_UNIT;2,5;8;Ghi chú');
  assert.deepEqual(wholeAmount[0].errors, []);
  assert.equal(normalizeDecimalForApi(wholeAmount[0].unitPrice), '80000');
});

test('purchase order paste grid parses quoted comma-delimited CSV', () => {
  const preview = parsePurchaseOrderPasteGrid('SKU,Số lượng,Đơn giá,Kiểu chiết khấu,Giá trị chiết khấu,Thuế %,Ghi chú\nSKU-CSV,2.5,100,PERCENT,5,8,"Gấp, giao sáng"');
  assert.equal(preview.length, 1);
  assert.deepEqual(preview[0].errors, []);
  assert.equal(preview[0].quantity, '2.5');
  assert.equal(preview[0].note, 'Gấp, giao sáng');
});

test('purchase order paste grid reports rows omitted beyond the 500-row limit', () => {
  const rows = Array.from({ length: 502 }, (_, index) => `SKU-${index + 1};1;100;TOTAL_AMOUNT;0;0`).join('\n');
  const preview = parsePurchaseOrderPasteGrid(rows);
  assert.equal(preview.length, 501);
  assert.equal(preview[499].rowNumber, 500);
  assert.match(preview[500].errors[0], /Đã bỏ qua 2 dòng/);
});

test('purchase order paste grid reports malformed rows without mutating a draft', () => {
  const preview = parsePurchaseOrderPasteGrid('SKU-1;2;100;PERCENT;5;8;note\n;0;bad;TOTAL_AMOUNT;0;0');
  assert.equal(preview.length, 2);
  assert.deepEqual(preview[0].errors, []);
  assert.ok(preview[1].errors.some((error) => error.includes('SKU')));
  assert.ok(preview[1].errors.length >= 2);
});
