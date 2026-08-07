import { createHash, randomUUID } from 'node:crypto';
import * as repository from '../db/repositories/inventory-costing.js';

const METHOD_VERSION = 'MWA_V1';
const CURRENCY_CODE = 'VND';
const SCALE_12 = 1_000_000_000_000n;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COST_STATUSES = new Set(['COSTED', 'ANOMALY']);
const RECONCILIATION_STATUSES = new Set(['OK', 'QUANTITY_MISMATCH', 'COST_ANOMALY']);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (maxLength > 0 && normalized.length > maxLength)) return null;
  return normalized;
}

function actorId(requestContext) {
  return text(
    requestContext?.actorId ?? requestContext?.principalId ?? requestContext?.subject,
    128,
  ) ?? 'system';
}

function warehouseScopeIds(requestContext) {
  return [...new Set((Array.isArray(requestContext?.scopes?.warehouseIds)
    ? requestContext.scopes.warehouseIds
    : [])
    .filter((value) => typeof value === 'string' && UUID_PATTERN.test(value.trim()))
    .map((value) => value.trim()))].sort();
}

function parseScale12(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const absolute = BigInt(match[2]) * SCALE_12
    + BigInt((match[3] ?? '').padEnd(12, '0'));
  return match[1] ? -absolute : absolute;
}

