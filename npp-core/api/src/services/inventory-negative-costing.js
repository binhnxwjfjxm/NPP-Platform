function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function minBigInt(left, right) {
  return left < right ? left : right;
}

export function controlledNegativeStockAuthorization(row) {
  if (row?.direction === 'IN') return true;
  const evidence = row?.line_metadata?.negativeStockAuthorization
    ?? row?.movement_metadata?.negativeStockAuthorization;
  return row?.direction === 'OUT'
    && row?.movement_type === 'SALES_DELIVERY_ISSUE'
    && row?.source_domain === 'SALES'
    && evidence?.source === 'SERVER_POLICY'
    && evidence?.decision === 'ALLOW'
    && String(evidence?.warehouseId ?? '') === String(row?.warehouse_id ?? '');
}

export function negativeExposureQuantity(currentQuantity, quantityDelta) {
  if (typeof currentQuantity !== 'bigint'
      || typeof quantityDelta !== 'bigint'
      || quantityDelta >= 0n) return 0n;
  const nextQuantity = currentQuantity + quantityDelta;
  if (nextQuantity >= 0n) return 0n;
  const beforeNegative = currentQuantity < 0n ? -currentQuantity : 0n;
  const afterNegative = -nextQuantity;
  return afterNegative - beforeNegative;
}

export function currentPoolUnitCost(state, divide12) {
  if (!state || state.status !== 'COSTED') return null;
  if (state.quantity === 0n) {
    return typeof state.average === 'bigint' && state.average > 0n
      ? state.average
      : null;
  }
  if (typeof state.value !== 'bigint') return null;
  const average = divide12(state.value, state.quantity);
  return average !== null && average >= 0n ? average : null;
}

export function ensureNegativeCostLayers(state) {
  if (!Array.isArray(state.negativeCostLayers)) state.negativeCostLayers = [];
  return state.negativeCostLayers;
}

export function registerNegativeCostExposure({
  state,
  row,
  fact,
  exposedQuantity,
  provisionalUnitCost,
  format12,
}) {
  if (exposedQuantity <= 0n) return null;
  const layers = ensureNegativeCostLayers(state);
  const layer = {
    row,
    fact,
    remainingQuantity: exposedQuantity,
    provisionalUnitCost,
  };
  const baseSourceCostType = fact.sourceCostType;
  const authorization = row?.line_metadata?.negativeStockAuthorization
    ?? row?.movement_metadata?.negativeStockAuthorization
    ?? null;
  layers.push(layer);
  fact.sourceCostType = 'PROVISIONAL_NEGATIVE_STOCK';
  fact.metadata = {
    ...(fact.metadata ?? {}),
    negativeStock: {
      provisional: true,
      exposedQuantity: format12(exposedQuantity),
      settledQuantity: format12(0n),
      unsettledQuantity: format12(exposedQuantity),
      provisionalUnitCost: format12(provisionalUnitCost),
      baseSourceCostType,
      authorization,
      settlementValueAdjustment: format12(0n),
      settlements: [],
    },
  };
  return layer;
}

function orderedLayers(layers, targetFactId) {
  if (!targetFactId) return [...layers];
  return [
    ...layers.filter((layer) => layer.fact?.id === targetFactId),
    ...layers.filter((layer) => layer.fact?.id !== targetFactId),
  ];
}

