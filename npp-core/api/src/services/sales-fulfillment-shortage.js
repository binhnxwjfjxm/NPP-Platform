import { randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as fulfillmentRepository from '../db/repositories/sales-fulfillment-operations.js';
import * as repository from '../db/repositories/sales-fulfillment-shortage.js';
import { fulfillmentOperationInternals } from './sales-fulfillment-operations.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const {
  parseQuantity,
  formatQuantity,
  payloadHash,
  mapAllocation,
} = fulfillmentOperationInternals;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function hasPermission(requestContext, permission) {
  return new Set([
    ...(Array.isArray(requestContext?.permissions) ? requestContext.permissions : []),
    ...(Array.isArray(requestContext?.grantedPermissions) ? requestContext.grantedPermissions : []),
  ]).has(permission);
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function validateIdentity(value, field) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? null
    : failure('INVALID_IDENTITY', `${field} is invalid`, false, { field });
}

function childIdempotencyKey(parentKey, suffix) {
  return `fulfillment.${payloadHash({ parentKey, suffix }).slice(0, 48)}`;
}

function mapShortage(row) {
  return Object.freeze({
    id: row.id,
    fulfillmentDemandId: row.fulfillment_demand_id,
    allocationId: row.allocation_id,
    salesOrderId: row.sales_order_id,
    warehouseId: row.warehouse_id,
    locationId: row.location_id,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id,
    requiredBaseQuantity: String(row.required_base_quantity),
    pickedBaseQuantity: String(row.picked_base_quantity),
    remainingBaseQuantity: String(row.remaining_base_quantity),
    reason: row.reason,
    actorId: row.actor_id,
    requestId: row.request_id,
    sourceApp: row.source_app,
    occurredAt: row.occurred_at,
  });
}

function mapDiscrepancy(row) {
  return Object.freeze({
    id: row.id,
    shortageId: row.source_shortage_id,
    warehouseId: row.warehouse_id,
    locationId: row.location_id,
    baseVariantId: row.base_variant_id,
    sku: row.sku_snapshot,
    lotId: row.lot_id,
    lotCode: row.lot_code_snapshot,
    bookBaseQuantity: String(row.book_base_quantity),
    observedBaseQuantity: String(row.observed_base_quantity),
    deltaBaseQuantity: String(row.delta_base_quantity),
    reason: row.reason,
    actorId: row.actor_id,
    requestId: row.request_id,
    sourceApp: row.source_app,
    occurredAt: row.occurred_at,
  });
}

function mapAlternative(row) {
  return Object.freeze({
    warehouseId: row.warehouse_id,
    locationId: row.location_id,
    locationCode: row.location_code ?? null,
    locationName: row.location_name ?? null,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id,
    lotCode: row.lot_code ?? null,
    availableBaseQuantity: String(row.available_quantity),
  });
}

export function normalizeShortagePayload(payload) {
  const picked = parseQuantity(payload?.actualPickedQuantity);
  const observed = parseQuantity(payload?.observedQuantity);
  const reason = String(payload?.reason ?? '').trim();
  if (picked === null || picked < 0n) {
    return failure('INVALID_SHORTAGE_PICKED_QUANTITY', 'Actual picked quantity must be a non-negative decimal string');
  }
  if (observed === null || observed < 0n) {
    return failure('INVALID_SHORTAGE_OBSERVED_QUANTITY', 'Observed stock quantity must be a non-negative decimal string');
  }
  if (!reason || reason.length > 1000) {
    return failure('SHORTAGE_REASON_REQUIRED', 'Shortage reason is required');
  }
  return Object.freeze({
    ok: true,
    picked,
    observed,
    pickedQuantity: formatQuantity(picked),
    observedQuantity: formatQuantity(observed),
    reason,
  });
}

function sumQuantities(rows, field) {
  return rows.reduce((sum, row) => sum + (parseQuantity(row[field]) ?? 0n), 0n);
}

