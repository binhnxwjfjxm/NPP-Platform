import { createHash, randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as documentNumberRepository from '../db/repositories/document-numbering.js';
import { allocateDocumentNumber } from './document-numbering.js';
import * as repository from '../db/repositories/sales-delivery-orders.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const SCALE = 1_000_000_000_000n;
const DELIVERY_ORDER_SERIES_CODE = 'DELIVERY_ORDER';
const STATUSES = new Set(['draft', 'ready_to_dispatch', 'cancelled']);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function canonicalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
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

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter((id) => UUID_PATTERN.test(id)))]
    : [];
}

function warehouseAllowed(requestContext, warehouseId) {
  return warehouseIds(requestContext).includes(warehouseId);
}

function validateUuid(value, field) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? null
    : failure('INVALID_IDENTITY', `${field} is invalid`, false, { field });
}

function mapLine(row) {
  return Object.freeze({
    id: row.id,
    lineNumber: Number(row.line_number),
    salesOrderId: row.sales_order_id,
    salesOrderVersionId: row.sales_order_version_id,
    salesOrderLineId: row.sales_order_line_id,
    fulfillmentDemandId: row.fulfillment_demand_id,
    fulfillmentAllocationId: row.fulfillment_allocation_id,
    inventoryReservationId: row.inventory_reservation_id,
    warehouseId: row.warehouse_id,
    locationId: row.location_id,
    locationCode: row.location_code ?? null,
    locationName: row.location_name ?? null,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id,
    lotCode: row.lot_code ?? null,
    expiryDate: row.expiry_date ?? null,
    sku: row.sku_snapshot,
    itemName: row.item_name_snapshot,
    unitCode: row.unit_code_snapshot,
    packedBaseQuantitySnapshot: String(row.packed_base_quantity_snapshot),
    deliveryBaseQuantity: String(row.delivery_base_quantity),
  });
}

function mapEvent(row) {
  return Object.freeze({
    id: row.id,
    type: row.event_type,
    actorId: row.actor_id,
    requestId: row.request_id,
    sourceApp: row.source_app,
    reason: row.reason ?? null,
    metadata: row.metadata ?? {},
    occurredAt: row.occurred_at,
  });
}

function mapDeliveryOrder(row, lines = undefined, events = undefined) {
  return Object.freeze({
    id: row.id,
    number: row.delivery_order_number ?? null,
    salesOrderId: row.sales_order_id,
    salesOrderNumber: row.order_number ?? null,
    salesOrderVersionId: row.sales_order_version_id,
    customerId: row.customer_id,
    customerAddressId: row.customer_address_id ?? null,
    customerCode: row.customer_code_snapshot,
    customerName: row.customer_name_snapshot,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code_snapshot,
    warehouseName: row.warehouse_name_snapshot,
    handoverMode: row.handover_mode,
    destination: row.destination_snapshot ?? {},
    requestedDeliveryDate: row.requested_delivery_date
      ? String(row.requested_delivery_date).slice(0, 10)
      : null,
    collectionPolicy: row.collection_policy,
    status: row.status,
    note: row.note ?? null,
    revision: String(row.revision),
    lineCount: row.line_count === undefined ? undefined : Number(row.line_count),
    totalBaseQuantity: row.total_base_quantity === undefined ? undefined : String(row.total_base_quantity),
    confirmedAt: row.confirmed_at ?? null,
    confirmedBy: row.confirmed_by ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelledBy: row.cancelled_by ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    lines,
    events,
  });
}

function mapEligibility(row) {
  return Object.freeze({
    fulfillmentAllocationId: row.fulfillment_allocation_id,
    fulfillmentDemandId: row.fulfillment_demand_id,
    salesOrderId: row.sales_order_id,
    salesOrderNumber: row.order_number,
    salesOrderVersionId: row.sales_order_version_id,
    salesOrderLineId: row.sales_order_line_id,
    inventoryReservationId: row.inventory_reservation_id,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code_snapshot,
    warehouseName: row.warehouse_name_snapshot,
    handoverMode: row.delivery_mode,
    customerId: row.customer_id,
    customerCode: row.customer_code_snapshot,
    customerName: row.customer_name_snapshot,
    customerAddressId: row.customer_address_id ?? null,
    destination: row.customer_address_snapshot ?? null,
    requestedDeliveryDate: row.requested_delivery_date
      ? String(row.requested_delivery_date).slice(0, 10)
      : null,
    collectionPolicy: row.collection_policy,
    locationId: row.location_id,
    locationCode: row.location_code ?? null,
    locationName: row.location_name ?? null,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id,
    lotCode: row.lot_code ?? null,
    expiryDate: row.expiry_date ?? null,
    sku: row.sku_snapshot,
    itemName: row.item_name_snapshot,
    unitCode: row.unit_code_snapshot,
    packedBaseQuantity: String(row.packed_base_quantity),
    claimedBaseQuantity: String(row.claimed_base_quantity),
    availableForDeliveryOrderBaseQuantity: String(row.available_for_delivery_order_base_quantity),
    backorderedBaseQuantity: String(row.backordered_base_quantity),
  });
}