function updateIssueFact({
  layer,
  settledQuantity,
  actualUnitCost,
  adjustment,
  settlementMovementLineId,
  parse12,
  divide12,
  format12,
}) {
  const fact = layer.fact;
  const currentValueDelta = parse12(fact.valueDelta);
  const totalIssueQuantity = parse12(fact.quantityDelta);
  if (currentValueDelta === null || totalIssueQuantity === null || totalIssueQuantity >= 0n) {
    throw new Error('negative_stock_fact_shape_invalid');
  }
  const nextValueDelta = currentValueDelta - adjustment;
  const effectiveUnitCost = divide12(
    nextValueDelta < 0n ? -nextValueDelta : nextValueDelta,
    -totalIssueQuantity,
  );
  if (effectiveUnitCost === null || effectiveUnitCost < 0n) {
    throw new Error('negative_stock_effective_unit_cost_invalid');
  }

  const current = fact.metadata?.negativeStock ?? {};
  const previouslySettled = parse12(current.settledQuantity ?? '0') ?? 0n;
  const previousAdjustment = parse12(current.settlementValueAdjustment ?? '0') ?? 0n;
  layer.remainingQuantity -= settledQuantity;
  const settledTotal = previouslySettled + settledQuantity;
  const adjustmentTotal = previousAdjustment + adjustment;
  const settlements = [
    ...asArray(current.settlements),
    {
      settlementMovementLineId,
      quantity: format12(settledQuantity),
      actualUnitCost: format12(actualUnitCost),
      valueAdjustment: format12(adjustment),
    },
  ];

  fact.unitCost = format12(effectiveUnitCost);
  fact.valueDelta = format12(nextValueDelta);
  fact.metadata = {
    ...(fact.metadata ?? {}),
    negativeStock: {
      ...current,
      provisional: layer.remainingQuantity > 0n,
      settledQuantity: format12(settledTotal),
      unsettledQuantity: format12(layer.remainingQuantity),
      settlementValueAdjustment: format12(adjustmentTotal),
      settlements,
    },
  };
  if (layer.remainingQuantity === 0n) fact.sourceCostType = 'NEGATIVE_STOCK_SETTLED';
}

export function settleNegativeCostLayers({
  state,
  inboundQuantity,
  actualUnitCost,
  settlementMovementLineId,
  targetFactId = null,
  multiply12,
  divide12,
  parse12,
  format12,
}) {
  if (inboundQuantity <= 0n) {
    return {
      settledQuantity: 0n,
      valueAdjustment: 0n,
      issueMovementLineIds: [],
    };
  }
  const layers = ensureNegativeCostLayers(state);
  let remaining = inboundQuantity;
  let settledQuantity = 0n;
  let valueAdjustment = 0n;
  const issueMovementLineIds = [];

  for (const layer of orderedLayers(layers, targetFactId)) {
    if (remaining <= 0n) break;
    if (layer.remainingQuantity <= 0n) continue;
    const settled = minBigInt(remaining, layer.remainingQuantity);
    const difference = actualUnitCost - layer.provisionalUnitCost;
    const adjustment = multiply12(settled, difference);
    updateIssueFact({
      layer,
      settledQuantity: settled,
      actualUnitCost,
      adjustment,
      settlementMovementLineId,
      parse12,
      divide12,
      format12,
    });
    remaining -= settled;
    settledQuantity += settled;
    valueAdjustment += adjustment;
    if (layer.row?.movement_line_id) issueMovementLineIds.push(layer.row.movement_line_id);
  }

  state.negativeCostLayers = layers.filter((layer) => layer.remainingQuantity > 0n);
  return {
    settledQuantity,
    valueAdjustment,
    issueMovementLineIds: [...new Set(issueMovementLineIds)],
  };
}

export function finalizePendingNegativeCostFacts({
  state,
  anomalyFor,
  format12,
}) {
  const layers = ensureNegativeCostLayers(state);
  const facts = new Map();
  for (const layer of layers) {
    if (layer.remainingQuantity <= 0n || !layer.fact?.id) continue;
    if (!facts.has(layer.fact.id)) facts.set(layer.fact.id, layer);
  }
  const anomalies = [];
  for (const layer of facts.values()) {
    const fact = layer.fact;
    const provisionalUnitCost = fact.unitCost;
    const provisionalValueDelta = fact.valueDelta;
    fact.status = 'ANOMALY';
    fact.unitCost = null;
    fact.valueDelta = null;
    fact.sourceCostType = 'NEGATIVE_STOCK_PENDING';
    fact.metadata = {
      ...(fact.metadata ?? {}),
      negativeStock: {
        ...(fact.metadata?.negativeStock ?? {}),
        provisional: true,
        provisionalEffectiveUnitCost: provisionalUnitCost,
        provisionalValueDelta,
      },
    };
    anomalies.push(anomalyFor(
      layer.row,
      'COST_NEGATIVE_STOCK_PENDING',
      'Negative stock is awaiting an inbound cost source before COGS can be finalized',
      {
        unsettledQuantity: format12(layer.remainingQuantity),
        provisionalUnitCost,
      },
    ));
  }
  return anomalies;
}