export function evaluatePickingCloseState(demands, openAllocations, alternatives, latestClosure = null) {
  if (!Array.isArray(demands) || demands.length === 0) {
    return Object.freeze({
      ok: false,
      code: 'FULFILLMENT_ORDER_NOT_FOUND',
      message: 'Confirmed fulfillment order was not found',
    });
  }
  const ordered = sumQuantities(demands, 'ordered_base_quantity');
  const allocated = sumQuantities(demands, 'allocated_base_quantity');
  const picked = sumQuantities(demands, 'picked_base_quantity');
  const backordered = sumQuantities(demands, 'backordered_base_quantity');
  const remaining = ordered > picked ? ordered - picked : 0n;
  const fullReady = demands.every((demand) => {
    const lineOrdered = parseQuantity(demand.ordered_base_quantity) ?? 0n;
    const linePicked = parseQuantity(demand.picked_base_quantity) ?? 0n;
    const lineBackordered = parseQuantity(demand.backordered_base_quantity) ?? 0n;
    return linePicked >= lineOrdered && lineBackordered === 0n;
  });
  const shortageCount = openAllocations.filter((allocation) => Boolean(allocation.has_shortage)).length;
  const missingShortage = openAllocations.some((allocation) => !allocation.has_shortage);
  const allocationGap = demands.some((demand) => {
    const lineOrdered = parseQuantity(demand.ordered_base_quantity) ?? 0n;
    const lineAllocated = parseQuantity(demand.allocated_base_quantity) ?? 0n;
    const lineBackordered = parseQuantity(demand.backordered_base_quantity) ?? 0n;
    return lineAllocated + lineBackordered < lineOrdered;
  });
  const hasAlternative = alternatives.length > 0;
  const sameAsLatest = latestClosure
    && String(latestClosure.picked_base_quantity) === formatQuantity(picked)
    && String(latestClosure.remaining_base_quantity) === formatQuantity(remaining);
  let reasonCode = null;
  if (sameAsLatest) reasonCode = 'PICKING_ALREADY_CLOSED_AT_CURRENT_PROGRESS';
  else if (!fullReady && picked === 0n) reasonCode = 'NO_PICKED_QUANTITY';
  else if (!fullReady && missingShortage) reasonCode = 'SHORTAGE_FACT_REQUIRED';
  else if (!fullReady && allocationGap) reasonCode = 'UNALLOCATED_DEMAND_REMAINS';
  else if (!fullReady && hasAlternative) reasonCode = 'ALTERNATIVE_SOURCE_AVAILABLE';

  return Object.freeze({
    ok: true,
    canCloseFull: fullReady && !sameAsLatest,
    canClosePartial: !fullReady && picked > 0n && !missingShortage && !allocationGap && !hasAlternative && !sameAsLatest,
    reasonCode,
    orderedBaseQuantity: formatQuantity(ordered),
    allocatedBaseQuantity: formatQuantity(allocated),
    pickedBaseQuantity: formatQuantity(picked),
    remainingBaseQuantity: formatQuantity(remaining),
    backorderedBaseQuantity: formatQuantity(backordered),
    shortageCount,
    alternativeSources: Object.freeze(alternatives.map(mapAlternative)),
    latestCloseMode: sameAsLatest ? latestClosure.close_mode : null,
  });
}

async function loadCloseInputs(client, {
  requestContext,
  salesOrderId,
  forUpdate,
}) {
  const demands = await repository.listOrderPickingDemands(client, {
    installationId: requestContext.installationId,
    salesOrderId,
    forUpdate,
  });
  if (demands.length === 0) return failure('FULFILLMENT_ORDER_NOT_FOUND', 'Confirmed fulfillment order was not found');
  if (demands.some((demand) => !warehouseAllowed(requestContext, demand.warehouse_id))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Fulfillment order is outside the authorized warehouse scope');
  }
  if (forUpdate) {
    const scopes = new Set();
    for (const demand of demands) {
      const scopeKey = `${demand.warehouse_id}:${demand.base_variant_id}`;
      if (scopes.has(scopeKey)) continue;
      scopes.add(scopeKey);
      await fulfillmentRepository.lockFulfillmentScope(client, {
        installationId: requestContext.installationId,
        warehouseId: demand.warehouse_id,
        baseVariantId: demand.base_variant_id,
      });
    }
  }
  const openAllocations = await repository.listOrderOpenAllocations(client, {
    installationId: requestContext.installationId,
    salesOrderId,
    forUpdate,
  });
  const alternatives = [];
  for (const demand of demands) {
    const rows = await repository.listUnallocatedAlternativeSources(client, {
      installationId: requestContext.installationId,
      demandId: demand.id,
      warehouseId: demand.warehouse_id,
      baseVariantId: demand.base_variant_id,
      forUpdate,
    });
    alternatives.push(...rows);
  }
  const latestClosure = await repository.getLatestClosure(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  });
  return Object.freeze({ ok: true, demands, openAllocations, alternatives, latestClosure });
}

