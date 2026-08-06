import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventoryCostingInternals } from '../src/services/inventory-costing.js';

test('migration 062 owns immutable facts and projector-only balances', () => {
  const sql = readFileSync(
    new URL('../../../database/migrations/inventory/062_inventory_costing_foundation.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /inventory_cost_rebuild_runs/);
  assert.match(sql, /inventory_cost_facts/);
  assert.match(sql, /inventory_cost_anomalies/);
  assert.match(sql, /inventory_cost_balances/);
  assert.match(sql, /inventory_cost_facts_are_append_only/);
  assert.match(sql, /inventory_cost_balance_requires_projector_context/);
  assert.match(sql, /inventory_cost_reconciliation/);
  assert.match(sql, /core\.inventory-cost\.rebuild/);
  assert.doesNotMatch(sql, /UPDATE\s+inventory\.inventory_balances/i);
});

test('fixed-point costing arithmetic is deterministic at scale 12', () => {
  const {
    parseScale12,
    formatScale12,
    multiplyRounded,
    divideRounded,
  } = inventoryCostingInternals;
  const quantity = parseScale12('3.000000000000');
  const unitCost = parseScale12('33.333333333333');
  assert.equal(formatScale12(multiplyRounded(quantity, unitCost)), '99.999999999999');
  assert.equal(
    formatScale12(divideRounded(parseScale12('100.000000000000'), quantity)),
    '33.333333333333',
  );
});

test('purchase receipt cost excludes recoverable tax and allocates net amount to base quantity', () => {
  const result = inventoryCostingInternals.purchaseUnitCost({
    purchase_order_quantity: '10.000000000000',
    purchase_order_base_quantity: '20.000000000000',
    purchase_unit_price: '100.000000000000',
    purchase_discount_amount: '100.000000000000',
    purchase_order_line_id: 'line-1',
    goods_receipt_line_id: 'receipt-line-1',
  });
  assert.equal(result.ok, true);
  assert.equal(
    inventoryCostingInternals.formatScale12(result.unitCost),
    '45.000000000000',
  );
  assert.equal(result.sourceCostType, 'PURCHASE_ORDER_NET');
});

test('warehouse selection is server scoped and canonical', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const context = {
    scopes: { warehouseIds: [second, first] },
  };
  const selected = inventoryCostingInternals.normalizedWarehouseSelection(
    context,
    { warehouseIds: [second, first, second] },
  );
  assert.equal(selected.ok, true);
  assert.deepEqual(selected.warehouseIds, [first, second]);

  const denied = inventoryCostingInternals.normalizedWarehouseSelection(
    context,
    { warehouseIds: ['33333333-3333-4333-8333-333333333333'] },
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'WAREHOUSE_SCOPE_DENIED');
});

test('costing payload hash is canonical', () => {
  const { payloadHash } = inventoryCostingInternals;
  assert.equal(
    payloadHash({ b: 2, a: { d: 4, c: 3 } }),
    payloadHash({ a: { c: 3, d: 4 }, b: 2 }),
  );
});
