import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateLineWeightSnapshot } from '../src/services/sales-order-legacy.js';
import { validateProductVariantInput } from '../src/services/product.js';

test('SKU weight accepts exact g/kg pairs and rejects partial/zero data', () => {
  assert.equal(validateProductVariantInput({ sku: 'A', name: 'A', weightValue: '500', weightUomCode: 'G' }).ok, true);
  assert.equal(validateProductVariantInput({ sku: 'B', name: 'B', weightValue: '0.125', weightUomCode: 'KG' }).ok, true);
  assert.equal(validateProductVariantInput({ sku: 'C', name: 'C', weightValue: '1' }).ok, false);
  assert.equal(validateProductVariantInput({ sku: 'D', name: 'D', weightValue: '0', weightUomCode: 'KG' }).ok, false);
});

test('sales line weight uses exact integer decimal math for g and kg', () => {
  assert.deepEqual(calculateLineWeightSnapshot({ weightValue: '500', weightUomCode: 'G', quantity: '3' }), { ok: true, unitWeightKg: '0.5', lineWeightKg: '1.5' });
  assert.deepEqual(calculateLineWeightSnapshot({ weightValue: '0.125', weightUomCode: 'KG', quantity: '2.5' }), { ok: true, unitWeightKg: '0.125', lineWeightKg: '0.3125' });
  assert.deepEqual(calculateLineWeightSnapshot({ weightValue: null, weightUomCode: null, quantity: '2' }), { ok: true, unitWeightKg: null, lineWeightKg: null });
  assert.equal(calculateLineWeightSnapshot({ weightValue: '1', weightUomCode: null, quantity: '2' }).ok, false);
});

test('migration 117 owns SKU weight and immutable order-line snapshots', () => {
  const sql = readFileSync(new URL('../../../database/migrations/shared/117_sku_weight_sales_order_snapshot.sql', import.meta.url), 'utf8');
  assert.match(sql, /product_variants[\s\S]*weight_value/);
  assert.match(sql, /unit_weight_kg numeric\(24,9\)/);
  assert.match(sql, /line_weight_kg numeric\(30,9\)/);
  assert.match(sql, /round\(unit_weight_kg \* ordered_quantity, 9\)/);
});