export async function getFulfillmentPickingCloseState(client, { requestContext, salesOrderId }) {
  if (!hasPermission(requestContext, 'core.fulfillment.read')) {
    return failure('PERMISSION_DENIED', 'Permission core.fulfillment.read is required');
  }
  const identityError = validateIdentity(salesOrderId, 'salesOrderId');
  if (identityError) return identityError;
  const loaded = await loadCloseInputs(client, { requestContext, salesOrderId, forUpdate: false });
  if (!loaded.ok) return loaded;
  return evaluatePickingCloseState(
    loaded.demands,
    loaded.openAllocations,
    loaded.alternatives,
    loaded.latestClosure,
  );
}

export async function executeRecordFulfillmentShortage({
  adapter,
  requestContext,
  allocationId,
  idempotencyKey,
  payload,
}) {
  if (!hasPermission(requestContext, 'core.fulfillment.pick')) {
    return failure('PERMISSION_DENIED', 'Permission core.fulfillment.pick is required');
  }
  const identityError = validateIdentity(allocationId, 'allocationId');
  if (identityError) return identityError;
  const normalized = normalizeShortagePayload(payload);
  if (!normalized.ok) return normalized;
  const operationPayload = Object.freeze({
    allocationId,
    actualPickedQuantity: normalized.pickedQuantity,
    observedQuantity: normalized.observedQuantity,
    reason: normalized.reason,
  });
  const hash = payloadHash(operationPayload);
  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await fulfillmentRepository.setFulfillmentAllocationWriteContexts(client);
      await repository.setFulfillmentShortageWriteContext(client);
      await fulfillmentRepository.lockOperationKey(client, {
        installationId: requestContext.installationId,
        operation: 'pick-shortage',
        idempotencyKey,
      });

      const replay = await repository.getShortageByIdempotencyKey(client, {
        installationId: requestContext.installationId,
        idempotencyKey,
      });
      if (replay) {
        if (replay.payload_hash !== hash || replay.allocation_id !== allocationId) {
          return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another shortage payload') };
        }
        const replayAllocation = await fulfillmentRepository.getAllocationForUpdate(client, {
          installationId: requestContext.installationId,
          allocationId,
        });
        if (!replayAllocation) return { failed: failure('FULFILLMENT_ALLOCATION_NOT_FOUND', 'Active fulfillment allocation was not found') };
        if (!warehouseAllowed(requestContext, replayAllocation.warehouse_id)) {
          return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Allocation is outside the authorized warehouse scope') };
        }
        const discrepancy = await repository.getDiscrepancyByShortageId(client, {
          installationId: requestContext.installationId,
          shortageId: replay.id,
        });
        return Object.freeze({
          ok: true,
          replayed: true,
          allocation: mapAllocation(replayAllocation),
          shortage: mapShortage(replay),
          discrepancy: discrepancy ? mapDiscrepancy(discrepancy) : null,
        });
      }

      const allocation = await fulfillmentRepository.getAllocationForUpdate(client, {
        installationId: requestContext.installationId,
        allocationId,
      });
      if (!allocation) return { failed: failure('FULFILLMENT_ALLOCATION_NOT_FOUND', 'Active fulfillment allocation was not found') };
      if (!warehouseAllowed(requestContext, allocation.warehouse_id)) {
        return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Allocation is outside the authorized warehouse scope') };
      }
      await fulfillmentRepository.lockFulfillmentScope(client, {
        installationId: requestContext.installationId,
        warehouseId: allocation.warehouse_id,
        baseVariantId: allocation.base_variant_id,
      });
      await fulfillmentRepository.lockExactInventoryScope(client, {
        installationId: requestContext.installationId,
        warehouseId: allocation.warehouse_id,
        locationId: allocation.location_id,
        baseVariantId: allocation.base_variant_id,
        lotId: allocation.lot_id,
      });

      const allocated = parseQuantity(allocation.allocated_base_quantity) ?? 0n;
      const alreadyPicked = parseQuantity(allocation.picked_base_quantity) ?? 0n;
      const required = allocated > alreadyPicked ? allocated - alreadyPicked : 0n;
      if (required <= 0n) {
        return { failed: failure('FULFILLMENT_ALLOCATION_ALREADY_PICKED', 'Allocation has no remaining pick quantity') };
      }
      if (normalized.picked >= required) {
        return { failed: failure('INVALID_SHORTAGE_PICKED_QUANTITY', 'Shortage picked quantity must be less than the remaining allocation') };
      }
      if (normalized.picked > normalized.observed) {
        return { failed: failure('INVALID_SHORTAGE_PICKED_QUANTITY', 'Actual picked quantity cannot exceed observed physical stock') };
      }

      const balance = await repository.getExactInventoryBalanceForUpdate(client, {
        installationId: requestContext.installationId,
        warehouseId: allocation.warehouse_id,
        locationId: allocation.location_id,
        baseVariantId: allocation.base_variant_id,
        lotId: allocation.lot_id,
      });
      const book = parseQuantity(balance?.on_hand_quantity ?? '0') ?? 0n;
      let updatedAllocation = allocation;
      const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
      if (normalized.picked > 0n) {
        const updated = await fulfillmentRepository.incrementAllocationProgress(client, {
          installationId: requestContext.installationId,
          allocationId,
          field: 'picked_base_quantity',
          quantity: normalized.pickedQuantity,
          actorId: requestContext.actorId,
        });
        if (!updated) {
          return { failed: failure('PICK_EXCEEDS_ALLOCATION', 'Pick quantity exceeds remaining allocated quantity') };
        }
        const pickKey = childIdempotencyKey(idempotencyKey, 'pick');
        const pickPayloadHash = payloadHash({
          allocationId,
          eventType: 'PICKED',
          quantity: normalized.pickedQuantity,
          reason: normalized.reason,
        });
        await fulfillmentRepository.insertAllocationEvent(client, {
          installationId: requestContext.installationId,
          allocationId,
          eventType: 'PICKED',
          quantity: normalized.pickedQuantity,
          actorId: requestContext.actorId,
          requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp,
          idempotencyKey: pickKey,
          payloadHash: pickPayloadHash,
          reason: normalized.reason,
          metadata: { source: 'FULFILLMENT_SHORTAGE' },
          occurredAt,
        });
        updatedAllocation = { ...allocation, ...updated };
      }

      const remaining = required - normalized.picked;
      const shortageId = randomUUID();
      const shortage = await repository.insertShortage(client, {
        id: shortageId,
        installationId: requestContext.installationId,
        fulfillmentDemandId: allocation.fulfillment_demand_id,
        allocationId,
        salesOrderId: allocation.sales_order_id,
        warehouseId: allocation.warehouse_id,
        locationId: allocation.location_id,
        baseVariantId: allocation.base_variant_id,
        lotId: allocation.lot_id,
        requiredQuantity: formatQuantity(required),
        pickedQuantity: normalized.pickedQuantity,
        remainingQuantity: formatQuantity(remaining),
        reason: normalized.reason,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        idempotencyKey,
        payloadHash: hash,
        occurredAt,
        metadata: { orderNumber: allocation.order_number },
      });
      const discrepancy = await repository.insertDiscrepancyObservation(client, {
        installationId: requestContext.installationId,
        shortageId,
        warehouseId: allocation.warehouse_id,
        locationId: allocation.location_id,
        baseVariantId: allocation.base_variant_id,
        skuSnapshot: allocation.sku_snapshot,
        lotId: allocation.lot_id,
        lotCodeSnapshot: allocation.lot_code,
        bookQuantity: formatQuantity(book),
        observedQuantity: normalized.observedQuantity,
        reason: normalized.reason,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        idempotencyKey: childIdempotencyKey(idempotencyKey, 'discrepancy'),
        payloadHash: hash,
        occurredAt,
        metadata: { allocationId, fulfillmentDemandId: allocation.fulfillment_demand_id },
      });
      const mappedAllocation = mapAllocation(updatedAllocation);
      const snapshot = Object.freeze({
        allocation: mappedAllocation,
        shortage: mapShortage(shortage),
        discrepancy: mapDiscrepancy(discrepancy),
      });
      const audit = buildAuditRecord({
        requestContext,
        action: 'sales.fulfillment.pick_shortage',
        resourceType: 'sales_fulfillment_shortage',
        resourceId: shortageId,
        afterData: snapshot,
        metadata: { salesOrderId: allocation.sales_order_id, allocationId },
      });
      const event = buildOutboxEvent({
        requestContext,
        aggregateType: 'sales.fulfillment_allocation',
        aggregateId: allocationId,
        eventType: 'core.sales_order.fulfillment.shortage_recorded',
        eventVersion: 1,
        payload: snapshot,
        metadata: { salesOrderId: allocation.sales_order_id, shortageId },
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, event);
      return Object.freeze({
        ok: true,
        replayed: false,
        ...snapshot,
        auditId: audit.auditId,
        eventId: event.eventId,
      });
    },
  });
  return transaction?.failed ?? transaction;
}