function formatScale12(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / SCALE_12}.${String(absolute % SCALE_12).padStart(12, '0')}`;
}

function divideRounded(numerator, denominator) {
  if (denominator === 0n) return null;
  const negative = (numerator < 0n) !== (denominator < 0n);
  const left = numerator < 0n ? -numerator : numerator;
  const right = denominator < 0n ? -denominator : denominator;
  const scaled = left * SCALE_12;
  const quotient = (scaled + right / 2n) / right;
  return negative ? -quotient : quotient;
}

function multiplyRounded(left, right) {
  const negative = (left < 0n) !== (right < 0n);
  const absoluteLeft = left < 0n ? -left : left;
  const absoluteRight = right < 0n ? -right : right;
  const product = (absoluteLeft * absoluteRight + SCALE_12 / 2n) / SCALE_12;
  return negative ? -product : product;
}

function canonicalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function payloadHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function poolKey(row) {
  return `${row.warehouse_id}:${row.base_variant_id}`;
}

function poolState(row) {
  return {
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku,
    quantity: 0n,
    value: 0n,
    average: 0n,
    status: 'COSTED',
    anomalyCount: 0,
    projectedThroughEvent: 0,
  };
}

function explicitUnitCost(row) {
  const candidate = row.line_metadata?.unitCost
    ?? row.line_metadata?.unit_cost
    ?? row.movement_metadata?.unitCost
    ?? row.movement_metadata?.unit_cost;
  const parsed = parseScale12(candidate);
  return parsed !== null && parsed >= 0n ? parsed : null;
}

function zeroCostApproved(row) {
  return row.line_metadata?.allowZeroCost === true
    && Boolean(
      row.line_metadata?.zeroCostReasonCode
      ?? row.line_metadata?.zero_cost_reason_code,
    );
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

function purchaseUnitCost(row) {
  const ordered = parseScale12(row.purchase_order_quantity);
  const baseQuantity = parseScale12(row.purchase_order_base_quantity);
  const unitPrice = parseScale12(row.purchase_unit_price);
  const discount = parseScale12(row.purchase_discount_amount ?? '0');
  if (ordered === null || baseQuantity === null || unitPrice === null || discount === null
      || ordered <= 0n || baseQuantity <= 0n || unitPrice < 0n || discount < 0n) {
    return failure(
      'PURCHASE_COST_SOURCE_INVALID',
      'Purchase receipt cost source is missing or invalid',
    );
  }
  const gross = multiplyRounded(ordered, unitPrice);
  const net = gross - discount;
  if (net <= 0n) {
    return failure(
      'PURCHASE_ZERO_COST_DENIED',
      'Ordinary purchase receipt has zero or negative net inventory cost',
    );
  }
  const unitCost = divideRounded(net, baseQuantity);
  if (unitCost === null || unitCost <= 0n) {
    return failure(
      'PURCHASE_COST_SOURCE_INVALID',
      'Purchase receipt unit cost could not be resolved',
    );
  }
  return Object.freeze({
    ok: true,
    unitCost,
    sourceCostType: 'PURCHASE_ORDER_NET',
    metadata: {
      purchaseOrderLineId: row.purchase_order_line_id,
      goodsReceiptLineId: row.goods_receipt_line_id,
      purchaseOrderQuantity: String(row.purchase_order_quantity),
      purchaseOrderBaseQuantity: String(row.purchase_order_base_quantity),
      purchaseUnitPrice: String(row.purchase_unit_price),
      purchaseDiscountAmount: String(row.purchase_discount_amount ?? 0),
    },
  });
}

function currentAverage(state) {
  if (state.status !== 'COSTED' || state.quantity <= 0n || state.value < 0n) return null;
  if (state.quantity === 0n) return 0n;
  return divideRounded(state.value, state.quantity);
}

function resolveOriginalFact(row, factsByLineId, factsByMovementLine) {
  const directId = row.line_metadata?.reversedMovementLineId
    ?? row.line_metadata?.originalMovementLineId
    ?? row.line_metadata?.originalInventoryMovementLineId;
  if (directId && factsByLineId.has(directId)) return factsByLineId.get(directId);
  if (row.reversal_of_movement_id) {
    return factsByMovementLine.get(
      `${row.reversal_of_movement_id}:${Number(row.line_number)}`,
    ) ?? null;
  }
  return null;
}

function anomalyFor(row, code, message, details = {}) {
  return Object.freeze({
    id: randomUUID(),
    inventoryMovementId: row.movement_id,
    inventoryMovementLineId: row.movement_line_id,
    warehouseId: row.warehouse_id,
    baseVariantId: row.base_variant_id,
    code,
    message,
    details,
  });
}

function normalizedWarehouseSelection(requestContext, payload) {
  const scoped = warehouseScopeIds(requestContext);
  if (scoped.length === 0) {
    return failure(
      'WAREHOUSE_SCOPE_DENIED',
      'At least one authorized warehouse is required',
    );
  }
  const requested = payload?.warehouseIds;
  if (requested === undefined || requested === null) {
    return Object.freeze({ ok: true, warehouseIds: scoped });
  }
  if (!Array.isArray(requested) || requested.length === 0) {
    return failure('INVALID_WAREHOUSE_IDS', 'warehouseIds must be a non-empty array');
  }
  const normalized = [...new Set(requested.map((value) => String(value).trim()))].sort();
  if (normalized.some((value) => !UUID_PATTERN.test(value))) {
    return failure('INVALID_WAREHOUSE_IDS', 'warehouseIds contains an invalid UUID');
  }
  if (normalized.some((value) => !scoped.includes(value))) {
    return failure(
      'WAREHOUSE_SCOPE_DENIED',
      'One or more warehouses are outside the authorized scope',
    );
  }
  return Object.freeze({ ok: true, warehouseIds: normalized });
}

function buildFact({
  row,
  runId,
  eventOrder,
  status,
  unitCost,
  valueDelta,
  sourceCostType,
  reversalOfCostFactId = null,
  metadata = {},
}) {
  return Object.freeze({
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
    unitCost: unitCost === null ? null : formatScale12(unitCost),
    valueDelta: valueDelta === null ? null : formatScale12(valueDelta),
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
  });
}

function mapRun(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    methodVersion: row.method_version,
    currencyCode: row.currency_code,
    warehouseIds: Object.freeze(row.warehouse_ids ?? []),
    ledgerLineCount: Number(row.ledger_line_count),
    factCount: Number(row.fact_count),
    anomalyCount: Number(row.anomaly_count),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdBy: row.created_by,
    requestId: row.request_id,
  });
}

function mapBalance(row) {
  return Object.freeze({
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku ?? null,
    methodVersion: row.method_version,
    currencyCode: row.currency_code,
    quantity: String(row.quantity),
    inventoryValue: row.inventory_value === null ? null : String(row.inventory_value),
    averageUnitCost: row.average_unit_cost === null ? null : String(row.average_unit_cost),
    status: row.status,
    anomalyCount: Number(row.anomaly_count),
    projectedThroughEvent: String(row.projected_through_event),
    rebuildRunId: row.rebuild_run_id,
    updatedAt: row.updated_at,
  });
}

function mapFact(row) {
  return Object.freeze({
    id: row.id,
    rebuildRunId: row.rebuild_run_id,
    eventOrder: String(row.event_order),
    status: row.status,
    eventType: row.event_type,
    inventoryMovementId: row.inventory_movement_id,
    inventoryMovementLineId: row.inventory_movement_line_id,
    reversalOfCostFactId: row.reversal_of_cost_fact_id ?? null,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku ?? null,
    lotId: row.lot_id ?? null,
    direction: row.direction,
    quantityDelta: String(row.quantity_delta),
    unitCost: row.unit_cost === null ? null : String(row.unit_cost),
    valueDelta: row.value_delta === null ? null : String(row.value_delta),
    currencyCode: row.currency_code,
    sourceCostType: row.source_cost_type,
    sourceDocumentType: row.source_document_type ?? null,
    sourceDocumentId: row.source_document_id ?? null,
    sourceDocumentNumber: row.source_document_number ?? null,
    sourceLineReference: row.source_line_reference ?? null,
    effectiveDate: row.effective_date,
    movementPostedAt: row.movement_posted_at,
    movementLineNumber: Number(row.movement_line_number),
    metadata: row.metadata ?? {},
  });
}

function mapAnomaly(row) {
  return Object.freeze({
    id: row.id,
    rebuildRunId: row.rebuild_run_id,
    inventoryMovementId: row.inventory_movement_id,
    inventoryMovementLineId: row.inventory_movement_line_id,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku ?? null,
    code: row.code,
    message: row.message,
    details: row.details ?? {},
    createdAt: row.created_at,
  });
}

function mapReconciliation(row) {
  return Object.freeze({
    rebuildRunId: row.rebuild_run_id,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku ?? null,
    ledgerQuantity: String(row.ledger_quantity),
    costingQuantity: String(row.costing_quantity),
    quantityDifference: String(row.quantity_difference),
    inventoryValue: row.inventory_value === null ? null : String(row.inventory_value),
    averageUnitCost: row.average_unit_cost === null ? null : String(row.average_unit_cost),
    costingStatus: row.costing_status,
    anomalyCount: Number(row.anomaly_count),
    reconciliationStatus: row.reconciliation_status,
  });
}

export async function rebuildCosting(client, {
  requestContext,
  idempotencyKey,
  payload = {},
}) {
  if (!IDEMPOTENCY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency key must contain 1-128 safe characters',
    );
  }
  const selection = normalizedWarehouseSelection(requestContext, payload);
  if (!selection.ok) return selection;
  const normalizedPayload = Object.freeze({
    methodVersion: METHOD_VERSION,
    currencyCode: CURRENCY_CODE,
    warehouseIds: selection.warehouseIds,
  });
  const hash = payloadHash(normalizedPayload);
  await repository.lockRebuild(client, {
    installationId: requestContext.installationId,
    warehouseIds: selection.warehouseIds,
  });
  const replay = await repository.getRunByIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
  });
  if (replay) {
    if (replay.payload_hash !== hash) {
      return failure(
        'IDEMPOTENCY_PAYLOAD_MISMATCH',
        'Idempotency key was already used with another costing scope',
      );
    }
    return Object.freeze({ ok: true, run: mapRun(replay), replayed: true });
  }

  const startedAt = requestContext.receivedAt ?? new Date().toISOString();
  const rows = await repository.listLedgerLines(client, {
    installationId: requestContext.installationId,
    warehouseIds: selection.warehouseIds,
  });
  const runId = randomUUID();
  const pools = new Map();
  const transferCosts = new Map();
  const pairedCosts = new Map();
  const factsByLineId = new Map();
  const factsByMovementLine = new Map();
  const facts = [];
  const anomalies = [];

  let eventOrder = 0;
  for (const row of rows) {
    eventOrder += 1;
    const key = poolKey(row);
    const state = pools.get(key) ?? poolState(row);
    pools.set(key, state);
    state.projectedThroughEvent = eventOrder;

    const quantityDelta = parseScale12(row.base_quantity_delta);
    if (quantityDelta === null || quantityDelta === 0n) {
      const anomaly = anomalyFor(
        row,
        'COST_QUANTITY_INVALID',
        'Inventory movement line has an invalid base quantity',
        { baseQuantityDelta: row.base_quantity_delta },
      );
      anomalies.push(anomaly);
      state.status = 'ANOMALY';
      state.anomalyCount += 1;
      const fact = buildFact({
        row,
        runId,
        eventOrder,
        status: 'ANOMALY',
        unitCost: null,
        valueDelta: null,
        sourceCostType: 'UNRESOLVED',
        metadata: { anomalyCode: anomaly.code },
      });
      facts.push(fact);
      factsByLineId.set(row.movement_line_id, fact);
      factsByMovementLine.set(`${row.movement_id}:${Number(row.line_number)}`, fact);
      continue;
    }

    let resolution = null;
    let reversalOfCostFactId = null;
    const originalFact = resolveOriginalFact(row, factsByLineId, factsByMovementLine);
    if (row.reversal_of_movement_id || row.movement_type.includes('REVERSAL')) {
      if (originalFact?.status === 'COSTED' && originalFact.unitCost !== null) {
        resolution = {
          ok: true,
          unitCost: parseScale12(originalFact.unitCost),
          sourceCostType: 'HISTORICAL_REVERSAL',
          metadata: { originalCostFactId: originalFact.id },
        };
        reversalOfCostFactId = originalFact.id;
      } else {
        resolution = failure(
          'REVERSAL_COST_SOURCE_MISSING',
          'Reversal cannot resolve the original historical cost fact',
        );
      }
    } else if (row.movement_type === 'PURCHASE_RECEIPT') {
      const currency = String(row.purchase_currency_code ?? '').trim().toUpperCase();
      if (currency !== CURRENCY_CODE) {
        resolution = failure(
          'COST_CURRENCY_UNSUPPORTED',
          'Purchase receipt currency is not the installation base costing currency',
          false,
          { currencyCode: currency || null },
        );
      } else {
        resolution = purchaseUnitCost(row);
      }
    } else if (row.movement_type === 'TRANSFER_RECEIPT') {
      const transferLineId = row.line_metadata?.inventoryTransferLineId;
      const carrying = transferLineId ? transferCosts.get(transferLineId) : null;
      resolution = carrying
        ? {
          ok: true,
          unitCost: carrying.unitCost,
          sourceCostType: 'TRANSFER_CARRYING_COST',
          metadata: {
            inventoryTransferLineId: transferLineId,
            sourceCostFactId: carrying.costFactId,
          },
        }
        : failure(
          'TRANSFER_CARRYING_COST_MISSING',
          'Transfer receipt cannot resolve carrying cost from the source issue',
          false,
          { inventoryTransferLineId: transferLineId ?? null },
        );
    } else if (row.direction === 'IN' && row.line_metadata?.pairedMovement) {
      const adjustmentLineId = row.line_metadata?.inventoryAdjustmentLineId;
      const paired = adjustmentLineId ? pairedCosts.get(adjustmentLineId) : null;
      resolution = paired
        ? {
          ok: true,
          unitCost: paired.unitCost,
          sourceCostType: 'INTERNAL_CARRYING_COST',
          metadata: {
            inventoryAdjustmentLineId: adjustmentLineId,
            sourceCostFactId: paired.costFactId,
          },
        }
        : failure(
          'INTERNAL_CARRYING_COST_MISSING',
          'Internal destination line cannot resolve source carrying cost',
          false,
          { inventoryAdjustmentLineId: adjustmentLineId ?? null },
        );
    } else if (row.direction === 'IN' && row.movement_type === 'OPENING_BALANCE') {
      const currency = explicitCurrency(row);
      const unitCost = explicitUnitCost(row);
      resolution = currency !== CURRENCY_CODE
        ? failure(
          'COST_CURRENCY_UNSUPPORTED',
          'Opening balance currency is not VND',
          false,
          { currencyCode: currency },
        )
        : unitCost === null
          ? failure(
            'OPENING_COST_MISSING',
            'Opening balance line requires explicit approved unit cost',
          )
          : {
            ok: true,
            unitCost,
            sourceCostType: 'OPENING_EXPLICIT_COST',
            metadata: {},
          };
    } else if (row.direction === 'IN') {
      const historical = resolveOriginalFact(row, factsByLineId, factsByMovementLine);
      const explicit = explicitUnitCost(row);
      const average = currentAverage(state);
      const exactHistoricalRequired = row.movement_type === 'SALES_CUSTOMER_RETURN';
      if (historical?.status === 'COSTED' && historical.unitCost !== null) {
        resolution = {
          ok: true,
          unitCost: parseScale12(historical.unitCost),
          sourceCostType: 'ORIGINAL_ISSUE_COST',
          metadata: { originalCostFactId: historical.id },
        };
      } else if (exactHistoricalRequired) {
        resolution = failure(
          'CUSTOMER_RETURN_ORIGINAL_COST_MISSING',
          'Customer return requires exact historical issue cost lineage',
        );
      } else if (explicit !== null && explicitCurrency(row) === CURRENCY_CODE) {
        resolution = explicit === 0n && !zeroCostApproved(row)
          ? failure(
            'ZERO_COST_NOT_APPROVED',
            'Zero-cost inbound requires an explicit approved reason',
          )
          : {
            ok: true,
            unitCost: explicit,
            sourceCostType: explicit === 0n
              ? 'APPROVED_ZERO_COST'
              : 'APPROVED_EXPLICIT_COST',
            metadata: explicit === 0n
              ? {
                zeroCostReasonCode: row.line_metadata?.zeroCostReasonCode
                  ?? row.line_metadata?.zero_cost_reason_code,
              }
              : {},
          };
      } else if (average !== null) {
        resolution = {
          ok: true,
          unitCost: average,
          sourceCostType: 'CURRENT_POOL_AVERAGE',
          metadata: {},
        };
      } else {
        resolution = failure(
          'INBOUND_COST_SOURCE_MISSING',
          'Inbound movement cannot resolve an approved cost source',
        );
      }
    } else {
      const average = currentAverage(state);
      resolution = average === null
        ? failure(
          'OUTBOUND_AVERAGE_MISSING',
          'Outbound movement cannot resolve current moving-average cost',
        )
        : {
          ok: true,
          unitCost: average,
          sourceCostType: 'CURRENT_POOL_AVERAGE',
          metadata: {},
        };
    }

    if (!resolution?.ok || resolution.unitCost === null) {
      const anomaly = anomalyFor(
        row,
        resolution?.code ?? 'COST_SOURCE_UNRESOLVED',
        resolution?.message ?? 'Cost source could not be resolved',
        resolution?.details ?? {},
      );
      anomalies.push(anomaly);
      state.quantity += quantityDelta;
      state.value = 0n;
      state.average = 0n;
      state.status = 'ANOMALY';
      state.anomalyCount += 1;
      const fact = buildFact({
        row,
        runId,
        eventOrder,
        status: 'ANOMALY',
        unitCost: null,
        valueDelta: null,
        sourceCostType: 'UNRESOLVED',
        reversalOfCostFactId,
        metadata: { anomalyCode: anomaly.code },
      });
      facts.push(fact);
      factsByLineId.set(row.movement_line_id, fact);
      factsByMovementLine.set(`${row.movement_id}:${Number(row.line_number)}`, fact);
      continue;
    }

    if (state.status === 'ANOMALY') {
      const anomaly = anomalyFor(
        row,
        'POOL_COST_BLOCKED',
        'Cost pool has an earlier unresolved event and cannot continue valuation',
      );
      anomalies.push(anomaly);
      state.quantity += quantityDelta;
      state.anomalyCount += 1;
      const fact = buildFact({
        row,
        runId,
        eventOrder,
        status: 'ANOMALY',
        unitCost: null,
        valueDelta: null,
        sourceCostType: 'BLOCKED_BY_PRIOR_ANOMALY',
        reversalOfCostFactId,
        metadata: { anomalyCode: anomaly.code },
      });
      facts.push(fact);
      factsByLineId.set(row.movement_line_id, fact);
      factsByMovementLine.set(`${row.movement_id}:${Number(row.line_number)}`, fact);
      continue;
    }

    const absoluteQuantity = quantityDelta < 0n ? -quantityDelta : quantityDelta;
    let valueDelta = multiplyRounded(absoluteQuantity, resolution.unitCost);
    if (quantityDelta < 0n) valueDelta = -valueDelta;
    if (quantityDelta < 0n && state.quantity + quantityDelta < 0n) {
      const anomaly = anomalyFor(
        row,
        'COST_NEGATIVE_STOCK',
        'Cost projection would become negative',
        {
          poolQuantity: formatScale12(state.quantity),
          quantityDelta: formatScale12(quantityDelta),
        },
      );
      anomalies.push(anomaly);
      state.quantity += quantityDelta;
      state.value = 0n;
      state.average = 0n;
      state.status = 'ANOMALY';
      state.anomalyCount += 1;
      const fact = buildFact({
        row,
        runId,
        eventOrder,
        status: 'ANOMALY',
        unitCost: null,
        valueDelta: null,
        sourceCostType: 'UNRESOLVED',
        reversalOfCostFactId,
        metadata: { anomalyCode: anomaly.code },
      });
      facts.push(fact);
      factsByLineId.set(row.movement_line_id, fact);
      factsByMovementLine.set(`${row.movement_id}:${Number(row.line_number)}`, fact);
      continue;
    }

    let resolutionMetadata = { ...(resolution.metadata ?? {}) };
    state.quantity += quantityDelta;
    state.value += valueDelta;
    if (state.quantity === 0n) {
      const residual = state.value;
      valueDelta -= residual;
      state.value = 0n;
      state.average = 0n;
      resolutionMetadata = {
        ...resolutionMetadata,
        closingRoundingResidual: formatScale12(residual),
      };
    } else {
      state.average = divideRounded(state.value, state.quantity) ?? 0n;
    }

    const fact = buildFact({
      row,
      runId,
      eventOrder,
      status: 'COSTED',
      unitCost: resolution.unitCost,
      valueDelta,
      sourceCostType: resolution.sourceCostType,
      reversalOfCostFactId,
      metadata: resolutionMetadata,
    });
    facts.push(fact);
    factsByLineId.set(row.movement_line_id, fact);
    factsByMovementLine.set(`${row.movement_id}:${Number(row.line_number)}`, fact);

    const transferLineId = row.line_metadata?.inventoryTransferLineId;
    if (row.movement_type === 'TRANSFER_ISSUE' && transferLineId) {
      transferCosts.set(transferLineId, {
        unitCost: resolution.unitCost,
        costFactId: fact.id,
      });
    }
    const adjustmentLineId = row.line_metadata?.inventoryAdjustmentLineId;
    if (row.direction === 'OUT' && row.line_metadata?.pairedMovement && adjustmentLineId) {
      pairedCosts.set(adjustmentLineId, {
        unitCost: resolution.unitCost,
        costFactId: fact.id,
      });
    }
  }

  const balances = [...pools.values()].map((state) => ({
    warehouseId: state.warehouseId,
    baseVariantId: state.baseVariantId,
    methodVersion: METHOD_VERSION,
    currencyCode: CURRENCY_CODE,
    quantity: formatScale12(state.quantity),
    inventoryValue: state.status === 'COSTED' ? formatScale12(state.value) : null,
    averageUnitCost: state.status === 'COSTED' ? formatScale12(state.average) : null,
    status: state.status,
    anomalyCount: state.anomalyCount,
    projectedThroughEvent: state.projectedThroughEvent,
  }));
  const completedAt = new Date().toISOString();
  const run = await repository.insertRun(client, {
    id: runId,
    installationId: requestContext.installationId,
    methodVersion: METHOD_VERSION,
    currencyCode: CURRENCY_CODE,
    warehouseIds: selection.warehouseIds,
    ledgerLineCount: rows.length,
    factCount: facts.length,
    anomalyCount: anomalies.length,
    idempotencyKey,
    payloadHash: hash,
    startedAt,
    completedAt,
    createdBy: actorId(requestContext),
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp ?? 'NPP_CORE',
    metadata: {
      decisionDocument: 'docs/operations/phase-7-5-costing-owner-decisions.md',
      poolIdentity: 'installation+warehouse+base_variant',
    },
  });
  for (const fact of facts) {
    await repository.insertFact(client, {
      ...fact,
      installationId: requestContext.installationId,
    });
  }
  for (const anomaly of anomalies) {
    await repository.insertAnomaly(client, {
      ...anomaly,
      installationId: requestContext.installationId,
      rebuildRunId: runId,
    });
  }
  await repository.replaceBalances(client, {
    installationId: requestContext.installationId,
    warehouseIds: selection.warehouseIds,
    rebuildRunId: runId,
    balances,
  });
  return Object.freeze({
    ok: true,
    run: mapRun(run),
    balances: Object.freeze(balances.map((item) => Object.freeze(item))),
    anomalyCount: anomalies.length,
    replayed: false,
  });
}

export async function listBalances(client, {
  requestContext,
  status = null,
  limit = 200,
  offset = 0,
}) {
  const warehouseIds = warehouseScopeIds(requestContext);
  if (warehouseIds.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  if (status && !COST_STATUSES.has(status)) return failure('INVALID_COST_STATUS', 'Cost status is invalid');
  const rows = await repository.listBalances(client, {
    installationId: requestContext.installationId,
    warehouseIds,
    status,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, balances: Object.freeze(rows.map(mapBalance)) });
}

export async function listFacts(client, {
  requestContext,
  runId = null,
  movementId = null,
  status = null,
  limit = 200,
  offset = 0,
}) {
  const warehouseIds = warehouseScopeIds(requestContext);
  if (warehouseIds.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  if (runId && !UUID_PATTERN.test(runId)) return failure('INVALID_RUN_ID', 'runId is invalid');
  if (movementId && !UUID_PATTERN.test(movementId)) return failure('INVALID_MOVEMENT_ID', 'movementId is invalid');
  if (status && !COST_STATUSES.has(status)) return failure('INVALID_COST_STATUS', 'Cost status is invalid');
  const rows = await repository.listFacts(client, {
    installationId: requestContext.installationId,
    warehouseIds,
    runId,
    movementId,
    status,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, facts: Object.freeze(rows.map(mapFact)) });
}

export async function listAnomalies(client, {
  requestContext,
  runId = null,
  code = null,
  limit = 200,
  offset = 0,
}) {
  const warehouseIds = warehouseScopeIds(requestContext);
  if (warehouseIds.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  if (runId && !UUID_PATTERN.test(runId)) return failure('INVALID_RUN_ID', 'runId is invalid');
  const normalizedCode = code ? String(code).trim().toUpperCase() : null;
  if (normalizedCode && !/^[A-Z0-9_.-]{1,96}$/.test(normalizedCode)) {
    return failure('INVALID_ANOMALY_CODE', 'Anomaly code is invalid');
  }
  const rows = await repository.listAnomalies(client, {
    installationId: requestContext.installationId,
    warehouseIds,
    runId,
    code: normalizedCode,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, anomalies: Object.freeze(rows.map(mapAnomaly)) });
}

export async function listReconciliation(client, {
  requestContext,
  status = null,
  limit = 500,
  offset = 0,
}) {
  const warehouseIds = warehouseScopeIds(requestContext);
  if (warehouseIds.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  if (status && !RECONCILIATION_STATUSES.has(status)) {
    return failure('INVALID_RECONCILIATION_STATUS', 'Reconciliation status is invalid');
  }
  const rows = await repository.listReconciliation(client, {
    installationId: requestContext.installationId,
    warehouseIds,
    status,
    limit,
    offset,
  });
  return Object.freeze({
    ok: true,
    reconciliation: Object.freeze(rows.map(mapReconciliation)),
  });
}

export async function getLatestRun(client, { requestContext }) {
  const scoped = warehouseScopeIds(requestContext);
  if (scoped.length === 0) {
    return failure(
      'WAREHOUSE_SCOPE_DENIED',
      'At least one authorized warehouse is required',
    );
  }
  const run = await repository.latestRun(client, {
    installationId: requestContext.installationId,
    warehouseIds: scoped,
  });
  const mapped = mapRun(run);
  return Object.freeze({
    ok: true,
    run: mapped
      ? Object.freeze({
        ...mapped,
        warehouseIds: Object.freeze(
          mapped.warehouseIds.filter((warehouseId) => scoped.includes(warehouseId)),
        ),
      })
      : null,
  });
}

export const inventoryCostingInternals = Object.freeze({
  parseScale12,
  formatScale12,
  divideRounded,
  multiplyRounded,
  payloadHash,
  purchaseUnitCost,
  normalizedWarehouseSelection,
});
