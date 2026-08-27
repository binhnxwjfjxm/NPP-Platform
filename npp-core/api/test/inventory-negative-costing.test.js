import test from 'node:test';
import assert from 'node:assert/strict';
import {
  controlledNegativeStockAuthorization,
  finalizePendingNegativeCostFacts,
  negativeExposureQuantity,
  registerNegativeCostExposure,
  settleNegativeCostLayers,
} from '../src/services/inventory-negative-costing.js';
import {
  divide12,
  format12,
  multiply12,
  parse12,
} from '../src/services/inventory-costing-period-utils.js';

test('controlled negative costing only requires exact server policy evidence for sales OUT', () => {
  const row = {
    direction: 'OUT',
    movement_type: 'SALES_DELIVERY_ISSUE',
    source_domain: 'SALES',
    warehouse_id: '11111111-1111-4111-8111-111111111111',
    line_metadata: {
      negativeStockAuthorization: {
        source: 'SERVER_POLICY',
        decision: 'ALLOW',
        warehouseId: '11111111-1111-4111-8111-111111111111',
      },
    },
  };
  assert.equal(controlledNegativeStockAuthorization(row), true);
  assert.equal(controlledNegativeStockAuthorization({ ...row, direction: 'IN', line_metadata: {} }), true);
  assert.equal(controlledNegativeStockAuthorization({
    ...row,
    line_metadata: {
      negativeStockAuthorization: {
        source: 'CLIENT',
        decision: 'ALLOW',
        warehouseId: row.warehouse_id,
      },
    },
  }), false);
  assert.equal(controlledNegativeStockAuthorization({
    ...row,
    line_metadata: {
      negativeStockAuthorization: {
        source: 'SERVER_POLICY',
        decision: 'ALLOW',
        warehouseId: '22222222-2222-4222-8222-222222222222',
      },
    },
  }), false);
});

test('negative exposure only records the quantity crossing below zero', () => {
  assert.equal(negativeExposureQuantity(parse12('10'), parse12('-15')), parse12('5'));
  assert.equal(negativeExposureQuantity(parse12('-5'), parse12('-2')), parse12('2'));
  assert.equal(negativeExposureQuantity(parse12('10'), parse12('-5')), 0n);
});

test('negative costing settlement produces final COGS and ending inventory deterministically', () => {
  const state = {
    quantity: parse12('-5'),
    value: parse12('-500'),
    average: parse12('100'),
    status: 'COSTED',
    negativeCostLayers: [],
  };
  const row = {
    movement_line_id: 'issue-line-1',
    warehouse_id: '11111111-1111-4111-8111-111111111111',
    line_metadata: {
      negativeStockAuthorization: {
        source: 'SERVER_POLICY',
        decision: 'ALLOW',
        warehouseId: '11111111-1111-4111-8111-111111111111',
      },
    },
  };
  const fact = {
    id: 'fact-1',
    quantityDelta: '-15.000000000000',
    unitCost: '100.000000000000',
    valueDelta: '-1500.000000000000',
    sourceCostType: 'CURRENT_POOL_AVERAGE',
    metadata: {},
  };
  registerNegativeCostExposure({
    state,
    row,
    fact,
    exposedQuantity: parse12('5'),
    provisionalUnitCost: parse12('100'),
    format12,
  });

  const settlement = settleNegativeCostLayers({
    state,
    inboundQuantity: parse12('8'),
    actualUnitCost: parse12('120'),
    settlementMovementLineId: 'receipt-line-1',
    multiply12,
    divide12,
    parse12,
    format12,
  });
  assert.equal(format12(settlement.settledQuantity), '5.000000000000');
  assert.equal(format12(settlement.valueAdjustment), '100.000000000000');
  assert.equal(fact.valueDelta, '-1600.000000000000');
  assert.equal(fact.unitCost, '106.666666666667');
  assert.equal(fact.sourceCostType, 'NEGATIVE_STOCK_SETTLED');
  assert.equal(state.negativeCostLayers.length, 0);

  const inboundValue = parse12('960') - settlement.valueAdjustment;
  state.quantity += parse12('8');
  state.value += inboundValue;
  state.average = divide12(state.value, state.quantity);
  assert.equal(format12(state.quantity), '3.000000000000');
  assert.equal(format12(state.value), '360.000000000000');
  assert.equal(format12(state.average), '120.000000000000');
});

test('partially unsettled negative cost is persisted as pending anomaly, not final COGS', () => {
  const state = {
    quantity: parse12('-5'),
    value: parse12('-500'),
    average: parse12('100'),
    status: 'COSTED',
    negativeCostLayers: [],
  };
  const row = {
    movement_id: 'movement-1',
    movement_line_id: 'issue-line-1',
    warehouse_id: 'warehouse-1',
    base_variant_id: 'variant-1',
    line_metadata: {},
  };
  const fact = {
    id: 'fact-1',
    quantityDelta: '-5.000000000000',
    unitCost: '100.000000000000',
    valueDelta: '-500.000000000000',
    sourceCostType: 'CURRENT_POOL_AVERAGE',
    metadata: {},
  };
  registerNegativeCostExposure({
    state,
    row,
    fact,
    exposedQuantity: parse12('5'),
    provisionalUnitCost: parse12('100'),
    format12,
  });
  assert.equal(controlledNegativeStockAuthorization({ direction: 'IN' }), true);
  settleNegativeCostLayers({
    state,
    inboundQuantity: parse12('2'),
    actualUnitCost: parse12('120'),
    settlementMovementLineId: 'receipt-line-1',
    multiply12,
    divide12,
    parse12,
    format12,
  });

  const anomalies = finalizePendingNegativeCostFacts({
    state,
    format12,
    anomalyFor: (_row, code, message, details) => ({ code, message, details }),
  });
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].code, 'COST_NEGATIVE_STOCK_PENDING');
  assert.equal(fact.status, 'ANOMALY');
  assert.equal(fact.sourceCostType, 'NEGATIVE_STOCK_PENDING');
  assert.equal(fact.unitCost, null);
  assert.equal(fact.valueDelta, null);
  assert.equal(fact.metadata.negativeStock.unsettledQuantity, '3.000000000000');
});