export async function executeCloseFulfillmentPicking({
  adapter,
  requestContext,
  salesOrderId,
  idempotencyKey,
  payload,
}) {
  if (!hasPermission(requestContext, 'core.fulfillment.pick')) {
    return failure('PERMISSION_DENIED', 'Permission core.fulfillment.pick is required');
  }
  const identityError = validateIdentity(salesOrderId, 'salesOrderId');
  if (identityError) return identityError;
  const mode = String(payload?.mode ?? '').trim().toUpperCase();
  if (!['FULL', 'PARTIAL'].includes(mode)) {
    return failure('INVALID_PICK_CLOSE_MODE', 'Picking close mode must be FULL or PARTIAL');
  }
  const hash = payloadHash({ salesOrderId, mode });
  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await repository.setFulfillmentShortageWriteContext(client);
      await fulfillmentRepository.lockOperationKey(client, {
        installationId: requestContext.installationId,
        operation: 'pick-close',
        idempotencyKey,
      });
      const replay = await repository.getClosureByIdempotencyKey(client, {
        installationId: requestContext.installationId,
        idempotencyKey,
      });
      if (replay) {
        if (replay.payload_hash !== hash || replay.sales_order_id !== salesOrderId || replay.close_mode !== mode) {
          return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another picking close payload') };
        }
        const loadedReplay = await loadCloseInputs(client, {
          requestContext,
          salesOrderId,
          forUpdate: false,
        });
        if (!loadedReplay.ok) return { failed: loadedReplay };
        return Object.freeze({
          ok: true,
          replayed: true,
          close: Object.freeze({
            id: replay.id,
            mode: replay.close_mode,
            snapshot: replay.snapshot,
            occurredAt: replay.occurred_at,
          }),
        });
      }

      const loaded = await loadCloseInputs(client, {
        requestContext,
        salesOrderId,
        forUpdate: true,
      });
      if (!loaded.ok) return { failed: loaded };
      const state = evaluatePickingCloseState(
        loaded.demands,
        loaded.openAllocations,
        loaded.alternatives,
        loaded.latestClosure,
      );
      if (!state.ok) return { failed: state };
      if (mode === 'FULL' && !state.canCloseFull) {
        return { failed: failure('PICK_CLOSE_FULL_BLOCKED', 'Order cannot be closed as fully picked', false, { reasonCode: state.reasonCode, state }) };
      }
      if (mode === 'PARTIAL' && !state.canClosePartial) {
        return { failed: failure('PICK_CLOSE_PARTIAL_BLOCKED', 'Order cannot be closed as partially picked', false, { reasonCode: state.reasonCode, state }) };
      }

      const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
      const snapshot = Object.freeze({
        salesOrderId,
        mode,
        orderedBaseQuantity: state.orderedBaseQuantity,
        allocatedBaseQuantity: state.allocatedBaseQuantity,
        pickedBaseQuantity: state.pickedBaseQuantity,
        remainingBaseQuantity: state.remainingBaseQuantity,
        backorderedBaseQuantity: state.backorderedBaseQuantity,
        shortageCount: state.shortageCount,
      });
      const closure = await repository.insertPickClosure(client, {
        installationId: requestContext.installationId,
        salesOrderId,
        closeMode: mode,
        orderedQuantity: state.orderedBaseQuantity,
        pickedQuantity: state.pickedBaseQuantity,
        remainingQuantity: state.remainingBaseQuantity,
        backorderedQuantity: state.backorderedBaseQuantity,
        shortageCount: state.shortageCount,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        idempotencyKey,
        payloadHash: hash,
        snapshot,
        occurredAt,
      });
      const audit = buildAuditRecord({
        requestContext,
        action: 'sales.fulfillment.pick_close',
        resourceType: 'sales_order',
        resourceId: salesOrderId,
        afterData: snapshot,
        metadata: { closeMode: mode },
      });
      const event = buildOutboxEvent({
        requestContext,
        aggregateType: 'sales.order',
        aggregateId: salesOrderId,
        eventType: 'core.sales_order.fulfillment.pick_closed',
        eventVersion: 1,
        payload: snapshot,
        metadata: { closeMode: mode, closureId: closure.id },
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, event);
      return Object.freeze({
        ok: true,
        replayed: false,
        close: Object.freeze({
          id: closure.id,
          mode,
          snapshot,
          occurredAt: closure.occurred_at,
        }),
        auditId: audit.auditId,
        eventId: event.eventId,
      });
    },
  });
  return transaction?.failed ?? transaction;
}

export const fulfillmentShortageInternals = Object.freeze({
  normalizeShortagePayload,
  evaluatePickingCloseState,
});
