import { createHash } from 'node:crypto';
import { createIdempotencyKey } from '@npp/contracts';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as repository from '../db/repositories/sales-fulfillment-operations.js';
import {
  formatHoldQuantity,
  loadDemandHoldAvailability,
  parseHoldQuantity,
  reconcileDemandHold,
} from './sales-fulfillment-hold.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const SCALE = 1_000_000_000_000n;
const WORK_STATUSES = new Set([
  'backordered', 'partially_reserved', 'reserved',
  'partially_allocated', 'allocated',
  'partially_picked', 'picked',
  'partially_packed', 'packed',
]);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
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
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function deterministicUuid(value) {
  const bytes = Buffer.from(createHash('sha256').update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function childIdempotencyKey(operationKey, index) {
  return createIdempotencyKey(
    'sales-fulfillment-child',
    deterministicUuid(`${operationKey}|${index}`),
  );
}

function parseQuantity(value) {
  const normalized = String(value ?? '').trim();
  const match = QUANTITY_PATTERN.exec(normalized);
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(12, '0'));
}

function formatQuantity(value) {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(12, '0');
  return `${whole}.${fraction}`;
}

function grantedPermissions(requestContext) {
  return new Set([
    ...(Array.isArray(requestContext?.permissions) ? requestContext.permissions : []),
    ...(Array.isArray(requestContext?.grantedPermissions) ? requestContext.grantedPermissions : []),
  ]);
}

function hasPermission(requestContext, permission) {
  return grantedPermissions(requestContext).has(permission);
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

function mapAllocation(row) {
  return Object.freeze({
    id: row.id,
    fulfillmentDemandId: row.fulfillment_demand_id,
    salesOrderId: row.sales_order_id,
    salesOrderVersionId: row.sales_order_version_id,
    salesOrderLineId: row.sales_order_line_id,
    warehouseId: row.warehouse_id,
    locationId: row.location_id,
    locationCode: row.location_code ?? null,
    locationName: row.location_name ?? null,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id,
    lotCode: row.lot_code ?? null,
    expiryDate: row.expiry_date ?? null,
    inventoryReservationId: row.inventory_reservation_id,
    allocationSequence: Number(row.allocation_sequence),
    allocationPolicy: row.allocation_policy,
    policyRank: Number(row.policy_rank),
    manualOverrideReason: row.manual_override_reason ?? null,
    allocatedBaseQuantity: String(row.allocated_base_quantity),
    pickedBaseQuantity: String(row.picked_base_quantity),
    packedBaseQuantity: String(row.packed_base_quantity),
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapWorkRow(row) {
  const ordered = String(row.ordered_base_quantity);
  const allocated = String(row.allocated_base_quantity);
  const unallocated = formatQuantity(
    (parseQuantity(ordered) ?? 0n) > (parseQuantity(allocated) ?? 0n)
      ? (parseQuantity(ordered) ?? 0n) - (parseQuantity(allocated) ?? 0n)
      : 0n,
  );
  return Object.freeze({
    fulfillmentDemandId: row.fulfillment_demand_id,
    salesOrderId: row.sales_order_id,
    orderNumber: row.order_number,
    fulfillmentStatus: row.fulfillment_status,
    requestedDeliveryDate: row.requested_delivery_date,
    sourceType: row.source_type,
    deliveryMode: row.delivery_mode ?? null,
    deliveryExecutionMode: row.delivery_execution_mode ?? null,
    customerCode: row.customer_code_snapshot,
    customerName: row.customer_name_snapshot,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code_snapshot,
    warehouseName: row.warehouse_name_snapshot,
    salesOrderVersionId: row.sales_order_version_id,
    salesOrderLineId: row.sales_order_line_id,
    lineNumber: Number(row.line_number),
    itemName: row.item_name_snapshot,
    sku: row.sku_snapshot,
    unitCode: row.ordered_unit_code,
    orderedQuantity: String(row.ordered_sales_quantity ?? row.ordered_base_quantity),
    orderedUnitCode: row.ordered_unit_code,
    baseUnitCode: row.base_unit_code ?? row.ordered_unit_code,
    baseVariantId: row.base_variant_id,
    orderedBaseQuantity: ordered,
    reservedBaseQuantity: String(row.reserved_base_quantity),
    backorderedBaseQuantity: String(row.backordered_base_quantity),
    allocatedBaseQuantity: allocated,
    unallocatedBaseQuantity: unallocated,
    pickedBaseQuantity: String(row.picked_base_quantity),
    packedBaseQuantity: String(row.packed_base_quantity),
    allocationCount: Number(row.allocation_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapCandidate(row, index) {
  return Object.freeze({
    rank: index + 1,
    warehouseId: row.warehouse_id,
    locationId: row.location_id,
    locationCode: row.location_code ?? null,
    locationName: row.location_name ?? null,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id,
    lotCode: row.lot_code ?? null,
    expiryDate: row.expiry_date ?? null,
    firstReceivedAt: row.first_received_at ?? null,
    availableBaseQuantity: String(row.available_quantity),
    allocationPolicy: row.allocation_policy,
    lotTrackingMode: row.lot_tracking_mode,
    expiryTrackingMode: row.expiry_tracking_mode,
    locationRequired: Boolean(row.location_required),
  });
}

export async function listFulfillmentWorkQueue(client, {
  requestContext,
  status = null,
  limit = 200,
  offset = 0,
}) {
  if (!hasPermission(requestContext, 'core.fulfillment.read')) {
    return failure('PERMISSION_DENIED', 'Permission core.fulfillment.read is required');
  }
  const warehouseIds = Array.isArray(requestContext?.scopes?.warehouseIds)
    ? requestContext.scopes.warehouseIds.filter((id) => UUID_PATTERN.test(id))
    : [];
  if (warehouseIds.length === 0) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'At least one warehouse scope is required');
  }
  const normalizedStatus = status ? String(status).trim() : null;
  if (normalizedStatus && !WORK_STATUSES.has(normalizedStatus)) {
    return failure('INVALID_FULFILLMENT_STATUS', 'Fulfillment status filter is invalid');
  }
  const rows = await repository.listFulfillmentWork(client, {
    installationId: requestContext.installationId,
    warehouseIds,
    status: normalizedStatus,
    limit: Math.min(Math.max(Number(limit) || 200, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0),
  });
  const work = [];
  for (const row of rows) {
    const availability = await loadDemandHoldAvailability(client, {
      installationId: requestContext.installationId,
      demandId: row.fulfillment_demand_id,
    });
    work.push(Object.freeze({
      ...mapWorkRow(row),
      warehouseOnHandBaseQuantity: availability?.onHandBaseQuantity ?? '0.000000000000',
      warehouseHeldByOthersBaseQuantity: availability?.heldByOthersBaseQuantity ?? '0.000000000000',
      warehouseAvailableBaseQuantity: availability?.capacityBaseQuantity ?? '0.000000000000',
    }));
  }
  return Object.freeze({ ok: true, work: Object.freeze(work) });
}

async function loadDemandAndCandidates(client, { requestContext, demandId, forUpdate = false }) {
  const identityError = validateIdentity(demandId, 'demandId');
  if (identityError) return identityError;
  const demand = await repository.getActiveDemandForUpdate(client, {
    installationId: requestContext.installationId,
    demandId,
  });
  if (!demand || demand.sales_order_status !== 'confirmed') {
    return failure('FULFILLMENT_DEMAND_NOT_FOUND', 'Active confirmed fulfillment demand was not found');
  }
  if (!warehouseAllowed(requestContext, demand.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Fulfillment demand is outside the authorized warehouse scope');
  }
  if (forUpdate) {
    await repository.lockFulfillmentScope(client, {
      installationId: requestContext.installationId,
      warehouseId: demand.warehouse_id,
      baseVariantId: demand.base_variant_id,
    });
  }
  const rows = await repository.listAllocationCandidates(client, {
    installationId: requestContext.installationId,
    warehouseId: demand.warehouse_id,
    baseVariantId: demand.base_variant_id,
  });
  return Object.freeze({
    ok: true,
    demand,
    candidates: Object.freeze(rows.map(mapCandidate)),
  });
}

export async function suggestFulfillmentAllocation(client, { requestContext, demandId }) {
  if (!hasPermission(requestContext, 'core.fulfillment.read')) {
    return failure('PERMISSION_DENIED', 'Permission core.fulfillment.read is required');
  }
  const loaded = await loadDemandAndCandidates(client, { requestContext, demandId });
  if (!loaded.ok) return loaded;
  const ordered = parseQuantity(loaded.demand.ordered_base_quantity) ?? 0n;
  const allocated = parseQuantity(loaded.demand.allocated_base_quantity) ?? 0n;
  const remaining = ordered > allocated ? ordered - allocated : 0n;
  const reserved = parseQuantity(loaded.demand.reserved_base_quantity) ?? 0n;
  const held = reserved > allocated ? reserved - allocated : 0n;
  const plan = buildAutoPlan(loaded.candidates, held);
  const allocations = await repository.listDemandAllocations(client, {
    installationId: requestContext.installationId,
    demandId,
  });
  const availability = await loadDemandHoldAvailability(client, {
    installationId: requestContext.installationId,
    demandId,
  });
  return Object.freeze({
    ok: true,
    demand: mapWorkRow({ ...loaded.demand, fulfillment_demand_id: loaded.demand.id, allocation_count: allocations.length }),
    remainingBaseQuantity: formatQuantity(remaining),
    heldRemainingBaseQuantity: formatQuantity(held),
    warehouseOnHandBaseQuantity: availability?.onHandBaseQuantity ?? '0.000000000000',
    warehouseHeldByOthersBaseQuantity: availability?.heldByOthersBaseQuantity ?? '0.000000000000',
    warehouseAvailableBaseQuantity: availability?.capacityBaseQuantity ?? '0.000000000000',
    candidates: loaded.candidates,
    suggestedPlan: plan.map((item) => Object.freeze({
      ...item,
      quantity: formatQuantity(item.quantityScaled),
      quantityScaled: undefined,
    })),
    allocations: Object.freeze(allocations.map(mapAllocation)),
  });
}

export function buildAutoPlan(candidates, remainingQuantity) {
  let remaining = remainingQuantity;
  const plan = [];
  for (const candidate of candidates) {
    if (remaining <= 0n) break;
    const available = parseQuantity(candidate.availableBaseQuantity);
    if (available === null || available <= 0n) continue;
    const quantity = available < remaining ? available : remaining;
    plan.push(Object.freeze({
      locationId: candidate.locationId,
      lotId: candidate.lotId,
      allocationPolicy: candidate.allocationPolicy,
      policyRank: candidate.rank,
      manualOverrideReason: null,
      quantityScaled: quantity,
    }));
    remaining -= quantity;
  }
  return Object.freeze(plan);
}

function buildManualPlan(payload, candidates, requestContext, remaining) {
  if (!hasPermission(requestContext, 'core.fulfillment.override-allocation-policy')) {
    return failure(
      'ALLOCATION_POLICY_OVERRIDE_FORBIDDEN',
      'Permission core.fulfillment.override-allocation-policy is required',
    );
  }
  const reason = String(payload?.reason ?? '').trim();
  if (!reason || reason.length > 1000) {
    return failure('ALLOCATION_OVERRIDE_REASON_REQUIRED', 'Manual allocation reason is required');
  }
  if (!Array.isArray(payload?.allocations) || payload.allocations.length === 0) {
    return failure('ALLOCATION_LINES_REQUIRED', 'Manual allocation requires at least one exact scope');
  }
  const candidateMap = new Map(candidates.map((candidate) => [
    `${candidate.locationId ?? '<null>'}:${candidate.lotId ?? '<null>'}`,
    candidate,
  ]));
  const requestedByScope = new Map();
  let requested = 0n;
  for (let index = 0; index < payload.allocations.length; index += 1) {
    const input = payload.allocations[index] ?? {};
    const key = `${input.locationId ?? '<null>'}:${input.lotId ?? '<null>'}`;
    const candidate = candidateMap.get(key);
    if (!candidate) {
      return failure('ALLOCATION_SCOPE_NOT_AVAILABLE', 'Manual location/lot is unavailable', false, { line: index + 1 });
    }
    const quantity = parseQuantity(input.quantity);
    if (quantity === null || quantity <= 0n) {
      return failure('INVALID_ALLOCATION_QUANTITY', 'Manual allocation quantity must be positive', false, { line: index + 1 });
    }
    const accumulated = (requestedByScope.get(key)?.quantityScaled ?? 0n) + quantity;
    const available = parseQuantity(candidate.availableBaseQuantity);
    if (available === null || accumulated > available) {
      return failure(
        'INVALID_ALLOCATION_QUANTITY',
        'Cumulative manual allocation quantity exceeds available stock',
        false,
        { line: index + 1 },
      );
    }
    requestedByScope.set(key, Object.freeze({ candidate, quantityScaled: accumulated }));
    requested += quantity;
    if (requested > remaining) {
      return failure('ALLOCATION_EXCEEDS_RESERVED_DEMAND', 'Allocation exceeds remaining reserved demand');
    }
  }
  const plan = [...requestedByScope.values()].map(({ candidate, quantityScaled }) => Object.freeze({
    locationId: candidate.locationId,
    lotId: candidate.lotId,
    allocationPolicy: 'MANUAL',
    policyRank: candidate.rank,
    manualOverrideReason: reason,
    quantityScaled,
  }));
  return Object.freeze({ ok: true, plan: Object.freeze(plan), reason });
}

function allocationSnapshot(demand, allocations) {
  return Object.freeze({
    fulfillmentDemandId: demand.id,
    salesOrderId: demand.sales_order_id,
    orderNumber: demand.order_number,
    customerCode: demand.customer_code_snapshot,
    customerName: demand.customer_name_snapshot,
    sku: demand.sku_snapshot,
    itemName: demand.item_name_snapshot,
    warehouseId: demand.warehouse_id,
    warehouseCode: demand.warehouse_code_snapshot,
    orderedBaseQuantity: String(demand.ordered_base_quantity),
    allocationTargetBaseQuantity: String(
      demand.allocation_target_base_quantity ?? demand.ordered_base_quantity,
    ),
    reservedBaseQuantity: String(demand.reserved_base_quantity),
    allocatedBaseQuantity: allocations.reduce(
      (sum, item) => formatQuantity(parseQuantity(sum) + parseQuantity(item.allocatedBaseQuantity)),
      '0.000000000000',
    ),
    allocations: Object.freeze(allocations),
  });
}

export async function executeAllocateFulfillmentDemand({
  adapter,
  requestContext,
  demandId,
  idempotencyKey,
  payload = {},
}) {
  if (!hasPermission(requestContext, 'core.fulfillment.allocate')) {
    return failure('PERMISSION_DENIED', 'Permission core.fulfillment.allocate is required');
  }
  const mode = String(payload?.mode ?? 'AUTO').trim().toUpperCase();
  const requestedQuantity = mode === 'QUANTITY' ? parseQuantity(payload?.quantity) : null;
  if (mode === 'QUANTITY' && (requestedQuantity === null || requestedQuantity <= 0n)) {
    return failure('INVALID_ALLOCATION_QUANTITY', 'Số lượng phân bổ phải lớn hơn 0.');
  }
  if (!['AUTO', 'QUANTITY', 'MANUAL'].includes(mode)) {
    return failure('INVALID_ALLOCATION_MODE', 'Allocation mode must be AUTO, QUANTITY or MANUAL');
  }

  const operationPayload = Object.freeze({
    demandId,
    mode,
    quantity: requestedQuantity === null ? null : formatQuantity(requestedQuantity),
    payload,
  });
  const hash = payloadHash(operationPayload);
  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await repository.setFulfillmentAllocationWriteContexts(client);
      await repository.lockOperationKey(client, {
        installationId: requestContext.installationId,
        operation: 'allocate',
        idempotencyKey,
      });
      const replayRows = await repository.getAllocationsByOperationKey(client, {
        installationId: requestContext.installationId,
        operationIdempotencyKey: idempotencyKey,
      });
      if (replayRows.length > 0) {
        if (
          replayRows.some((row) => row.payload_hash !== hash)
          || replayRows.some((row) => row.fulfillment_demand_id !== demandId)
        ) {
          return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another allocation payload') };
        }
        const replayDemand = await repository.getActiveDemandForUpdate(client, {
          installationId: requestContext.installationId,
          demandId,
        });
        if (!replayDemand || replayDemand.sales_order_status !== 'confirmed') {
          return { failed: failure('FULFILLMENT_DEMAND_NOT_FOUND', 'Active confirmed fulfillment demand was not found') };
        }
        if (!warehouseAllowed(requestContext, replayDemand.warehouse_id)) {
          return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Fulfillment demand is outside the authorized warehouse scope') };
        }
        const replayAllocationRows = await repository.listDemandAllocations(client, {
          installationId: requestContext.installationId,
          demandId,
        });
        return Object.freeze({
          ok: true,
          replayed: true,
          allocation: allocationSnapshot(replayDemand, replayAllocationRows.map(mapAllocation)),
        });
      }

      let loaded = await loadDemandAndCandidates(client, {
        requestContext,
        demandId,
        forUpdate: true,
      });
      if (!loaded.ok) return { failed: loaded };
      const ordered = parseQuantity(loaded.demand.ordered_base_quantity) ?? 0n;
      const allocatedBefore = parseQuantity(loaded.demand.allocated_base_quantity) ?? 0n;
      if (allocatedBefore >= ordered) {
        return { failed: failure(
          'FULFILLMENT_DEMAND_ALREADY_ALLOCATED',
          'No reserved quantity remains to allocate',
        ) };
      }

      if (mode === 'AUTO' || mode === 'QUANTITY') {
        const target = mode === 'AUTO'
          ? ordered
          : allocatedBefore + requestedQuantity;
        if (target > ordered) {
          return { failed: failure(
            'ALLOCATION_EXCEEDS_ORDER_DEMAND',
            'Số lượng phân bổ vượt phần đơn còn cần.',
          ) };
        }
        const hold = await reconcileDemandHold(client, {
          installationId: requestContext.installationId,
          demandId,
          actorId: requestContext.actorId,
          targetBaseQuantity: formatHoldQuantity(target),
        });
        if (!hold.ok) return { failed: hold };
        loaded = Object.freeze({ ...loaded, demand: { ...loaded.demand, ...hold.demand } });
      }

      const reserved = parseHoldQuantity(loaded.demand.reserved_base_quantity) ?? 0n;
      const allocated = parseQuantity(loaded.demand.allocated_base_quantity) ?? 0n;
      const remaining = reserved - allocated;
      if (remaining <= 0n) {
        return { failed: failure(
          'NO_ALLOCATABLE_STOCK',
          'Hiện chưa có thêm hàng có thể phân bổ cho dòng này.',
        ) };
      }

      let plan;
      if (mode === 'AUTO' || mode === 'QUANTITY') {
        plan = buildAutoPlan(loaded.candidates, remaining);
      } else {
        const manual = buildManualPlan(payload, loaded.candidates, requestContext, remaining);
        if (!manual.ok) return { failed: manual };
        plan = manual.plan;
      }
      if (plan.length === 0) {
        return { failed: failure('NO_ALLOCATABLE_STOCK', 'No active non-expired location/lot has allocatable stock') };
      }

      const existingAllocationRows = await repository.listDemandAllocations(client, {
        installationId: requestContext.installationId,
        demandId,
      });
      const baseSequence = existingAllocationRows.reduce(
        (maximum, row) => Math.max(maximum, Number(row.allocation_sequence) || 0),
        0,
      );
      if (baseSequence + plan.length > 10000) {
        return { failed: failure('ALLOCATION_SEQUENCE_LIMIT_EXCEEDED', 'Fulfillment demand has too many allocation rows') };
      }

      const createdAllocations = [];
      const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
      for (let index = 0; index < plan.length; index += 1) {
        const item = plan[index];
        const quantity = formatQuantity(item.quantityScaled);
        await repository.lockExactInventoryScope(client, {
          installationId: requestContext.installationId,
          warehouseId: loaded.demand.warehouse_id,
          locationId: item.locationId,
          baseVariantId: loaded.demand.base_variant_id,
          lotId: item.lotId,
        });
        const demandProgress = await repository.incrementDemandAllocatedQuantity(client, {
          installationId: requestContext.installationId,
          demandId,
          quantity,
          actorId: requestContext.actorId,
        });
        if (!demandProgress) {
          return { failed: failure('ALLOCATION_EXCEEDS_RESERVED_DEMAND', 'Concurrent allocation exhausted the remaining reserved demand', true) };
        }

        const allocationId = deterministicUuid(`${idempotencyKey}|allocation|${index + 1}`);
        const reservationId = deterministicUuid(`${idempotencyKey}|reservation|${index + 1}`);
        const childKey = childIdempotencyKey(idempotencyKey, index + 1);
        const reservation = await repository.insertInventoryReservation(client, {
          id: reservationId,
          installationId: requestContext.installationId,
          warehouseId: loaded.demand.warehouse_id,
          locationId: item.locationId,
          baseVariantId: loaded.demand.base_variant_id,
          lotId: item.lotId,
          quantity,
          allocationId,
          occurredAt,
          idempotencyKey: childKey,
          payloadHash: hash,
          metadata: {
            fulfillmentDemandId: demandId,
            salesOrderId: loaded.demand.sales_order_id,
            salesOrderLineId: loaded.demand.sales_order_line_id,
            allocationPolicy: item.allocationPolicy,
          },
        });
        if (!reservation) {
          return { failed: failure('INVENTORY_RESERVATION_CONFLICT', 'Exact inventory reservation could not be created', true) };
        }
        await repository.insertInventoryReservationEvent(client, {
          installationId: requestContext.installationId,
          reservationId,
          actorId: requestContext.actorId,
          requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp,
          payloadHash: hash,
          occurredAt,
          metadata: { action: 'sales_fulfillment_allocate', allocationId, fulfillmentDemandId: demandId },
        });
        const allocationRow = await repository.insertAllocation(client, {
          id: allocationId,
          installationId: requestContext.installationId,
          demandId,
          salesOrderId: loaded.demand.sales_order_id,
          salesOrderVersionId: loaded.demand.sales_order_version_id,
          salesOrderLineId: loaded.demand.sales_order_line_id,
          warehouseId: loaded.demand.warehouse_id,
          locationId: item.locationId,
          baseVariantId: loaded.demand.base_variant_id,
          lotId: item.lotId,
          inventoryReservationId: reservationId,
          allocationSequence: baseSequence + index + 1,
          allocationPolicy: item.allocationPolicy,
          policyRank: item.policyRank,
          manualOverrideReason: item.manualOverrideReason,
          quantity,
          operationIdempotencyKey: idempotencyKey,
          idempotencyKey: childKey,
          payloadHash: hash,
          actorId: requestContext.actorId,
        });
        await repository.insertAllocationEvent(client, {
          installationId: requestContext.installationId,
          allocationId,
          eventType: 'ALLOCATED',
          quantity,
          actorId: requestContext.actorId,
          requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp,
          idempotencyKey: createIdempotencyKey(
            'sales-fulfillment-event',
            deterministicUuid(`${idempotencyKey}|event|${index + 1}`),
          ),
          payloadHash: hash,
          reason: item.manualOverrideReason,
          metadata: { allocationPolicy: item.allocationPolicy, policyRank: item.policyRank },
          occurredAt,
        });
        createdAllocations.push(mapAllocation(allocationRow));
      }

      const allAllocationRows = await repository.listDemandAllocations(client, {
        installationId: requestContext.installationId,
        demandId,
      });
      const refreshedDemand = await repository.getActiveDemandForUpdate(client, {
        installationId: requestContext.installationId,
        demandId,
      });
      const allAllocations = allAllocationRows.map(mapAllocation);
      const snapshot = allocationSnapshot(refreshedDemand ?? loaded.demand, allAllocations);
      const audit = buildAuditRecord({
        requestContext,
        action: 'sales.fulfillment.allocate',
        resourceType: 'sales_fulfillment_demand',
        resourceId: demandId,
        afterData: snapshot,
        metadata: {
          salesOrderId: loaded.demand.sales_order_id,
          createdAllocationCount: createdAllocations.length,
          totalAllocationCount: allAllocations.length,
        },
      });
      const event = buildOutboxEvent({
        requestContext,
        aggregateType: 'sales.fulfillment_demand',
        aggregateId: demandId,
        eventType: 'core.sales_order.fulfillment.allocated',
        eventVersion: 1,
        payload: snapshot,
        metadata: { salesOrderId: loaded.demand.sales_order_id },
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, event);
      return Object.freeze({ ok: true, replayed: false, allocation: snapshot, auditId: audit.auditId, eventId: event.eventId });
    },
  });
  return transaction?.failed ?? transaction;
}

async function executeProgress({
  adapter,
  requestContext,
  allocationId,
  idempotencyKey,
  payload,
  permission,
  eventType,
  field,
  action,
  outboxType,
}) {
  if (!hasPermission(requestContext, permission)) {
    return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  }
  const identityError = validateIdentity(allocationId, 'allocationId');
  if (identityError) return identityError;
  const quantity = parseQuantity(payload?.quantity);
  if (quantity === null || quantity <= 0n) {
    return failure('INVALID_PROGRESS_QUANTITY', 'Progress quantity must be a positive decimal string');
  }
  const operationPayload = Object.freeze({ allocationId, eventType, quantity: formatQuantity(quantity), reason: payload?.reason ?? null });
  const hash = payloadHash(operationPayload);
  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await repository.setFulfillmentAllocationWriteContexts(client);
      await repository.lockOperationKey(client, {
        installationId: requestContext.installationId,
        operation: eventType.toLowerCase(),
        idempotencyKey,
      });
      const replayEvent = await repository.getAllocationEventByIdempotencyKey(client, {
        installationId: requestContext.installationId,
        idempotencyKey,
      });
      if (replayEvent) {
        if (replayEvent.payload_hash !== hash
          || replayEvent.allocation_id !== allocationId
          || replayEvent.event_type !== eventType) {
          return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another progress payload') };
        }
        const replayAllocation = await repository.getAllocationForUpdate(client, {
          installationId: requestContext.installationId,
          allocationId,
        });
        if (!replayAllocation) {
          return { failed: failure('FULFILLMENT_ALLOCATION_NOT_FOUND', 'Active fulfillment allocation was not found') };
        }
        if (!warehouseAllowed(requestContext, replayAllocation.warehouse_id)) {
          return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Allocation is outside the authorized warehouse scope') };
        }
        return Object.freeze({ ok: true, replayed: true, allocation: mapAllocation(replayAllocation) });
      }

      const allocation = await repository.getAllocationForUpdate(client, {
        installationId: requestContext.installationId,
        allocationId,
      });
      if (!allocation) return { failed: failure('FULFILLMENT_ALLOCATION_NOT_FOUND', 'Active fulfillment allocation was not found') };
      if (!warehouseAllowed(requestContext, allocation.warehouse_id)) {
        return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Allocation is outside the authorized warehouse scope') };
      }
      await repository.lockFulfillmentScope(client, {
        installationId: requestContext.installationId,
        warehouseId: allocation.warehouse_id,
        baseVariantId: allocation.base_variant_id,
      });
      const updated = await repository.incrementAllocationProgress(client, {
        installationId: requestContext.installationId,
        allocationId,
        field,
        quantity: formatQuantity(quantity),
        actorId: requestContext.actorId,
      });
      if (!updated) {
        return { failed: failure(
          eventType === 'PICKED' ? 'PICK_EXCEEDS_ALLOCATION' : 'PACK_EXCEEDS_PICKED',
          eventType === 'PICKED'
            ? 'Pick quantity exceeds remaining allocated quantity'
            : 'Pack quantity exceeds remaining picked quantity',
        ) };
      }
      const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
      await repository.insertAllocationEvent(client, {
        installationId: requestContext.installationId,
        allocationId,
        eventType,
        quantity: formatQuantity(quantity),
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        idempotencyKey,
        payloadHash: hash,
        reason: String(payload?.reason ?? '').trim() || null,
        metadata: {},
        occurredAt,
      });
      const mapped = mapAllocation({ ...allocation, ...updated });
      const audit = buildAuditRecord({
        requestContext,
        action,
        resourceType: 'sales_fulfillment_allocation',
        resourceId: allocationId,
        beforeData: mapAllocation(allocation),
        afterData: mapped,
        metadata: { salesOrderId: allocation.sales_order_id, fulfillmentDemandId: allocation.fulfillment_demand_id },
      });
      const event = buildOutboxEvent({
        requestContext,
        aggregateType: 'sales.fulfillment_allocation',
        aggregateId: allocationId,
        eventType: outboxType,
        eventVersion: 1,
        payload: mapped,
        metadata: { salesOrderId: allocation.sales_order_id },
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, event);
      return Object.freeze({ ok: true, replayed: false, allocation: mapped, auditId: audit.auditId, eventId: event.eventId });
    },
  });
  return transaction?.failed ?? transaction;
}

export function executePickFulfillmentAllocation(args) {
  return executeProgress({
    ...args,
    permission: 'core.fulfillment.pick',
    eventType: 'PICKED',
    field: 'picked_base_quantity',
    action: 'sales.fulfillment.pick',
    outboxType: 'core.sales_order.fulfillment.picked',
  });
}

export function executePackFulfillmentAllocation(args) {
  return executeProgress({
    ...args,
    permission: 'core.fulfillment.pack',
    eventType: 'PACKED',
    field: 'packed_base_quantity',
    action: 'sales.fulfillment.pack',
    outboxType: 'core.sales_order.fulfillment.packed',
  });
}

export const fulfillmentOperationInternals = Object.freeze({
  parseQuantity,
  formatQuantity,
  payloadHash,
  deterministicUuid,
  childIdempotencyKey,
  buildAutoPlan,
  buildManualPlan,
  mapAllocation,
  mapWorkRow,
});
