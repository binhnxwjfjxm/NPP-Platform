import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculatePurchaseOrderLineFinancials,
  evaluatePurchaseOrderSkuEligibility,
} from '../src/services/purchase-order.js';

const BASE_SKU = Object.freeze({
  product_is_active: true,
  product_is_orderable: true,
  variant_is_active: true,
  is_purchasable: true,
  unit_id: 'unit-1',
  unit_is_active: true,
  conversion_to_base: '1',
});

test('purchase order sku eligibility explains every purchasing blocker', () => {
  assert.equal(evaluatePurchaseOrderSkuEligibility(BASE_SKU).code, 'ELIGIBLE');
  assert.equal(evaluatePurchaseOrderSkuEligibility({ ...BASE_SKU, product_is_active: false }).code, 'PRODUCT_INACTIVE');
  assert.equal(evaluatePurchaseOrderSkuEligibility({ ...BASE_SKU, product_is_orderable: false }).code, 'PRODUCT_NOT_ORDERABLE');
  assert.equal(evaluatePurchaseOrderSkuEligibility({ ...BASE_SKU, variant_is_active: false }).code, 'SKU_INACTIVE');
  assert.equal(evaluatePurchaseOrderSkuEligibility({ ...BASE_SKU, is_purchasable: false }).code, 'SKU_NOT_PURCHASABLE');
  assert.equal(evaluatePurchaseOrderSkuEligibility({ ...BASE_SKU, unit_id: null }).code, 'SKU_UNIT_MISSING');
  assert.equal(evaluatePurchaseOrderSkuEligibility({ ...BASE_SKU, unit_is_active: false }).code, 'SKU_UNIT_INACTIVE');
  assert.equal(evaluatePurchaseOrderSkuEligibility({ ...BASE_SKU, conversion_to_base: '0' }).code, 'SKU_CONVERSION_INVALID');
});

test('purchase order backend financials calculate percentage discount then tax', () => {
  const result = calculatePurchaseOrderLineFinancials(
    { discountMode: 'PERCENT', discountValue: '10', taxRate: '8' },
    { quantity: 2_000_000n, unitPrice: 100_000_000n },
  );
  assert.equal(result.ok, true);
  assert.equal(result.discountMode, 'PERCENT');
  assert.equal(result.discountAmount.toString(), '20000000');
  assert.equal(result.taxAmount.toString(), '14400000');
  assert.equal(result.lineTotal.toString(), '194400000');
});

test('purchase order backend financials support per-unit and total-line discounts', () => {
  const perUnit = calculatePurchaseOrderLineFinancials(
    { discountMode: 'PER_UNIT', discountValue: '5', taxRate: '10' },
    { quantity: 3_000_000n, unitPrice: 100_000_000n },
  );
  assert.equal(perUnit.ok, true);
  assert.equal(perUnit.discountAmount.toString(), '15000000');
  assert.equal(perUnit.taxAmount.toString(), '28500000');
  assert.equal(perUnit.lineTotal.toString(), '313500000');

  const total = calculatePurchaseOrderLineFinancials(
    { discountMode: 'TOTAL_AMOUNT', discountValue: '15', taxRate: '10' },
    { quantity: 3_000_000n, unitPrice: 100_000_000n },
  );
  assert.equal(total.ok, true);
  assert.equal(total.discountAmount.toString(), '15000000');
  assert.equal(total.lineTotal.toString(), '313500000');
});

test('purchase order backend rejects invalid percentage ranges and over-discounting', () => {
  assert.equal(calculatePurchaseOrderLineFinancials(
    { discountMode: 'PERCENT', discountValue: '100.000001', taxRate: '0' },
    { quantity: 1_000_000n, unitPrice: 100_000_000n },
  ).code, 'INVALID_DISCOUNT');
  assert.equal(calculatePurchaseOrderLineFinancials(
    { discountMode: 'TOTAL_AMOUNT', discountValue: '0', taxRate: '100.000001' },
    { quantity: 1_000_000n, unitPrice: 100_000_000n },
  ).code, 'INVALID_TAX');
  assert.equal(calculatePurchaseOrderLineFinancials(
    { discountMode: 'PER_UNIT', discountValue: '101', taxRate: '0' },
    { quantity: 1_000_000n, unitPrice: 100_000_000n },
  ).code, 'INVALID_DISCOUNT');
});
