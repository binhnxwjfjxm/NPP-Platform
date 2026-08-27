import { randomUUID } from 'node:crypto';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import * as repository from '../db/repositories/inventory-costing.js';
import { inventoryCostingInternals } from './inventory-costing.js';
import {
  controlledNegativeStockAuthorization,
  ensureNegativeCostLayers,
  finalizePendingNegativeCostFacts,
  negativeExposureQuantity,
  registerNegativeCostExposure,
  settleNegativeCostLayers,
} from './inventory-negative-costing.js';
import {
  CURRENCY_CODE,
  METHOD_VERSION,
  divide12,
  failure,
  format12,
  hashPayload,
  multiply12,
  parse12,
} from './inventory-costing-period-utils.js';
import {
  closedLateMovements,
  compareEvents,
  discrepancy,
  earliestAffected,
  latestClosedPeriod,
  resolveQueue,
  seedPools,
} from './inventory-costing-period-support.js';
import {
  anomalyFor,
  baseState,
  movementFact,
  movementResolution,
} from './inventory-costing-period-resolution.js';

async function openPeriod(client, installationId) {
  const result = await client.query(
    `SELECT * FROM inventory.inventory_costing_periods
      WHERE installation_id=$1 AND status='OPEN' LIMIT 1`,
    [installationId],
  );
  return result.rows?.[0] ?? null;
}

async function adjustmentEvents(client, installationId, selected, afterDate, throughDate) {
  const result = await client.query(
    `SELECT * FROM inventory.inventory_cost_adjustment_events
      WHERE installation_id=$1 AND warehouse_id=ANY($2::uuid[])
        AND ($3::date IS NULL OR posting_date>$3::date)
        AND ($4::date IS NULL OR posting_date<=$4::date)
      ORDER BY posting_date,created_at,id`,
    [installationId, selected, afterDate, throughDate],
  );
  return result.rows ?? [];
}

function balanceRows(pools) {
  return [...pools.values()].map((state) => {
    const negativePending = ensureNegativeCostLayers(state).length > 0;
    const status = state.status === 'COSTED' && !negativePending ? 'COSTED' : 'ANOMALY';
    return {
      warehouseId: state.warehouseId,
      baseVariantId: state.baseVariantId,
      methodVersion: METHOD_VERSION,
      currencyCode: CURRENCY_CODE,
      quantity: format12(state.quantity),
      inventoryValue: status === 'COSTED' ? format12(state.value) : null,
      averageUnitCost: status === 'COSTED' ? format12(state.average) : null,
      status,
      anomalyCount: state.anomalyCount,
      projectedThroughEvent: state.projectedThroughEvent,
    };
  });
}

function mapRun(row) {
  return {
    id: row.id,
    methodVersion: row.method_version,
    currencyCode: row.currency_code,
    warehouseIds: row.warehouse_ids ?? [],
    ledgerLineCount: Number(row.ledger_line_count),
    factCount: Number(row.fact_count),
    anomalyCount: Number(row.anomaly_count),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdBy: row.created_by,
    requestId: row.request_id,
  };
}