async function loadDetail(client, { requestContext, deliveryOrderId, forUpdate = false }) {
  const row = await repository.getDeliveryOrderForUpdate(client, {
    installationId: requestContext.installationId,
    deliveryOrderId,
    forUpdate,
  });
  if (!row) return failure('DELIVERY_ORDER_NOT_FOUND', 'Delivery Order was not found');
  if (!warehouseAllowed(requestContext, row.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Delivery Order is outside the authorized warehouse scope');
  }
  const [lines, events] = await Promise.all([
    repository.listDeliveryOrderLines(client, {
      installationId: requestContext.installationId,
      deliveryOrderId,
    }),
    repository.listDeliveryOrderEvents(client, {
      installationId: requestContext.installationId,
      deliveryOrderId,
    }),
  ]);
  return Object.freeze({
    ok: true,
    deliveryOrder: mapDeliveryOrder(
      row,
      Object.freeze(lines.map(mapLine)),
      Object.freeze(events.map(mapEvent)),
    ),
  });
}

function timestampDateOnly(value, timeZone) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(parsed);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

async function ensureDeliveryOrderSeries(client, { installationId, actorId }) {
  let series = await documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: DELIVERY_ORDER_SERIES_CODE,
  });
  if (series) return series;
  series = await documentNumberRepository.insertDocumentNumberSeries(client, {
    installationId,
    code: DELIVERY_ORDER_SERIES_CODE,
    documentType: 'DELIVERY_ORDER',
    name: 'Chứng từ giao nhận',
    prefix: 'DO-',
    numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
    resetPolicy: 'MONTHLY',
    sequenceWidth: 6,
    startCounter: '1',
    timezoneName: 'Asia/Ho_Chi_Minh',
    description: 'Số Delivery Order chính thức sau đóng gói.',
    isActive: true,
    createdBy: actorId,
  });
  return series ?? documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: DELIVERY_ORDER_SERIES_CODE,
  });
}

function knownDatabaseFailure(error) {
  const message = String(error?.message ?? '');
  if (message.includes('delivery_order_quantity_exceeds_unclaimed_packed')) {
    return failure(
      'DELIVERY_ORDER_QUANTITY_CONFLICT',
      'Packed quantity was claimed by another Delivery Order',
      true,
    );
  }
  if (message.includes('delivery_order_lineage_mismatch')) {
    return failure('DELIVERY_ORDER_LINEAGE_MISMATCH', 'Delivery Order lineage is invalid');
  }
  if (message.includes('delivery_order_invalid_status_transition')) {
    return failure('INVALID_STATUS_TRANSITION', 'Delivery Order status transition is invalid');
  }
  return null;
}

export async function listDeliveryOrderEligibility(client, {
  requestContext,
  salesOrderId = null,
  limit = 500,
  offset = 0,
}) {
  if (!hasPermission(requestContext, 'core.delivery-order.read')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-order.read is required');
  }
  if (salesOrderId && !UUID_PATTERN.test(salesOrderId)) {
    return failure('INVALID_SALES_ORDER_ID', 'Sales Order ID is invalid');
  }
  const scopedWarehouses = warehouseIds(requestContext);
  if (scopedWarehouses.length === 0) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'At least one warehouse scope is required');
  }
  const rows = await repository.listEligiblePackedAllocations(client, {
    installationId: requestContext.installationId,
    warehouseIds: scopedWarehouses,
    salesOrderId,
    limit: Math.min(Math.max(Number(limit) || 500, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0),
  });
  return Object.freeze({ ok: true, eligibility: Object.freeze(rows.map(mapEligibility)) });
}

