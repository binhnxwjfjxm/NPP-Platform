import { randomUUID } from 'node:crypto';
import {
  IDEMPOTENCY_PATTERN,
  UUID_PATTERN,
  actorId,
  allocateLargestRemainder,
  divide12,
  failure,
  format12,
  hashPayload,
  multiply12,
  parse12,
  warehouseIds,
} from './inventory-costing-period-utils.js';

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function mapAdjustment(row) {
  return {
    id: row.id,
    eventType: row.event_type,
    effectiveDate: String(row.effective_date).slice(0, 10),
    postingDate: String(row.posting_date).slice(0, 10),
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku ?? null,
    quantityDelta: String(row.quantity_delta),
    valueDelta: String(row.value_delta),
    currencyCode: row.currency_code,
    allocationGroupId: row.allocation_group_id ?? null,
    allocationBasis: row.allocation_basis ?? null,
    sourceDocumentType: row.source_document_type,
    sourceDocumentId: row.source_document_id,
    sourceLineReference: row.source_line_reference ?? null,
    originalCostFactId: row.original_cost_fact_id ?? null,
    originalMovementLineId: row.original_movement_line_id ?? null,
    createdAt: row.created_at,
    metadata: row.metadata ?? {},
  };
}

async function resolveReceiptTargets(client, requestContext, targets) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return failure('INVALID_ALLOCATION_TARGETS', 'targets must contain receiptLineId values');
  }
  const scoped = warehouseIds(requestContext);
  const resolved = [];
  for (const target of targets) {
    const receiptLineId = String(target?.receiptLineId ?? '').trim();
    if (!UUID_PATTERN.test(receiptLineId)) {
      return failure('INVALID_ALLOCATION_TARGET', 'Each target requires a valid receiptLineId');
    }
    const result = await client.query(
      `SELECT receipt_line.id AS receipt_line_id,
              movement_line.warehouse_id,
              movement_line.base_variant_id,
              abs(movement_line.base_quantity_delta)::text AS base_quantity,
              order_line.ordered_quantity::text AS ordered_quantity,
              order_line.base_quantity::text AS purchase_order_base_quantity,
              order_line.unit_price::text AS unit_price,
              order_line.discount_amount::text AS discount_amount
         FROM purchasing.goods_receipt_lines receipt_line
         JOIN inventory.inventory_movement_lines movement_line
           ON movement_line.installation_id=receipt_line.installation_id
          AND movement_line.metadata->>'goodsReceiptLineId'=receipt_line.id::text
         JOIN inventory.inventory_movements movement
           ON movement.installation_id=movement_line.installation_id
          AND movement.id=movement_line.movement_id
          AND movement.movement_type='PURCHASE_RECEIPT'
         JOIN purchasing.purchase_order_lines order_line
           ON order_line.installation_id=receipt_line.installation_id
          AND order_line.id=receipt_line.purchase_order_line_id
        WHERE receipt_line.installation_id=$1
          AND receipt_line.id=$2
          AND movement_line.warehouse_id=ANY($3::uuid[])
        ORDER BY movement.posted_at,movement.id,movement_line.line_number
        LIMIT 1`,
      [requestContext.installationId, receiptLineId, scoped],
    );
    const row = result.rows?.[0];
    if (!row) {
      return failure(
        'COST_ADJUSTMENT_RECEIPT_NOT_FOUND',
        'Receipt line is missing, unposted or outside authorized warehouse scope',
        { receiptLineId },
      );
    }
    const ordered = parse12(row.ordered_quantity);
    const orderBase = parse12(row.purchase_order_base_quantity);
    const unitPrice = parse12(row.unit_price);
    const discount = parse12(row.discount_amount ?? '0');
    const receiptBase = parse12(row.base_quantity);
    if (ordered === null || orderBase === null || unitPrice === null || discount === null
        || receiptBase === null || ordered <= 0n || orderBase <= 0n || receiptBase <= 0n) {
      return failure('COST_ADJUSTMENT_RECEIPT_INVALID', 'Receipt line cost basis is invalid', { receiptLineId });
    }
    const netOrderValue = multiply12(ordered, unitPrice) - discount;
    const unitCost = divide12(netOrderValue, orderBase);
    if (unitCost === null || unitCost < 0n) {
      return failure('COST_ADJUSTMENT_RECEIPT_INVALID', 'Receipt line purchase value cannot be resolved', { receiptLineId });
    }
    resolved.push({
      receiptLineId,
      warehouseId: row.warehouse_id,
      baseVariantId: row.base_variant_id,
      baseQuantity: format12(receiptBase),
      purchaseValue: format12(multiply12(receiptBase, unitCost)),
    });
  }
  return { ok: true, targets: resolved };
}