export async function rebuildOpenCosting(client, {
  requestContext,
  idempotencyKey,
  payload = {},
  replaceProjection = true,
  throughDate = null,
}) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must contain 1-128 safe characters');
  }
  const selection = inventoryCostingInternals.normalizedWarehouseSelection(requestContext, payload);
  if (!selection.ok) return selection;
  await repository.lockRebuild(client, {
    installationId: requestContext.installationId,
    warehouseIds: selection.warehouseIds,
  });

  const closed = await latestClosedPeriod(client, requestContext.installationId);
  const currentPeriod = await openPeriod(client, requestContext.installationId);
  if (closed && !currentPeriod) {
    return failure('COSTING_PERIOD_REQUIRED', 'Open the next costing period before rebuilding after a CLOSED period');
  }
  const upperBound = throughDate
    ?? (currentPeriod ? String(currentPeriod.period_end).slice(0, 10) : null);
  const normalizedPayload = {
    methodVersion: METHOD_VERSION,
    currencyCode: CURRENCY_CODE,
    warehouseIds: selection.warehouseIds,
    periodAware: true,
    seededFromPeriodId: closed?.id ?? null,
    throughDate: upperBound,
  };
  const hash = hashPayload(normalizedPayload);
  const replay = await repository.getRunByIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
  });
  if (replay) {
    if (replay.payload_hash !== hash) {
      return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was already used with another costing scope');
    }
    return { ok: true, run: mapRun(replay), replayed: true };
  }

  const pools = await seedPools(
    client,
    requestContext.installationId,
    closed?.id ?? null,
    selection.warehouseIds,
  );
  const allRows = await repository.listLedgerLines(client, {
    installationId: requestContext.installationId,
    warehouseIds: selection.warehouseIds,
  });
  const afterDate = closed ? String(closed.period_end).slice(0, 10) : null;
  const movementRows = allRows.filter((row) => {
    const effective = String(row.document_date).slice(0, 10);
    if (afterDate && effective <= afterDate) return false;
    if (upperBound && effective > upperBound) return false;
    if (currentPeriod) {
      const start = String(currentPeriod.period_start).slice(0, 10);
      const end = String(currentPeriod.period_end).slice(0, 10);
      if ((closed && effective < start) || effective > end) return false;
    }
    return true;
  });
  const adjustments = await adjustmentEvents(
    client,
    requestContext.installationId,
    selection.warehouseIds,
    afterDate,
    upperBound,
  );
  const events = [
    ...movementRows.map((row) => ({ kind: 'movement', row })),
    ...adjustments.map((row) => ({ kind: 'adjustment', row })),
  ].sort(compareEvents);
  const earliest = await earliestAffected(
    client,
    requestContext.installationId,
    selection.warehouseIds,
    closed?.id ?? null,
    events,
  );

  await resolveQueue(client, requestContext.installationId, selection.warehouseIds, [
    'CLOSED_PERIOD_LATE_MOVEMENT',
    'COST_ANOMALY',
    'QUANTITY_MISMATCH',
    'ADJUSTMENT_PROJECTION_ERROR',
  ]);
  for (const late of await closedLateMovements(
    client,
    requestContext.installationId,
    selection.warehouseIds,
    closed,
  )) {
    await discrepancy(client, {
      installationId: requestContext.installationId,
      code: 'CLOSED_PERIOD_LATE_MOVEMENT',
      warehouseId: late.warehouse_id,
      baseVariantId: late.base_variant_id,
      movementId: late.movement_id,
      movementLineId: late.movement_line_id,
      periodId: closed.id,
      stableKey: `closed-late:${late.movement_line_id}`,
      message: 'Movement was posted after the costing period closed and requires forward correction',
      details: { effectiveDate: late.document_date, postedAt: late.posted_at },
    });
  }

  const runId = randomUUID();
  const facts = [];
  const anomalies = [];
  const factsByLineId = new Map();
  const factsByMovementLine = new Map();
  const transferCosts = new Map();
  const pairedCosts = new Map();
  let eventOrder = 0;

  for (const event of events) {
    eventOrder += 1;
    const row = event.row;
    const key = `${row.warehouse_id}:${row.base_variant_id}`;
    const state = pools.get(key) ?? baseState(row);
    ensureNegativeCostLayers(state);
    pools.set(key, state);
    state.projectedThroughEvent = eventOrder;

    if (event.kind === 'adjustment') {
      const quantityDelta = parse12(row.quantity_delta);
      const valueDelta = parse12(row.value_delta);
      const invalid = quantityDelta === null || valueDelta === null
        || state.status !== 'COSTED'
        || state.quantity + quantityDelta < 0n
        || state.value + valueDelta < 0n
        || (state.quantity + quantityDelta === 0n && state.value + valueDelta !== 0n);
      if (invalid) {
        state.status = 'ANOMALY';
        state.anomalyCount += 1;
        await discrepancy(client, {
          installationId: requestContext.installationId,
          code: 'ADJUSTMENT_PROJECTION_ERROR',
          warehouseId: row.warehouse_id,
          baseVariantId: row.base_variant_id,
          adjustmentId: row.id,
          stableKey: `adjustment:${row.id}`,
          message: 'Cost adjustment cannot be applied to the current pool state',
          details: { quantityDelta: row.quantity_delta, valueDelta: row.value_delta },
        });
        continue;
      }
      state.quantity += quantityDelta;
      state.value += valueDelta;
      if (state.quantity === 0n) {
        if (valueDelta !== 0n && quantityDelta !== 0n) {
          state.average = divide12(valueDelta, quantityDelta) ?? state.average;
        }
      } else {
        state.average = divide12(state.value, state.quantity) ?? state.average;
      }
      continue;
    }

    const quantityDelta = parse12(row.base_quantity_delta);
    if (quantityDelta === null || quantityDelta === 0n) {
      const anomaly = anomalyFor(row, 'COST_QUANTITY_INVALID', 'Inventory movement line has an invalid base quantity', { baseQuantityDelta: row.base_quantity_delta });
      anomalies.push(anomaly);
      state.status = 'ANOMALY';
      state.anomalyCount += 1;
      const fact = movementFact(row, runId, eventOrder, {
        status: 'ANOMALY', unitCost: null, valueDelta: null,
        sourceCostType: 'UNRESOLVED', metadata: { anomalyCode: anomaly.code },
      });
      facts.push(fact);
      factsByLineId.set(row.movement_line_id, fact);
      factsByMovementLine.set(`${row.movement_id}:${Number(row.line_number)}`, fact);
      continue;
    }

    const resolution = await movementResolution({
      client,
      installationId: requestContext.installationId,
      row,
      state,
      transferCosts,
      pairedCosts,
      factsByLineId,
      factsByMovementLine,
    });
    const reversalOfCostFactId = resolution.reversalOfCostFactId ?? null;
    if (!resolution.ok || resolution.unitCost === null) {
      const anomaly = anomalyFor(row, resolution.code ?? 'COST_SOURCE_UNRESOLVED', resolution.message ?? 'Cost source could not be resolved', resolution.details ?? {});
      anomalies.push(anomaly);
      state.quantity += quantityDelta;
      state.value = 0n;
      state.average = 0n;
      state.status = 'ANOMALY';
      state.anomalyCount += 1;
      const fact = movementFact(row, runId, eventOrder, {
        status: 'ANOMALY', unitCost: null, valueDelta: null,
        sourceCostType: 'UNRESOLVED', reversalOfCostFactId,
        metadata: { anomalyCode: anomaly.code },
      });
      facts.push(fact);
      factsByLineId.set(row.movement_line_id, fact);
      factsByMovementLine.set(`${row.movement_id}:${Number(row.line_number)}`, fact);
      continue;
    }
    if (state.status === 'ANOMALY') {
      const anomaly = anomalyFor(row, 'POOL_COST_BLOCKED', 'Cost pool has an earlier unresolved event and cannot continue valuation');
      anomalies.push(anomaly);
      state.quantity += quantityDelta;
      state.anomalyCount += 1;
      const fact = movementFact(row, runId, eventOrder, {
        status: 'ANOMALY', unitCost: null, valueDelta: null,
        sourceCostType: 'BLOCKED_BY_PRIOR_ANOMALY', reversalOfCostFactId,
        metadata: { anomalyCode: anomaly.code },
      });
      facts.push(fact);
      factsByLineId.set(row.movement_line_id, fact);
      factsByMovementLine.set(`${row.movement_id}:${Number(row.line_number)}`, fact);
      continue;
    }

    const absoluteQuantity = quantityDelta < 0n ? -quantityDelta : quantityDelta;
    const grossValueDelta = multiply12(absoluteQuantity, resolution.unitCost);
    let valueDelta = quantityDelta < 0n ? -grossValueDelta : grossValueDelta;
    const nextQuantity = state.quantity + quantityDelta;
    const controlledNegative = nextQuantity < 0n && controlledNegativeStockAuthorization(row);
    if (nextQuantity < 0n && !controlledNegative) {
      const anomaly = anomalyFor(row, 'COST_NEGATIVE_STOCK', 'Cost projection would become negative', {
        poolQuantity: format12(state.quantity), quantityDelta: format12(quantityDelta),
      });
      anomalies.push(anomaly);
      state.quantity += quantityDelta;
      state.value = 0n;
      state.average = 0n;
      state.status = 'ANOMALY';
      state.anomalyCount += 1;
      const fact = movementFact(row, runId, eventOrder, {
        status: 'ANOMALY', unitCost: null, valueDelta: null,
        sourceCostType: 'UNRESOLVED', reversalOfCostFactId,
        metadata: { anomalyCode: anomaly.code },
      });
      facts.push(fact);
      factsByLineId.set(row.movement_line_id, fact);
      factsByMovementLine.set(`${row.movement_id}:${Number(row.line_number)}`, fact);
      continue;
    }

    let metadata = { ...(resolution.metadata ?? {}) };
    if (quantityDelta > 0n && state.negativeCostLayers.length > 0) {
      const settlement = settleNegativeCostLayers({
        state,
        inboundQuantity: quantityDelta,
        actualUnitCost: resolution.unitCost,
        settlementMovementLineId: row.movement_line_id,
        targetFactId: resolution.metadata?.originalCostFactId ?? reversalOfCostFactId,
        multiply12,
        divide12,
        parse12,
        format12,
      });
      if (settlement.settledQuantity > 0n) {
        valueDelta -= settlement.valueAdjustment;
        metadata = {
          ...metadata,
          negativeStockSettlement: {
            settledQuantity: format12(settlement.settledQuantity),
            valueAdjustment: format12(settlement.valueAdjustment),
            grossInboundValue: format12(grossValueDelta),
            issueMovementLineIds: settlement.issueMovementLineIds,
          },
        };
      }
    }

    const previousQuantity = state.quantity;
    state.quantity += quantityDelta;
    state.value += valueDelta;
    if (state.quantity === 0n) {
      const residual = state.value;
      valueDelta -= residual;
      state.value = 0n;
      state.average = resolution.unitCost;
      metadata = { ...metadata, closingRoundingResidual: format12(residual) };
    } else {
      state.average = divide12(state.value, state.quantity) ?? state.average;
    }

    const fact = movementFact(row, runId, eventOrder, {
      status: 'COSTED', unitCost: resolution.unitCost, valueDelta,
      sourceCostType: resolution.sourceCostType,
      reversalOfCostFactId,
      metadata,
    });
    if (controlledNegative && quantityDelta < 0n) {
      const exposedQuantity = negativeExposureQuantity(previousQuantity, quantityDelta);
      registerNegativeCostExposure({
        state,
        row,
        fact,
        exposedQuantity,
        provisionalUnitCost: resolution.unitCost,
        format12,
      });
    }
    facts.push(fact);
    factsByLineId.set(row.movement_line_id, fact);
    factsByMovementLine.set(`${row.movement_id}:${Number(row.line_number)}`, fact);
    const transferLineId = row.line_metadata?.inventoryTransferLineId;
    if (row.movement_type === 'TRANSFER_ISSUE' && transferLineId) {
      transferCosts.set(transferLineId, { unitCost: resolution.unitCost, costFactId: fact.id });
    }
    const adjustmentLineId = row.line_metadata?.inventoryAdjustmentLineId;
    if (row.direction === 'OUT' && row.line_metadata?.pairedMovement && adjustmentLineId) {
      pairedCosts.set(adjustmentLineId, { unitCost: resolution.unitCost, costFactId: fact.id });
    }
  }

  for (const state of pools.values()) {
    const pending = finalizePendingNegativeCostFacts({ state, anomalyFor, format12 });
    if (pending.length > 0) {
      state.anomalyCount += pending.length;
      anomalies.push(...pending);
    }
  }

  const balances = balanceRows(pools);
  const completedAt = new Date().toISOString();
  const run = await repository.insertRun(client, {
    id: runId,
    installationId: requestContext.installationId,
    methodVersion: METHOD_VERSION,
    currencyCode: CURRENCY_CODE,
    warehouseIds: selection.warehouseIds,
    ledgerLineCount: movementRows.length,
    factCount: facts.length,
    anomalyCount: anomalies.length,
    idempotencyKey,
    payloadHash: hash,
    startedAt: requestContext.receivedAt ?? completedAt,
    completedAt,
    createdBy: String(requestContext.actorId ?? 'system').slice(0, 128),
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp ?? 'NPP_CORE',
    metadata: {
      decisionDocument: 'docs/operations/phase-7-5-costing-owner-decisions.md',
      negativeStockDecisionDocument: 'docs/operations/issue-791-negative-stock-costing-contract.md',
      periodAware: true,
      bootstrapHistorical: !closed,
      seededFromPeriodId: closed?.id ?? null,
      adjustmentEventIds: adjustments.map((row) => row.id),
      earliestAffected: earliest
        ? {
          kind: earliest.kind,
          id: earliest.kind === 'movement' ? earliest.row.movement_line_id : earliest.row.id,
          effectiveDate: earliest.kind === 'movement'
            ? String(earliest.row.document_date).slice(0, 10)
            : String(earliest.row.posting_date),
        }
        : null,
      rebuildStrategy: 'FULL_MUTABLE_TAIL_FROM_CLOSED_SNAPSHOT',
    },
  });
  for (const fact of facts) {
    await repository.insertFact(client, { ...fact, installationId: requestContext.installationId });
  }
  for (const anomaly of anomalies) {
    await repository.insertAnomaly(client, {
      ...anomaly,
      installationId: requestContext.installationId,
      rebuildRunId: runId,
    });
    await discrepancy(client, {
      installationId: requestContext.installationId,
      code: 'COST_ANOMALY',
      warehouseId: anomaly.warehouseId,
      baseVariantId: anomaly.baseVariantId,
      movementId: anomaly.inventoryMovementId,
      movementLineId: anomaly.inventoryMovementLineId,
      stableKey: `cost-anomaly:${anomaly.inventoryMovementLineId}:${anomaly.code}`,
      message: anomaly.message,
      details: { anomalyCode: anomaly.code, ...anomaly.details },
    });
  }
  if (replaceProjection) {
    await repository.replaceBalances(client, {
      installationId: requestContext.installationId,
      warehouseIds: selection.warehouseIds,
      rebuildRunId: runId,
      balances,
    });
  }

  let reconciliationMismatchCount = 0;
  if (replaceProjection) {
    const reconciliation = await repository.listReconciliation(client, {
      installationId: requestContext.installationId,
      warehouseIds: selection.warehouseIds,
      status: null,
      limit: 10000,
      offset: 0,
    });
    for (const item of reconciliation) {
      if (item.reconciliation_status === 'OK') continue;
      reconciliationMismatchCount += 1;
      await discrepancy(client, {
        installationId: requestContext.installationId,
        code: item.reconciliation_status === 'QUANTITY_MISMATCH' ? 'QUANTITY_MISMATCH' : 'COST_ANOMALY',
        warehouseId: item.warehouse_id,
        baseVariantId: item.base_variant_id,
        stableKey: `reconcile:${item.warehouse_id}:${item.base_variant_id}:${item.reconciliation_status}`,
        message: 'Quantity ledger and costing projection require reconciliation',
        details: {
          ledgerQuantity: item.ledger_quantity,
          costingQuantity: item.costing_quantity,
          quantityDifference: item.quantity_difference,
          costingStatus: item.costing_status,
        },
      });
    }
  }

  return {
    ok: true,
    run: mapRun(run),
    balances,
    anomalyCount: anomalies.length,
    reconciliationMismatchCount,
    discrepancyCount: anomalies.length + reconciliationMismatchCount,
    replayed: false,
  };
}