export async function listDeliveryOrders(client, {
  requestContext,
  status = null,
  salesOrderId = null,
  limit = 200,
  offset = 0,
}) {
  if (!hasPermission(requestContext, 'core.delivery-order.read')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-order.read is required');
  }
  if (status && !STATUSES.has(status)) return failure('INVALID_STATUS', 'Delivery Order status is invalid');
  if (salesOrderId && !UUID_PATTERN.test(salesOrderId)) {
    return failure('INVALID_SALES_ORDER_ID', 'Sales Order ID is invalid');
  }
  const scopedWarehouses = warehouseIds(requestContext);
  if (scopedWarehouses.length === 0) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'At least one warehouse scope is required');
  }
  const rows = await repository.listDeliveryOrders(client, {
    installationId: requestContext.installationId,
    warehouseIds: scopedWarehouses,
    status,
    salesOrderId,
    limit: Math.min(Math.max(Number(limit) || 200, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0),
  });
  return Object.freeze({ ok: true, deliveryOrders: Object.freeze(rows.map((row) => mapDeliveryOrder(row))) });
}

export async function getDeliveryOrder(client, { requestContext, deliveryOrderId }) {
  if (!hasPermission(requestContext, 'core.delivery-order.read')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-order.read is required');
  }
  const identityError = validateUuid(deliveryOrderId, 'deliveryOrderId');
  if (identityError) return identityError;
  return loadDetail(client, { requestContext, deliveryOrderId });
}

function validateCreatePayload(payload) {
  if (!Array.isArray(payload?.lines) || payload.lines.length < 1 || payload.lines.length > 10000) {
    return failure('DELIVERY_ORDER_LINES_REQUIRED', 'Delivery Order requires 1-10000 packed allocation lines');
  }
  const seen = new Set();
  const lines = [];
  for (let index = 0; index < payload.lines.length; index += 1) {
    const input = payload.lines[index] ?? {};
    if (!UUID_PATTERN.test(input.fulfillmentAllocationId ?? '')) {
      return failure('INVALID_FULFILLMENT_ALLOCATION_ID', 'Fulfillment allocation ID is invalid', false, { line: index + 1 });
    }
    if (seen.has(input.fulfillmentAllocationId)) {
      return failure('DUPLICATE_FULFILLMENT_ALLOCATION', 'Each allocation may appear once per Delivery Order', false, { line: index + 1 });
    }
    seen.add(input.fulfillmentAllocationId);
    const quantity = parseQuantity(input.quantity);
    if (quantity === null || quantity <= 0n) {
      return failure('INVALID_DELIVERY_QUANTITY', 'Delivery quantity must be a positive decimal string', false, { line: index + 1 });
    }
    lines.push(Object.freeze({
      fulfillmentAllocationId: input.fulfillmentAllocationId,
      quantity,
    }));
  }
  const note = String(payload?.note ?? '').trim();
  if (note.length > 4000) return failure('INVALID_NOTE', 'Note must not exceed 4000 characters');
  return Object.freeze({ ok: true, lines: Object.freeze(lines), note: note || null });
}

