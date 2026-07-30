import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculatePurchaseOrderLineFinancials,
  evaluatePurchaseOrderSkuEligibility,
} from '../src/services/purchase-order.js';

test('purchase order sku eligibility explains inactive, non-purchasable, unit and conversion blockers', () => {
  const base = { product_is_active: true, variant_is_active: true, is_purchasable: true, unit_id: 'unit-1', unit_is_active: true, conversion_to_base: '1' };
  assert.equal(evaluatePurchaseOrderSkuEligibility(base).code, 'ELIGIBLE');
  assert.equal(evaluatePurchaseOrderSkuEligibility({ ...base, is_purchasable: false }).code, 'SKU_NOT_PURCHASABLE');
  assert.equal(evaluatePurchaseOrderSkuEligibility({ ...base, unit_id: null }).code, 'SKU_UNIT_MISSING');
  assert.equal(evaluatePurchaseOrderSkuEligibility({ ...base, conversion_to_base: '0' }).code, 'SKU_CONVERSION_INVALID');
});

test('purchase order backend financials keep percent discount and tax snapshots', () => {
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
