import { randomUUID } from 'node:crypto';
import { inventoryCostingInternals } from './inventory-costing.js';
import { currentPoolUnitCost } from './inventory-negative-costing.js';
import {
  CURRENCY_CODE,
  METHOD_VERSION,
  failure,
  format12,
  parse12,
  divide12,
} from './inventory-costing-period-utils.js';
import {
  canonicalFactByMovementLine,
  canonicalFactByMovementPosition,
  canonicalTransferFact,
} from './inventory-costing-period-support.js';

export function baseState(row) {
  return {
    warehouseId: row.warehouse_id,
    baseVariantId: row.base_variant_id,
    quantity: 0n,
    value: 0n,
    average: 0n,
    status: 'COSTED',
    anomalyCount: 0,
    projectedThroughEvent: 0,
    negativeCostLayers: [],
  };
}

function explicitUnitCost(row) {
  const candidate = row.line_metadata?.unitCost
    ?? row.line_metadata?.unit_cost
    ?? row.movement_metadata?.unitCost
    ?? row.movement_metadata?.unit_cost;
  const parsed = parse12(candidate);
  return parsed !== null && parsed >= 0n ? parsed : null;
}

function explicitCurrency(row) {
  return String(
    row.line_metadata?.currencyCode
      ?? row.line_metadata?.currency_code
      ?? row.movement_metadata?.currencyCode
      ?? row.movement_metadata?.currency_code
      ?? CURRENCY_CODE,
  ).trim().toUpperCase();
}

function zeroCostApproved(row) {
  return row.line_metadata?.allowZeroCost === true
    && Boolean(row.line_metadata?.zeroCostReasonCode ?? row.line_metadata?.zero_cost_reason_code);
}

export function movementFact(row, runId, eventOrder, {
  status,
  unitCost,
  valueDelta,
  sourceCostType,
  reversalOfCostFactId = null,
  metadata = {},
}) {
  return {
    id: randomUUID(),
    rebuildRunId: runId,
    methodVersion: METHOD_VERSION,
    eventOrder,
    status,
    eventType: `${row.movement_type}_${row.direction}`,
    inventoryMovementId: row.movement_id,
    inventoryMovementLineId: row.movement_line_id,
    reversalOfCostFactId,
    warehouseId: row.warehouse_id,
    locationId: row.location_id,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id,
    direction: row.direction,
    quantityDelta: String(row.base_quantity_delta),
    unitCost: unitCost === null ? null : format12(unitCost),
    valueDelta: valueDelta === null ? null : format12(valueDelta),
    currencyCode: CURRENCY_CODE,
    sourceCostType,
    sourceDocumentType: row.source_document_type,
    sourceDocumentId: row.source_document_id,
    sourceDocumentNumber: row.source_document_number,
    sourceLineReference: row.source_line_reference,
    effectiveDate: String(row.document_date).slice(0, 10),
    movementPostedAt: row.posted_at,
    movementLineNumber: Number(row.line_number),
    metadata: {
      movementType: row.movement_type,
      sourceDomain: row.source_domain,
      reasonCode: row.reason_code,
      ...metadata,
    },
  };
}

export function anomalyFor(row, code, message, details = {}) {
  return {
    id: randomUUID(),
    inventoryMovementId: row.movement_id,
    inventoryMovementLineId: row.movement_line_id,
    warehouseId: row.warehouse_id,
    baseVariantId: row.base_variant_id,
    code,
    message,
    details,
  };
}

async function resolveHistoricalFact(client, installationId, row, factsByLineId, factsByMovementLine) {
  const directId = row.line_metadata?.reversedMovementLineId
    ?? row.line_metadata?.originalMovementLineId
    ?? row.line_metadata?.originalInventoryMovementLineId;
  if (directId) {
    if (factsByLineId.has(directId)) return factsByLineId.get(directId);
    const canonical = await canonicalFactByMovementLine(client, installationId, directId);
    if (canonical) return canonical;
  }
  if (row.reversal_of_movement_id) {
    const key = `${row.reversal_of_movement_id}:${Number(row.line_number)}`;
    if (factsByMovementLine.has(key)) return factsByMovementLine.get(key);
    return canonicalFactByMovementPosition(
      client,
      installationId,
      row.reversal_of_movement_id,
      Number(row.line_number),
    );
  }
  return null;
}