export async function executeCreateDeliveryOrder({
  adapter,
  requestContext,
  idempotencyKey,
  payload,
}) {
  if (!hasPermission(requestContext, 'core.delivery-order.create')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-order.create is required');
  }
  const validated = validateCreatePayload(payload);
  if (!validated.ok) return validated;
  const canonicalPayload = Object.freeze({
    lines: validated.lines.map((line) => ({
      fulfillmentAllocationId: line.fulfillmentAllocationId,
      quantity: formatQuantity(line.quantity),
    })),
    note: validated.note,
  });
  const hash = payloadHash(canonicalPayload);

  try {
    const transaction = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        await repository.setDeliveryOrderWriteContext(client);
        await repository.lockOperationKey(client, {
          installationId: requestContext.installationId,
          operation: 'create',
          idempotencyKey,
        });

        const replay = await repository.getDeliveryOrderByCreateKey(client, {
          installationId: requestContext.installationId,
          idempotencyKey,
        });
        if (replay) {
          if (replay.create_payload_hash !== hash) {
            return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another Delivery Order payload') };
          }
          const detail = await loadDetail(client, {
            requestContext,
            deliveryOrderId: replay.id,
          });
          if (!detail.ok) return { failed: detail };
          return Object.freeze({ ok: true, replayed: true, deliveryOrder: detail.deliveryOrder });
        }

        const loaded = [];
        for (const line of validated.lines) {
          const allocation = await repository.getEligibleAllocationForUpdate(client, {
            installationId: requestContext.installationId,
            allocationId: line.fulfillmentAllocationId,
          });
          if (!allocation
            || allocation.sales_order_status !== 'confirmed'
            || allocation.version_status !== 'confirmed'
            || allocation.demand_state !== 'ACTIVE') {
            return { failed: failure('PACKED_ALLOCATION_NOT_ELIGIBLE', 'Packed allocation is not eligible for Delivery Order') };
          }
          if (!warehouseAllowed(requestContext, allocation.warehouse_id)) {
            return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Packed allocation is outside the authorized warehouse scope') };
          }
          const available = parseQuantity(allocation.available_for_delivery_order_base_quantity);
          if (available === null || line.quantity > available) {
            return { failed: failure(
              'DELIVERY_ORDER_QUANTITY_CONFLICT',
              'Requested quantity exceeds packed quantity not yet claimed',
              true,
              { fulfillmentAllocationId: line.fulfillmentAllocationId },
            ) };
          }
          loaded.push(Object.freeze({ input: line, allocation }));
        }

        const first = loaded[0].allocation;
        if (loaded.some(({ allocation }) => (
          allocation.sales_order_id !== first.sales_order_id
          || allocation.sales_order_version_id !== first.sales_order_version_id
          || allocation.warehouse_id !== first.warehouse_id
          || allocation.customer_id !== first.customer_id
          || allocation.delivery_mode !== first.delivery_mode
        ))) {
          return { failed: failure(
            'DELIVERY_ORDER_MIXED_SOURCE_FORBIDDEN',
            'One Delivery Order must belong to one Sales Order version, warehouse, customer and handover mode',
          ) };
        }

        const deliveryOrderId = randomUUID();
        const destinationSnapshot = first.delivery_mode === 'DELIVERY'
          ? first.customer_address_snapshot ?? Object.freeze({})
          : Object.freeze({
              type: 'PICKUP',
              warehouseId: first.warehouse_id,
              warehouseCode: first.warehouse_code_snapshot,
              warehouseName: first.warehouse_name_snapshot,
            });
        await repository.insertDeliveryOrder(client, {
          id: deliveryOrderId,
          installationId: requestContext.installationId,
          salesOrderId: first.sales_order_id,
          salesOrderVersionId: first.sales_order_version_id,
          customerId: first.customer_id,
          customerAddressId: first.delivery_mode === 'DELIVERY' ? first.customer_address_id : null,
          warehouseId: first.warehouse_id,
          handoverMode: first.delivery_mode,
          customerCode: first.customer_code_snapshot,
          customerName: first.customer_name_snapshot,
          destinationSnapshot,
          warehouseCode: first.warehouse_code_snapshot,
          warehouseName: first.warehouse_name_snapshot,
          requestedDeliveryDate: first.requested_delivery_date,
          collectionPolicy: first.collection_policy,
          note: validated.note,
          idempotencyKey,
          payloadHash: hash,
          actorId: requestContext.actorId,
        });

        for (let index = 0; index < loaded.length; index += 1) {
          const { input, allocation } = loaded[index];
          await repository.insertDeliveryOrderLine(client, {
            id: randomUUID(),
            installationId: requestContext.installationId,
            deliveryOrderId,
            lineNumber: index + 1,
            salesOrderId: allocation.sales_order_id,
            salesOrderVersionId: allocation.sales_order_version_id,
            salesOrderLineId: allocation.sales_order_line_id,
            fulfillmentDemandId: allocation.fulfillment_demand_id,
            fulfillmentAllocationId: allocation.id,
            inventoryReservationId: allocation.inventory_reservation_id,
            warehouseId: allocation.warehouse_id,
            locationId: allocation.location_id,
            baseVariantId: allocation.base_variant_id,
            lotId: allocation.lot_id,
            sku: allocation.sku_snapshot,
            itemName: allocation.item_name_snapshot,
            unitCode: allocation.unit_code_snapshot,
            packedBaseQuantity: String(allocation.packed_base_quantity),
            deliveryBaseQuantity: formatQuantity(input.quantity),
            actorId: requestContext.actorId,
          });
        }

        const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
        await repository.insertDeliveryOrderEvent(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
          eventType: 'CREATED',
          idempotencyKey,
          payloadHash: hash,
          actorId: requestContext.actorId,
          requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp,
          metadata: { salesOrderId: first.sales_order_id, lineCount: loaded.length },
          occurredAt,
        });
        await repository.refreshSalesOrderDeliveryStatus(client, {
          installationId: requestContext.installationId,
          salesOrderId: first.sales_order_id,
          actorId: requestContext.actorId,
        });

        const detail = await loadDetail(client, { requestContext, deliveryOrderId });
        if (!detail.ok) return { failed: detail };
        const audit = buildAuditRecord({
          requestContext,
          action: 'sales.delivery_order.create',
          resourceType: 'delivery_order',
          resourceId: deliveryOrderId,
          afterData: detail.deliveryOrder,
          metadata: { salesOrderId: first.sales_order_id, warehouseId: first.warehouse_id },
        });
        const event = buildOutboxEvent({
          requestContext,
          aggregateType: 'sales.delivery_order',
          aggregateId: deliveryOrderId,
          eventType: 'core.sales.delivery_order.created',
          eventVersion: 1,
          payload: detail.deliveryOrder,
          metadata: { salesOrderId: first.sales_order_id, warehouseId: first.warehouse_id },
        });
        await insertAuditRecord(client, audit);
        await insertOutboxEvent(client, event);
        return Object.freeze({
          ok: true,
          replayed: false,
          deliveryOrder: detail.deliveryOrder,
          auditId: audit.auditId,
          eventId: event.eventId,
        });
      },
    });
    return transaction?.failed ?? transaction;
  } catch (error) {
    return knownDatabaseFailure(error) ?? failure(
      'DELIVERY_ORDER_TRANSACTION_FAILED',
      'Delivery Order transaction failed',
      true,
    );
  }
}