export async function createAdjustmentEvents(
  client,
  { requestContext, idempotencyKey, payload },
) {
  if (!IDEMPOTENCY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Invalid idempotency key');
  }
  const eventType = String(payload?.eventType ?? '').trim().toUpperCase();
  if (!['LANDED_COST', 'PURCHASE_PRICE_VARIANCE', 'FORWARD_CORRECTION'].includes(eventType)) {
    return failure('INVALID_COST_ADJUSTMENT_TYPE', 'Unsupported cost adjustment event type');
  }
  const scoped = warehouseIds(requestContext);
  if (!scoped.length) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  }
  const postingDate = String(payload?.postingDate ?? '').trim();
  const effectiveDate = String(payload?.effectiveDate ?? postingDate).trim();
  if (!isIsoDate(postingDate) || !isIsoDate(effectiveDate)) {
    return failure('INVALID_POSTING_DATE', 'effectiveDate and postingDate must be YYYY-MM-DD');
  }
  const sourceDocumentType = String(payload?.sourceDocumentType ?? '').trim();
  const sourceDocumentId = String(payload?.sourceDocumentId ?? '').trim();
  if (!sourceDocumentType || sourceDocumentType.length > 96
      || !sourceDocumentId || sourceDocumentId.length > 256) {
    return failure(
      'COST_ADJUSTMENT_SOURCE_REQUIRED',
      'sourceDocumentType and sourceDocumentId are required',
    );
  }
  const period = await client.query(
    `SELECT status FROM inventory.inventory_costing_periods
      WHERE installation_id=$1 AND $2::date BETWEEN period_start AND period_end LIMIT 1`,
    [requestContext.installationId, postingDate],
  );
  if (!period.rows?.[0]) {
    return failure('COSTING_PERIOD_REQUIRED', 'postingDate must belong to an OPEN costing period');
  }
  if (period.rows[0].status === 'CLOSED') {
    return failure('COSTING_PERIOD_CLOSED', 'Cost adjustment postingDate belongs to a CLOSED period');
  }

  let allocations;
  if (eventType === 'FORWARD_CORRECTION') {
    const target = payload?.targets?.[0];
    if (!target || payload.targets.length !== 1) {
      return failure(
        'INVALID_FORWARD_CORRECTION',
        'Forward correction requires exactly one target',
      );
    }
    allocations = [{
      ...target,
      valueDelta: String(payload.totalValue ?? target.valueDelta ?? ''),
    }];
  } else {
    const resolvedTargets = await resolveReceiptTargets(client, requestContext, payload?.targets);
    if (!resolvedTargets.ok) return resolvedTargets;
    const result = allocateLargestRemainder(
      payload?.totalValue,
      payload?.allocationBasis,
      resolvedTargets.targets,
    );
    if (!result.ok) return result;
    allocations = result.allocations;
  }

  const hash = hashPayload({ eventType, effectiveDate, postingDate, payload });
  const prefix = `costadj:${hashPayload(String(idempotencyKey)).slice(0, 48)}:`;
  const existing = await client.query(
    `SELECT * FROM inventory.inventory_cost_adjustment_events
      WHERE installation_id=$1 AND idempotency_key LIKE $2
      ORDER BY created_at,id`,
    [requestContext.installationId, `${prefix}%`],
  );
  if ((existing.rows ?? []).length) {
    return existing.rows.some((row) => row.payload_hash !== hash)
      ? failure(
        'IDEMPOTENCY_PAYLOAD_MISMATCH',
        'Idempotency key was already used with another adjustment payload',
      )
      : { ok: true, events: existing.rows.map(mapAdjustment), replayed: true };
  }

  const groupId = randomUUID();
  const inserted = [];
  for (let index = 0; index < allocations.length; index += 1) {
    const target = allocations[index];
    const warehouseId = String(target.warehouseId ?? '').trim();
    const baseVariantId = String(target.baseVariantId ?? '').trim();
    if (!UUID_PATTERN.test(warehouseId) || !scoped.includes(warehouseId)) {
      return failure('WAREHOUSE_SCOPE_DENIED', 'Adjustment target is outside authorized warehouse scope');
    }
    if (!UUID_PATTERN.test(baseVariantId)) {
      return failure('INVALID_COST_ADJUSTMENT_TARGET', 'Adjustment target baseVariantId is invalid');
    }
    const value = parse12(target.valueDelta);
    const quantity = parse12(target.quantityDelta ?? '0');
    if (value === null || quantity === null || (value === 0n && quantity === 0n)) {
      return failure(
        'INVALID_COST_ADJUSTMENT_VALUE',
        'Adjustment target must have non-zero quantity or value',
      );
    }
    const originalFactId = target.originalCostFactId ?? payload.originalCostFactId ?? null;
    const originalMovementLineId = target.originalMovementLineId
      ?? payload.originalMovementLineId
      ?? null;
    if ((originalFactId && !UUID_PATTERN.test(String(originalFactId)))
        || (originalMovementLineId && !UUID_PATTERN.test(String(originalMovementLineId)))) {
      return failure('INVALID_COST_ADJUSTMENT_LINEAGE', 'Adjustment lineage identifiers are invalid');
    }
    if (eventType === 'FORWARD_CORRECTION' && !originalFactId && !originalMovementLineId) {
      return failure(
        'FORWARD_CORRECTION_LINEAGE_REQUIRED',
        'Forward correction requires original cost fact or movement line lineage',
      );
    }
    const row = await client.query(
      `INSERT INTO inventory.inventory_cost_adjustment_events (
       id,installation_id,event_type,effective_date,posting_date,warehouse_id,base_variant_id,
       quantity_delta,value_delta,currency_code,allocation_group_id,allocation_basis,
       source_document_type,source_document_id,source_line_reference,original_cost_fact_id,
       original_movement_line_id,idempotency_key,payload_hash,created_by,request_id,source_app,metadata
       ) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8::numeric,$9::numeric,'VND',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb)
       RETURNING *`,
      [
        randomUUID(), requestContext.installationId, eventType, effectiveDate,
        postingDate, warehouseId, baseVariantId, format12(quantity), format12(value),
        groupId, eventType === 'FORWARD_CORRECTION' ? null : payload.allocationBasis,
        sourceDocumentType, sourceDocumentId,
        target.receiptLineId ?? target.sourceLineReference ?? null,
        originalFactId, originalMovementLineId, `${prefix}${index}`, hash,
        actorId(requestContext), requestContext.requestId,
        requestContext.sourceApp ?? 'npp-core',
        JSON.stringify({ reason: payload.reason ?? null }),
      ],
    );
    inserted.push(row.rows[0]);
  }
  return { ok: true, events: inserted.map(mapAdjustment), replayed: false };
}

export async function listAdjustmentEvents(client, requestContext) {
  const scoped = warehouseIds(requestContext);
  if (!scoped.length) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  }
  const result = await client.query(
    `SELECT event.*,warehouse.code AS warehouse_code,variant.sku AS base_sku
       FROM inventory.inventory_cost_adjustment_events event
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id=event.installation_id AND warehouse.id=event.warehouse_id
       JOIN shared.product_variants variant
         ON variant.installation_id=event.installation_id AND variant.id=event.base_variant_id
      WHERE event.installation_id=$1 AND event.warehouse_id=ANY($2::uuid[])
      ORDER BY event.posting_date DESC,event.created_at DESC,event.id DESC LIMIT 500`,
    [requestContext.installationId, scoped],
  );
  return { ok: true, events: (result.rows ?? []).map(mapAdjustment) };
}