export async function movementResolution({
  client,
  installationId,
  row,
  state,
  transferCosts,
  pairedCosts,
  factsByLineId,
  factsByMovementLine,
}) {
  const historical = await resolveHistoricalFact(
    client,
    installationId,
    row,
    factsByLineId,
    factsByMovementLine,
  );
  const historicalUnitCost = historical?.unit_cost ?? historical?.unitCost ?? null;
  if (row.reversal_of_movement_id || row.movement_type.includes('REVERSAL')) {
    return historical?.status === 'COSTED' && historicalUnitCost !== null
      ? {
        ok: true,
        unitCost: parse12(historicalUnitCost),
        sourceCostType: 'HISTORICAL_REVERSAL',
        reversalOfCostFactId: historical.id,
        metadata: { originalCostFactId: historical.id },
      }
      : failure(
        'REVERSAL_COST_SOURCE_MISSING',
        'Reversal cannot resolve the exact historical cost fact',
      );
  }
  if (row.movement_type === 'PURCHASE_RECEIPT') {
    const currency = String(row.purchase_currency_code ?? '').trim().toUpperCase();
    if (currency !== CURRENCY_CODE) {
      return failure(
        'COST_CURRENCY_UNSUPPORTED',
        'Purchase receipt currency is not the installation base costing currency',
        { currencyCode: currency || null },
      );
    }
    return inventoryCostingInternals.purchaseUnitCost(row);
  }
  if (row.movement_type === 'TRANSFER_RECEIPT') {
    const transferLineId = row.line_metadata?.inventoryTransferLineId;
    let carrying = transferLineId ? transferCosts.get(transferLineId) : null;
    if (!carrying && transferLineId) {
      const canonical = await canonicalTransferFact(client, installationId, transferLineId);
      if (canonical) carrying = { unitCost: parse12(canonical.unit_cost), costFactId: canonical.id };
    }
    return carrying?.unitCost !== null && carrying?.unitCost !== undefined
      ? {
        ok: true,
        unitCost: carrying.unitCost,
        sourceCostType: 'TRANSFER_CARRYING_COST',
        metadata: { inventoryTransferLineId: transferLineId, sourceCostFactId: carrying.costFactId },
      }
      : failure(
        'TRANSFER_CARRYING_COST_MISSING',
        'Transfer receipt cannot resolve exact carrying cost from the source issue',
        { inventoryTransferLineId: transferLineId ?? null },
      );
  }
  if (row.direction === 'IN' && row.line_metadata?.pairedMovement) {
    const adjustmentLineId = row.line_metadata?.inventoryAdjustmentLineId;
    const paired = adjustmentLineId ? pairedCosts.get(adjustmentLineId) : null;
    return paired
      ? {
        ok: true,
        unitCost: paired.unitCost,
        sourceCostType: 'INTERNAL_CARRYING_COST',
        metadata: { inventoryAdjustmentLineId: adjustmentLineId, sourceCostFactId: paired.costFactId },
      }
      : failure(
        'INTERNAL_CARRYING_COST_MISSING',
        'Internal destination line cannot resolve source carrying cost',
        { inventoryAdjustmentLineId: adjustmentLineId ?? null },
      );
  }
  if (row.direction === 'IN' && row.movement_type === 'OPENING_BALANCE') {
    const currency = explicitCurrency(row);
    const unitCost = explicitUnitCost(row);
    if (currency !== CURRENCY_CODE) {
      return failure('COST_CURRENCY_UNSUPPORTED', 'Opening balance currency is not VND', { currencyCode: currency });
    }
    return unitCost === null
      ? failure('OPENING_COST_MISSING', 'Opening balance line requires explicit approved unit cost')
      : { ok: true, unitCost, sourceCostType: 'OPENING_EXPLICIT_COST', metadata: {} };
  }
  if (row.direction === 'IN') {
    if (historical?.status === 'COSTED' && historicalUnitCost !== null) {
      return {
        ok: true,
        unitCost: parse12(historicalUnitCost),
        sourceCostType: 'ORIGINAL_ISSUE_COST',
        metadata: { originalCostFactId: historical.id },
      };
    }
    if (row.movement_type === 'SALES_CUSTOMER_RETURN') {
      return failure(
        'CUSTOMER_RETURN_ORIGINAL_COST_MISSING',
        'Customer return requires exact historical issue cost lineage',
      );
    }
    const explicit = explicitUnitCost(row);
    if (explicit !== null && explicitCurrency(row) === CURRENCY_CODE) {
      if (explicit === 0n && !zeroCostApproved(row)) {
        return failure('ZERO_COST_NOT_APPROVED', 'Zero-cost inbound requires an explicit approved reason');
      }
      return {
        ok: true,
        unitCost: explicit,
        sourceCostType: explicit === 0n ? 'APPROVED_ZERO_COST' : 'APPROVED_EXPLICIT_COST',
        metadata: explicit === 0n
          ? { zeroCostReasonCode: row.line_metadata?.zeroCostReasonCode ?? row.line_metadata?.zero_cost_reason_code }
          : {},
      };
    }
    const average = currentPoolUnitCost(state, divide12);
    return average === null
      ? failure('INBOUND_COST_SOURCE_MISSING', 'Inbound movement cannot resolve an approved cost source')
      : { ok: true, unitCost: average, sourceCostType: 'CURRENT_POOL_AVERAGE', metadata: {} };
  }
  const average = currentPoolUnitCost(state, divide12);
  return average === null
    ? failure('OUTBOUND_AVERAGE_MISSING', 'Outbound movement cannot resolve current moving-average cost')
    : { ok: true, unitCost: average, sourceCostType: 'CURRENT_POOL_AVERAGE', metadata: {} };
}