async function executeTransition({
  adapter,
  requestContext,
  deliveryOrderId,
  idempotencyKey,
  payload,
  permission,
  operation,
  eventType,
  action,
  outboxType,
}) {
  if (!hasPermission(requestContext, permission)) {
    return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  }
  const identityError = validateUuid(deliveryOrderId, 'deliveryOrderId');
  if (identityError) return identityError;
  const reason = operation === 'cancel' ? String(payload?.reason ?? '').trim() : null;
  if (operation === 'cancel' && (!reason || reason.length > 1000)) {
    return failure('CANCELLATION_REASON_REQUIRED', 'Cancellation reason is required');
  }
  const operationPayload = Object.freeze({ deliveryOrderId, operation, reason });
  const hash = payloadHash(operationPayload);

  try {
    const transaction = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        await repository.setDeliveryOrderWriteContext(client);
        await repository.lockOperationKey(client, {
          installationId: requestContext.installationId,
          operation,
          idempotencyKey,
        });
        const replayEvent = await repository.getDeliveryOrderEventByKey(client, {
          installationId: requestContext.installationId,
          idempotencyKey,
        });
        if (replayEvent) {
          if (replayEvent.payload_hash !== hash
            || replayEvent.delivery_order_id !== deliveryOrderId
            || replayEvent.event_type !== eventType) {
            return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another Delivery Order transition') };
          }
          const detail = await loadDetail(client, { requestContext, deliveryOrderId });
          if (!detail.ok) return { failed: detail };
          return Object.freeze({ ok: true, replayed: true, deliveryOrder: detail.deliveryOrder });
        }

        const header = await repository.getDeliveryOrderForUpdate(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
          forUpdate: true,
        });
        if (!header) return { failed: failure('DELIVERY_ORDER_NOT_FOUND', 'Delivery Order was not found') };
        if (!warehouseAllowed(requestContext, header.warehouse_id)) {
          return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Delivery Order is outside the authorized warehouse scope') };
        }
        if (header.sales_order_status !== 'confirmed') {
          return { failed: failure('SALES_ORDER_NOT_CONFIRMED', 'Source Sales Order is not confirmed') };
        }
        if (header.status !== 'draft') {
          return { failed: failure('INVALID_STATUS_TRANSITION', 'Only a draft Delivery Order can be transitioned') };
        }
        const before = await loadDetail(client, { requestContext, deliveryOrderId });
        if (!before.ok) return { failed: before };
        if (!before.deliveryOrder.lines?.length) {
          return { failed: failure('EMPTY_DELIVERY_ORDER', 'Delivery Order must contain at least one line') };
        }

        let updated;
        if (operation === 'confirm') {
          const series = await ensureDeliveryOrderSeries(client, {
            installationId: requestContext.installationId,
            actorId: requestContext.actorId,
          });
          if (!series) {
            return { failed: failure('DOCUMENT_NUMBER_SERIES_UNAVAILABLE', 'Delivery Order number series is unavailable', true) };
          }
          const documentDate = timestampDateOnly(header.created_at, series.timezone_name);
          if (!documentDate) return { failed: failure('INVALID_DOCUMENT_DATE', 'Delivery Order creation date is invalid') };
          const allocation = await allocateDocumentNumber(client, {
            installationId: requestContext.installationId,
            seriesId: series.id,
            idempotencyKey: `delivery-order:${deliveryOrderId}:confirm:${idempotencyKey}`,
            payload: { documentDate, metadata: { deliveryOrderId, salesOrderId: header.sales_order_id } },
            actorId: requestContext.actorId,
            requestId: requestContext.requestId,
            sourceApp: requestContext.sourceApp,
          });
          if (!allocation.ok) return { failed: allocation };
          updated = await repository.confirmDeliveryOrder(client, {
            installationId: requestContext.installationId,
            deliveryOrderId,
            deliveryOrderNumber: allocation.allocation.document_number,
            allocationId: allocation.allocation.id,
            actorId: requestContext.actorId,
          });
        } else {
          updated = await repository.cancelDeliveryOrder(client, {
            installationId: requestContext.installationId,
            deliveryOrderId,
            reason,
            actorId: requestContext.actorId,
          });
        }
        if (!updated) return { failed: failure('DELIVERY_ORDER_TRANSITION_CONFLICT', 'Delivery Order changed concurrently', true) };

        const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
        await repository.insertDeliveryOrderEvent(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
          eventType,
          idempotencyKey,
          payloadHash: hash,
          actorId: requestContext.actorId,
          requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp,
          reason,
          metadata: { salesOrderId: header.sales_order_id },
          occurredAt,
        });
        await repository.refreshSalesOrderDeliveryStatus(client, {
          installationId: requestContext.installationId,
          salesOrderId: header.sales_order_id,
          actorId: requestContext.actorId,
        });
        const after = await loadDetail(client, { requestContext, deliveryOrderId });
        if (!after.ok) return { failed: after };
        const audit = buildAuditRecord({
          requestContext,
          action,
          resourceType: 'delivery_order',
          resourceId: deliveryOrderId,
          beforeData: before.deliveryOrder,
          afterData: after.deliveryOrder,
          metadata: { salesOrderId: header.sales_order_id, warehouseId: header.warehouse_id },
        });
        const event = buildOutboxEvent({
          requestContext,
          aggregateType: 'sales.delivery_order',
          aggregateId: deliveryOrderId,
          eventType: outboxType,
          eventVersion: Number(after.deliveryOrder.revision),
          payload: after.deliveryOrder,
          metadata: { salesOrderId: header.sales_order_id, warehouseId: header.warehouse_id },
        });
        await insertAuditRecord(client, audit);
        await insertOutboxEvent(client, event);
        return Object.freeze({
          ok: true,
          replayed: false,
          deliveryOrder: after.deliveryOrder,
          auditId: audit.auditId,
          eventId: event.eventId,
        });
      },
    });
    return transaction?.failed ?? transaction;
  } catch (error) {
    return knownDatabaseFailure(error) ?? failure(
      'DELIVERY_ORDER_TRANSACTION_FAILED',
      'Delivery Order transaction failed',
      true,
    );
  }
}

export function executeConfirmDeliveryOrder(args) {
  return executeTransition({
    ...args,
    permission: 'core.delivery-order.confirm',
    operation: 'confirm',
    eventType: 'CONFIRMED',
    action: 'sales.delivery_order.confirm',
    outboxType: 'core.sales.delivery_order.ready_to_dispatch',
  });
}

export function executeCancelDeliveryOrder(args) {
  return executeTransition({
    ...args,
    permission: 'core.delivery-order.cancel',
    operation: 'cancel',
    eventType: 'CANCELLED',
    action: 'sales.delivery_order.cancel',
    outboxType: 'core.sales.delivery_order.cancelled',
  });
}

export const deliveryOrderInternals = Object.freeze({
  parseQuantity,
  formatQuantity,
  payloadHash,
  mapEligibility,
  mapDeliveryOrder,
  mapLine,
});