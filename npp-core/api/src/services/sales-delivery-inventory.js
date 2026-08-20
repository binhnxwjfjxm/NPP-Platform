import { createHash, randomUUID } from 'node:crypto';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import { deriveIdempotencyKey } from '../idempotency-derived.js';
import * as documentNumberRepository from '../db/repositories/document-numbering.js';
import * as deliveryOrderRepository from '../db/repositories/sales-delivery-orders.js';
import * as repository from '../db/repositories/sales-delivery-inventory.js';
import { allocateDocumentNumber } from './document-numbering.js';
import { reverseInventoryMovement } from './inventory-ledger.js';
import { postServerOwnedSalesMovement } from './sales-inventory-ledger.js';
import { postReceivableFromPickupHandover } from './customer-receivable.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const CODE_PATTERN = /^[A-Z0-9_.-]{1,64}$/;
const SCALE = 1_000_000_000_000n;
const CUSTOMER_RETURN_SERIES_CODE = 'CUSTOMER_RETURN';
const RETURN_STATUSES = new Set(['draft', 'received', 'cancelled']);

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
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / SCALE}.${String(absolute % SCALE).padStart(12, '0')}`;
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (maxLength > 0 && normalized.length > maxLength)) return null;
  return normalized;
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

function warehouseIdSet(requestContext) {
  return new Set(Array.isArray(requestContext?.scopes?.warehouseIds)
    ? requestContext.scopes.warehouseIds.filter((id) => UUID_PATTERN.test(id))
    : []);
}

function warehouseAllowed(requestContext, warehouseId) {
  return warehouseIdSet(requestContext).has(warehouseId);
}

function validateIdempotencyKey(value) {
  return IDEMPOTENCY_KEY_PATTERN.test(String(value ?? ''))
    ? null
    : failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must use 1-128 safe characters');
}

function validateUuid(value, field) {
  return UUID_PATTERN.test(String(value ?? ''))
    ? null
    : failure('INVALID_IDENTITY', `${field} is invalid`, false, { field });
}

function strictDate(value) {
  const normalized = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3])
    ? normalized
    : null;
}

function strictTimestamp(value) {
  const normalized = text(value, 64);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function timestampDateOnly(value, timeZone = 'Asia/Ho_Chi_Minh') {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
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
}

function mapIssueLine(row) {
  return Object.freeze({
    id: row.id,
    deliveryOrderLineId: row.delivery_order_line_id,
    salesOrderId: row.sales_order_id,
    salesOrderLineId: row.sales_order_line_id,
    fulfillmentDemandId: row.fulfillment_demand_id,
    fulfillmentAllocationId: row.fulfillment_allocation_id,
    inventoryReservationId: row.inventory_reservation_id,
    inventoryMovementLineId: row.inventory_movement_line_id ?? null,
    warehouseId: row.warehouse_id,
    locationId: row.location_id ?? null,
    locationCode: row.location_code ?? null,
    locationName: row.location_name ?? null,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id ?? null,
    lotCode: row.lot_code ?? null,
    expiryDate: row.expiry_date ? String(row.expiry_date).slice(0, 10) : null,
    sku: row.sku_snapshot,
    itemName: row.item_name_snapshot,
    unitCode: row.unit_code_snapshot,
    issuedBaseQuantity: String(row.issued_base_quantity),
  });
}

function mapIssue(row, lines = undefined) {
  return Object.freeze({
    id: row.id,
    deliveryOrderId: row.delivery_order_id,
    deliveryOrderNumber: row.delivery_order_number ?? null,
    salesOrderId: row.sales_order_id,
    customerId: row.customer_id,
    warehouseId: row.warehouse_id,
    handoverMode: row.handover_mode,
    deliveryOrderStatus: row.delivery_order_status,
    issueSourceType: row.issue_source_type,
    issueSourceId: row.issue_source_id,
    status: row.status,
    inventoryMovementId: row.inventory_movement_id ?? null,
    inventoryReversalMovementId: row.inventory_reversal_movement_id ?? null,
    receiverName: row.receiver_name ?? null,
    receiverNote: row.receiver_note ?? null,
    postedAt: row.posted_at ?? null,
    postedBy: row.posted_by ?? null,
    reversedAt: row.reversed_at ?? null,
    reversedBy: row.reversed_by ?? null,
    reversalReason: row.reversal_reason ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    lines,
  });
}

async function loadIssueDetail(client, { requestContext, issueId }) {
  const issue = await repository.getIssueById(client, {
    installationId: requestContext.installationId,
    issueId,
  });
  if (!issue) return failure('DELIVERY_INVENTORY_ISSUE_NOT_FOUND', 'Delivery inventory issue was not found');
  if (!warehouseAllowed(requestContext, issue.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Delivery inventory issue is outside the current warehouse scope');
  }
  const lines = await repository.listIssueLines(client, {
    installationId: requestContext.installationId,
    issueId,
  });
  return Object.freeze({ ok: true, issue: mapIssue(issue, Object.freeze(lines.map(mapIssueLine))) });
}

function knownDatabaseFailure(error) {
  const message = String(error?.message ?? '');
  const mappings = [
    ['delivery_order_inventory_issues_one_active_idx', 'DELIVERY_ORDER_ALREADY_ISSUED', 'Delivery Order already has an active inventory issue'],
    ['delivery_issue_exceeds_delivery_order_line', 'DELIVERY_ISSUE_QUANTITY_CONFLICT', 'Inventory issue exceeds the Delivery Order line quantity'],
    ['inventory_reservation_issue_exceeds_remaining', 'RESERVATION_QUANTITY_CONFLICT', 'Exact reservation does not have enough remaining quantity'],
    ['inventory_reservation_balance_mismatch', 'RESERVATION_BALANCE_CONFLICT', 'Reservation and inventory balance are inconsistent'],
    ['inventory_negative_stock_denied', 'INSUFFICIENT_INVENTORY', 'Inventory is insufficient for this issue'],
    ['customer_return_quantity_exceeds_issued', 'CUSTOMER_RETURN_QUANTITY_CONFLICT', 'Customer return exceeds the remaining issued quantity'],
    ['customer_return_origin_mismatch', 'CUSTOMER_RETURN_ORIGIN_MISMATCH', 'Customer return source lineage is invalid'],
    [
      'customer_return_exceeds_posted_receivable_quantity',
      'CUSTOMER_RETURN_RECEIVABLE_NOT_POSTED',
      'Chưa thể nhận hàng khách trả vì phiếu giao chưa phát sinh công nợ. Nếu khách chưa nhận hàng, hãy nhập hàng về tại Đối soát cuối chuyến.',
    ],
    ['receivable_documents_source_unique', 'RECEIVABLE_SOURCE_CONFLICT', 'Pickup handover already has a receivable document'],
    ['receivable_ledger_entries_source_type_unique', 'RECEIVABLE_SOURCE_CONFLICT', 'Pickup handover already has a receivable ledger entry'],
  ];
  for (const [needle, code, publicMessage] of mappings) {
    if (message.includes(needle)) return failure(code, publicMessage, code.endsWith('CONFLICT'));
  }
  return null;
}

async function ensureCustomerReturnSeries(client, { installationId, actorId }) {
  let series = await documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: CUSTOMER_RETURN_SERIES_CODE,
  });
  if (series) return series;
  series = await documentNumberRepository.insertDocumentNumberSeries(client, {
    installationId,
    code: CUSTOMER_RETURN_SERIES_CODE,
    documentType: 'CUSTOMER_RETURN',
    name: 'Phiếu hàng khách trả',
    prefix: 'CR-',
    numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
    resetPolicy: 'MONTHLY',
    sequenceWidth: 6,
    startCounter: '1',
    timezoneName: 'Asia/Ho_Chi_Minh',
    description: 'Số phiếu hàng khách trả đã nhận vào kho.',
    isActive: true,
    createdBy: actorId,
  });
  return series ?? documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: CUSTOMER_RETURN_SERIES_CODE,
  });
}

async function executeIssue({
  adapter,
  requestContext,
  deliveryOrderId,
  idempotencyKey,
  issueSourceType,
  issueSourceId,
  occurredAt,
  receiverName = null,
  receiverNote = null,
  requiredMode,
  permission,
}) {
  if (!hasPermission(requestContext, permission)) {
    return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  }
  const identityError = validateUuid(deliveryOrderId, 'deliveryOrderId');
  if (identityError) return identityError;
  const idempotencyError = validateIdempotencyKey(idempotencyKey);
  if (idempotencyError) return idempotencyError;
  const normalizedOccurredAt = strictTimestamp(occurredAt);
  if (!normalizedOccurredAt) return failure('INVALID_HANDOVER_TIME', 'Physical handover/dispatch time is invalid');
  const sourceId = text(issueSourceId, 160);
  if (!sourceId) return failure('INVALID_ISSUE_SOURCE', 'Inventory issue source is required');
  const canonicalPayload = Object.freeze({
    deliveryOrderId,
    issueSourceType,
    issueSourceId: sourceId,
    occurredAt: normalizedOccurredAt,
    receiverName,
    receiverNote,
  });
  const hash = payloadHash(canonicalPayload);

  try {
    const transaction = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        let receivablePosted = false;
        await repository.setDeliveryIssueWriteContext(client);
        await repository.lockOperationKey(client, {
          installationId: requestContext.installationId,
          operation: 'issue',
          idempotencyKey,
        });
        const replay = await repository.getIssueByIdempotencyKey(client, {
          installationId: requestContext.installationId,
          idempotencyKey,
        });
        if (replay) {
          if (replay.payload_hash !== hash || replay.delivery_order_id !== deliveryOrderId) {
            return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Issue key was used with another payload') };
          }
          const detail = await loadIssueDetail(client, { requestContext, issueId: replay.id });
          if (!detail.ok) return { failed: detail };
          return Object.freeze({ ok: true, replayed: true, issue: detail.issue });
        }

        const header = await repository.getDeliveryOrderIssueSource(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
          forUpdate: true,
        });
        if (!header) return { failed: failure('DELIVERY_ORDER_NOT_FOUND', 'Delivery Order was not found') };
        if (!warehouseAllowed(requestContext, header.warehouse_id)) {
          return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Delivery Order is outside the current warehouse scope') };
        }
        if (header.status !== 'ready_to_dispatch' || header.sales_order_status !== 'confirmed') {
          return { failed: failure('DELIVERY_ORDER_NOT_READY', 'Delivery Order is not ready for physical issue') };
        }
        if (header.handover_mode !== requiredMode || header.sales_order_delivery_mode !== requiredMode) {
          return { failed: failure('DELIVERY_ORDER_MODE_MISMATCH', 'Delivery Order handover mode does not match this transition') };
        }
        if (!header.delivery_order_number) {
          return { failed: failure('DELIVERY_ORDER_NUMBER_REQUIRED', 'Delivery Order must have an official number') };
        }
        if (await repository.getActiveIssueForDeliveryOrder(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
          forUpdate: true,
        })) {
          return { failed: failure('DELIVERY_ORDER_ALREADY_ISSUED', 'Delivery Order already has an active inventory issue') };
        }

        const sourceLines = await repository.listDeliveryOrderIssueSourceLines(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
        });
        if (sourceLines.length === 0) return { failed: failure('DELIVERY_ORDER_LINES_REQUIRED', 'Delivery Order has no source lines') };
        for (const line of sourceLines) {
          const quantity = parseQuantity(line.delivery_base_quantity);
          const reservationQuantity = parseQuantity(line.reservation_quantity);
          const consumedQuantity = parseQuantity(line.reservation_consumed_quantity);
          if (quantity === null || reservationQuantity === null || consumedQuantity === null
            || quantity <= 0n || consumedQuantity + quantity > reservationQuantity
            || !['ACTIVE', 'CONSUMED'].includes(line.reservation_state)
            || line.demand_state !== 'ACTIVE') {
            return { failed: failure(
              'DELIVERY_ORDER_LINE_NOT_ISSUABLE',
              'One or more Delivery Order lines no longer have valid packed reservation quantity',
              true,
              { deliveryOrderLineId: line.id },
            ) };
          }
        }

        const issueId = randomUUID();
        await repository.insertIssue(client, {
          id: issueId,
          installationId: requestContext.installationId,
          deliveryOrderId,
          issueSourceType,
          issueSourceId: sourceId,
          receiverName,
          receiverNote,
          idempotencyKey,
          payloadHash: hash,
          actorId: requestContext.actorId,
        });

        const issueLines = [];
        for (let index = 0; index < sourceLines.length; index += 1) {
          const source = sourceLines[index];
          const issueLineId = randomUUID();
          const quantity = String(source.delivery_base_quantity);
          const issueLine = await repository.insertIssueLine(client, {
            id: issueLineId,
            installationId: requestContext.installationId,
            issueId,
            deliveryOrderId,
            deliveryOrderLineId: source.id,
            fulfillmentDemandId: source.fulfillment_demand_id,
            fulfillmentAllocationId: source.fulfillment_allocation_id,
            inventoryReservationId: source.inventory_reservation_id,
            warehouseId: source.warehouse_id,
            locationId: source.location_id,
            baseVariantId: source.base_variant_id,
            lotId: source.lot_id,
            quantity,
            actorId: requestContext.actorId,
          });
          issueLines.push(Object.freeze({ issueLine, source }));
          const adjustmentPayload = {
            adjustmentType: 'CONSUME',
            reservationId: source.inventory_reservation_id,
            quantity,
            deliveryOrderId,
            deliveryOrderLineId: source.id,
            issueId,
            issueLineId,
          };
          await repository.insertReservationAdjustment(client, {
            installationId: requestContext.installationId,
            reservationId: source.inventory_reservation_id,
            adjustmentType: 'CONSUME',
            quantity,
            sourceDocumentType: 'DELIVERY_ORDER',
            sourceDocumentId: deliveryOrderId,
            sourceLineId: issueLineId,
            idempotencyKey: deriveIdempotencyKey(`delivery-issue-consume-${index + 1}`, idempotencyKey),
            payloadHash: payloadHash(adjustmentPayload),
            actorId: requestContext.actorId,
            requestId: requestContext.requestId,
            sourceApp: requestContext.sourceApp,
            metadata: adjustmentPayload,
            occurredAt: normalizedOccurredAt,
          });
        }

        const documentDate = timestampDateOnly(normalizedOccurredAt);
        const movementResult = await postServerOwnedSalesMovement(client, {
          requestContext,
          idempotencyKey: deriveIdempotencyKey('delivery-issue-movement', idempotencyKey),
          payload: {
            movementType: 'SALES_DELIVERY_ISSUE',
            direction: 'OUT',
            sourceDocumentType: 'DELIVERY_ORDER',
            sourceDocumentId: deliveryOrderId,
            sourceDocumentNumber: header.delivery_order_number,
            documentDate,
            reasonCode: issueSourceType === 'PICKUP_HANDOVER' ? 'PICKUP_HANDOVER' : 'DELIVERY_DISPATCH',
            reasonNote: issueSourceType === 'PICKUP_HANDOVER'
              ? `Bàn giao tại quầy cho ${receiverName}`
              : `Xuất kho theo nguồn điều phối ${sourceId}`,
            metadata: { deliveryOrderId, salesOrderId: header.sales_order_id, issueId, issueSourceType, issueSourceId: sourceId },
            lines: issueLines.map(({ issueLine, source }) => ({
              sourceLineId: issueLine.id,
              warehouseId: source.warehouse_id,
              locationId: source.location_id,
              baseVariantId: source.base_variant_id,
              baseSku: source.base_sku,
              baseUnitId: source.base_unit_id,
              baseUnitCode: source.base_unit_code,
              lotId: source.lot_id,
              lotCode: source.lot_code,
              expiryDate: source.expiry_date,
              quantity: String(source.delivery_base_quantity),
              metadata: {
                issueId,
                issueLineId: issueLine.id,
                deliveryOrderId,
                deliveryOrderLineId: source.id,
                salesOrderId: source.sales_order_id,
                salesOrderLineId: source.sales_order_line_id,
                fulfillmentDemandId: source.fulfillment_demand_id,
                fulfillmentAllocationId: source.fulfillment_allocation_id,
                inventoryReservationId: source.inventory_reservation_id,
              },
            })),
          },
        });
        if (!movementResult.ok) return { failed: movementResult };
        if (movementResult.lines.length !== issueLines.length) {
          return { failed: failure('INVENTORY_MOVEMENT_LINE_MISMATCH', 'Inventory movement line count is invalid') };
        }
        for (let index = 0; index < issueLines.length; index += 1) {
          await repository.attachMovementLineToIssueLine(client, {
            installationId: requestContext.installationId,
            issueLineId: issueLines[index].issueLine.id,
            movementLineId: movementResult.lines[index].id,
          });
        }
        const finalized = await repository.finalizeIssue(client, {
          installationId: requestContext.installationId,
          issueId,
          movementId: movementResult.movement.id,
          actorId: requestContext.actorId,
          postedAt: normalizedOccurredAt,
        });
        if (!finalized) return { failed: failure('DELIVERY_ISSUE_CONFLICT', 'Delivery issue changed concurrently', true) };
        const nextStatus = issueSourceType === 'PICKUP_HANDOVER' ? 'handed_over' : 'dispatched';
        if (!await repository.updateDeliveryOrderIssueStatus(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
          status: nextStatus,
          actorId: requestContext.actorId,
        })) return { failed: failure('DELIVERY_ORDER_TRANSITION_CONFLICT', 'Delivery Order changed concurrently', true) };

        const demandIds = [...new Set(sourceLines.map((line) => line.fulfillment_demand_id))];
        await repository.refreshFulfillmentIssuedProjection(client, {
          installationId: requestContext.installationId,
          demandIds,
          actorId: requestContext.actorId,
        });
        await repository.refreshSalesOrderFulfillmentStatus(client, {
          installationId: requestContext.installationId,
          salesOrderId: header.sales_order_id,
          actorId: requestContext.actorId,
        });
        await repository.refreshSalesOrderDeliveryStatus(client, {
          installationId: requestContext.installationId,
          salesOrderId: header.sales_order_id,
          actorId: requestContext.actorId,
        });
        if (issueSourceType === 'PICKUP_HANDOVER') {
          const receivableResult = await postReceivableFromPickupHandover(client, {
            requestContext,
            issueId,
          });
          if (!receivableResult.ok) return { failed: receivableResult };
          receivablePosted = Boolean(receivableResult.receivableDocument);
        }
        const eventType = issueSourceType === 'PICKUP_HANDOVER' ? 'PICKUP_HANDED_OVER' : 'INVENTORY_ISSUED';
        await deliveryOrderRepository.insertDeliveryOrderEvent(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
          eventType,
          idempotencyKey,
          payloadHash: hash,
          actorId: requestContext.actorId,
          requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp,
          metadata: { issueId, inventoryMovementId: movementResult.movement.id, issueSourceType, issueSourceId: sourceId },
          occurredAt: normalizedOccurredAt,
        });
        const detail = await loadIssueDetail(client, { requestContext, issueId });
        if (!detail.ok) return { failed: detail };
        const action = issueSourceType === 'PICKUP_HANDOVER'
          ? 'sales.delivery_order.pickup_handover'
          : 'sales.delivery_order.inventory_issue';
        const outboxType = issueSourceType === 'PICKUP_HANDOVER'
          ? 'core.sales.delivery_order.pickup_handed_over'
          : 'core.sales.delivery_order.inventory_issued';
        const audit = buildAuditRecord({
          requestContext,
          action,
          resourceType: 'delivery_order_inventory_issue',
          resourceId: issueId,
          afterData: detail.issue,
          metadata: { deliveryOrderId, inventoryMovementId: movementResult.movement.id, warehouseId: header.warehouse_id },
        });
        const event = buildOutboxEvent({
          requestContext,
          aggregateType: 'sales.delivery_order',
          aggregateId: deliveryOrderId,
          eventType: outboxType,
          eventVersion: 1,
          payload: detail.issue,
          metadata: { inventoryMovementId: movementResult.movement.id, warehouseId: header.warehouse_id },
        });
        await insertAuditRecord(client, audit);
        await insertOutboxEvent(client, event);
        return Object.freeze({
          ok: true,
          replayed: false,
          issue: detail.issue,
          auditId: audit.auditId,
          eventId: event.eventId,
          expectedAuditCount: receivablePosted ? 2 : 1,
          expectedOutboxCount: receivablePosted ? 2 : 1,
        });
      },
    });
    return transaction?.failed ?? transaction;
  } catch (error) {
    return knownDatabaseFailure(error) ?? failure('DELIVERY_INVENTORY_ISSUE_FAILED', 'Delivery inventory issue transaction failed', true);
  }
}

export function executePickupHandover({ adapter, requestContext, deliveryOrderId, idempotencyKey, payload }) {
  const receiverName = text(payload?.receiverName, 256);
  const receiverNote = text(payload?.receiverNote, 2000);
  if (!receiverName) return Promise.resolve(failure('RECEIVER_NAME_REQUIRED', 'Receiver name is required for pickup handover'));
  return executeIssue({
    adapter,
    requestContext,
    deliveryOrderId,
    idempotencyKey,
    issueSourceType: 'PICKUP_HANDOVER',
    issueSourceId: `pickup:${deliveryOrderId}`,
    occurredAt: payload?.handedOverAt,
    receiverName,
    receiverNote,
    requiredMode: 'PICKUP',
    permission: 'core.delivery-order.pickup-handover',
  });
}

// Internal capability for Phase 6E. No HTTP route is exposed by Phase 6D.4.
export function executeDeliveryDispatchInventoryIssue({
  adapter,
  requestContext,
  deliveryOrderId,
  idempotencyKey,
  dispatchSource,
}) {
  const sourceId = text(dispatchSource?.dispatchId, 160);
  if (dispatchSource?.sourceType !== 'DELIVERY_TRIP_DISPATCH' || !sourceId) {
    return Promise.resolve(failure('TRUSTED_LOGISTICS_SOURCE_REQUIRED', 'A server-owned logistics dispatch source is required'));
  }
  return executeIssue({
    adapter,
    requestContext,
    deliveryOrderId,
    idempotencyKey,
    issueSourceType: 'LOGISTICS_DISPATCH',
    issueSourceId: sourceId,
    occurredAt: dispatchSource.dispatchedAt,
    requiredMode: 'DELIVERY',
    permission: 'core.delivery-order.issue-inventory',
  });
}

export async function executeReverseDeliveryInventoryIssue({
  adapter,
  requestContext,
  deliveryOrderId,
  idempotencyKey,
  payload,
}) {
  const permission = 'core.delivery-order.reverse-inventory-issue';
  if (!hasPermission(requestContext, permission)) return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  const identityError = validateUuid(deliveryOrderId, 'deliveryOrderId');
  if (identityError) return identityError;
  const idempotencyError = validateIdempotencyKey(idempotencyKey);
  if (idempotencyError) return idempotencyError;
  const documentDate = strictDate(payload?.documentDate);
  const reasonCode = String(payload?.reasonCode ?? '').trim().toUpperCase();
  const reasonNote = text(payload?.reasonNote, 2000);
  if (!documentDate || !CODE_PATTERN.test(reasonCode) || !reasonNote) {
    return failure('REVERSAL_REASON_REQUIRED', 'documentDate, reasonCode and reasonNote are required');
  }
  const canonicalPayload = Object.freeze({ deliveryOrderId, documentDate, reasonCode, reasonNote });
  const hash = payloadHash(canonicalPayload);

  try {
    const transaction = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        await repository.setDeliveryIssueWriteContext(client);
        await repository.lockOperationKey(client, {
          installationId: requestContext.installationId,
          operation: 'reverse',
          idempotencyKey,
        });
        const replayEvent = await deliveryOrderRepository.getDeliveryOrderEventByKey(client, {
          installationId: requestContext.installationId,
          idempotencyKey,
        });
        if (replayEvent) {
          if (replayEvent.payload_hash !== hash || replayEvent.delivery_order_id !== deliveryOrderId
            || replayEvent.event_type !== 'INVENTORY_ISSUE_REVERSED') {
            return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Reversal key was used with another payload') };
          }
          const replayIssueId = replayEvent.metadata?.issueId;
          const detail = await loadIssueDetail(client, { requestContext, issueId: replayIssueId });
          if (!detail.ok) return { failed: detail };
          return Object.freeze({ ok: true, replayed: true, issue: detail.issue });
        }
        const header = await repository.getDeliveryOrderIssueSource(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
          forUpdate: true,
        });
        if (!header) return { failed: failure('DELIVERY_ORDER_NOT_FOUND', 'Delivery Order was not found') };
        if (!warehouseAllowed(requestContext, header.warehouse_id)) {
          return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Delivery Order is outside the current warehouse scope') };
        }
        if (!['dispatched', 'handed_over'].includes(header.status)) {
          return { failed: failure('DELIVERY_ISSUE_REVERSAL_NOT_ALLOWED', 'Delivery Order does not have a reversible active issue') };
        }
        const issue = await repository.getActiveIssueForDeliveryOrder(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
          forUpdate: true,
        });
        if (!issue || issue.status !== 'POSTED' || !issue.inventory_movement_id) {
          return { failed: failure('DELIVERY_INVENTORY_ISSUE_NOT_FOUND', 'Active posted inventory issue was not found') };
        }
        if (await repository.hasBlockingCustomerReturn(client, {
          installationId: requestContext.installationId,
          issueId: issue.id,
        })) {
          return { failed: failure('DELIVERY_ISSUE_REVERSAL_BLOCKED', 'Customer Return already references this inventory issue') };
        }
        const before = await loadIssueDetail(client, { requestContext, issueId: issue.id });
        if (!before.ok) return { failed: before };
        const reversal = await reverseInventoryMovement(client, {
          requestContext,
          idempotencyKey: deriveIdempotencyKey('delivery-issue-reversal', idempotencyKey),
          movementId: issue.inventory_movement_id,
          payload: { documentDate, reasonCode, reasonNote },
        });
        if (!reversal.ok) return { failed: reversal };
        const issueLines = await repository.listIssueLines(client, {
          installationId: requestContext.installationId,
          issueId: issue.id,
        });
        for (let index = 0; index < issueLines.length; index += 1) {
          const line = issueLines[index];
          const adjustmentPayload = {
            adjustmentType: 'RESTORE',
            reservationId: line.inventory_reservation_id,
            quantity: String(line.issued_base_quantity),
            deliveryOrderId,
            deliveryOrderLineId: line.delivery_order_line_id,
            issueId: issue.id,
            issueLineId: line.id,
            reversalMovementId: reversal.movement.id,
          };
          await repository.insertReservationAdjustment(client, {
            installationId: requestContext.installationId,
            reservationId: line.inventory_reservation_id,
            adjustmentType: 'RESTORE',
            quantity: String(line.issued_base_quantity),
            sourceDocumentType: 'DELIVERY_ORDER_REVERSAL',
            sourceDocumentId: deliveryOrderId,
            sourceLineId: line.id,
            idempotencyKey: deriveIdempotencyKey(`delivery-issue-restore-${index + 1}`, idempotencyKey),
            payloadHash: payloadHash(adjustmentPayload),
            actorId: requestContext.actorId,
            requestId: requestContext.requestId,
            sourceApp: requestContext.sourceApp,
            metadata: adjustmentPayload,
            occurredAt: requestContext.receivedAt ?? new Date().toISOString(),
          });
        }
        const reversedAt = requestContext.receivedAt ?? new Date().toISOString();
        if (!await repository.reverseIssue(client, {
          installationId: requestContext.installationId,
          issueId: issue.id,
          reversalMovementId: reversal.movement.id,
          reason: reasonNote,
          actorId: requestContext.actorId,
          reversedAt,
        })) return { failed: failure('DELIVERY_ISSUE_REVERSAL_CONFLICT', 'Inventory issue changed concurrently', true) };
        if (!await repository.updateDeliveryOrderIssueStatus(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
          status: 'ready_to_dispatch',
          actorId: requestContext.actorId,
        })) return { failed: failure('DELIVERY_ORDER_TRANSITION_CONFLICT', 'Delivery Order changed concurrently', true) };
        const demandIds = [...new Set(issueLines.map((line) => line.fulfillment_demand_id))];
        await repository.refreshFulfillmentIssuedProjection(client, {
          installationId: requestContext.installationId,
          demandIds,
          actorId: requestContext.actorId,
        });
        await repository.refreshSalesOrderFulfillmentStatus(client, {
          installationId: requestContext.installationId,
          salesOrderId: header.sales_order_id,
          actorId: requestContext.actorId,
        });
        await repository.refreshSalesOrderDeliveryStatus(client, {
          installationId: requestContext.installationId,
          salesOrderId: header.sales_order_id,
          actorId: requestContext.actorId,
        });
        await deliveryOrderRepository.insertDeliveryOrderEvent(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
          eventType: 'INVENTORY_ISSUE_REVERSED',
          idempotencyKey,
          payloadHash: hash,
          actorId: requestContext.actorId,
          requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp,
          reason: reasonNote,
          metadata: { issueId: issue.id, inventoryMovementId: issue.inventory_movement_id, reversalMovementId: reversal.movement.id },
          occurredAt: reversedAt,
        });
        const after = await loadIssueDetail(client, { requestContext, issueId: issue.id });
        if (!after.ok) return { failed: after };
        const audit = buildAuditRecord({
          requestContext,
          action: 'sales.delivery_order.inventory_issue.reverse',
          resourceType: 'delivery_order_inventory_issue',
          resourceId: issue.id,
          beforeData: before.issue,
          afterData: after.issue,
          metadata: { deliveryOrderId, reversalMovementId: reversal.movement.id, warehouseId: header.warehouse_id },
        });
        const event = buildOutboxEvent({
          requestContext,
          aggregateType: 'sales.delivery_order',
          aggregateId: deliveryOrderId,
          eventType: 'core.sales.delivery_order.inventory_issue_reversed',
          eventVersion: 1,
          payload: after.issue,
          metadata: { reversalMovementId: reversal.movement.id, warehouseId: header.warehouse_id },
        });
        await insertAuditRecord(client, audit);
        await insertOutboxEvent(client, event);
        return Object.freeze({ ok: true, replayed: false, issue: after.issue, auditId: audit.auditId, eventId: event.eventId });
      },
    });
    return transaction?.failed ?? transaction;
  } catch (error) {
    return knownDatabaseFailure(error) ?? failure('DELIVERY_ISSUE_REVERSAL_FAILED', 'Inventory issue reversal transaction failed', true);
  }
}

function mapReturnEligibility(row) {
  return Object.freeze({
    issueLineId: row.issue_line_id,
    issueId: row.issue_id,
    inventoryMovementId: row.inventory_movement_id,
    inventoryMovementLineId: row.inventory_movement_line_id,
    deliveryOrderId: row.delivery_order_id,
    deliveryOrderNumber: row.delivery_order_number,
    salesOrderId: row.sales_order_id,
    salesOrderNumber: row.order_number,
    deliveryOrderLineId: row.delivery_order_line_id,
    salesOrderLineId: row.sales_order_line_id,
    customerId: row.customer_id,
    customerCode: row.customer_code_snapshot,
    customerName: row.customer_name_snapshot,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code_snapshot,
    warehouseName: row.warehouse_name_snapshot,
    locationId: row.location_id ?? null,
    locationCode: row.location_code ?? null,
    locationName: row.location_name ?? null,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id ?? null,
    lotCode: row.lot_code ?? null,
    expiryDate: row.expiry_date ? String(row.expiry_date).slice(0, 10) : null,
    sku: row.sku_snapshot,
    itemName: row.item_name_snapshot,
    unitCode: row.unit_code_snapshot,
    issuedBaseQuantity: String(row.issued_base_quantity),
    claimedReturnBaseQuantity: String(row.claimed_return_base_quantity),
    availableReturnBaseQuantity: String(row.available_return_base_quantity),
  });
}

function mapReturnLine(row) {
  return Object.freeze({
    id: row.id,
    lineNumber: Number(row.line_number),
    deliveryOrderId: row.delivery_order_id,
    deliveryOrderNumber: row.delivery_order_number,
    deliveryOrderLineId: row.delivery_order_line_id,
    salesOrderId: row.sales_order_id,
    salesOrderNumber: row.order_number,
    salesOrderLineId: row.sales_order_line_id,
    issueId: row.issue_id,
    issueLineId: row.issue_line_id,
    inventoryMovementId: row.inventory_movement_id,
    inventoryMovementLineId: row.inventory_movement_line_id,
    warehouseId: row.warehouse_id,
    locationId: row.location_id ?? null,
    locationCode: row.location_code ?? null,
    locationName: row.location_name ?? null,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id ?? null,
    lotCode: row.lot_code ?? null,
    expiryDate: row.expiry_date ? String(row.expiry_date).slice(0, 10) : null,
    sku: row.sku_snapshot,
    itemName: row.item_name_snapshot,
    unitCode: row.unit_code_snapshot,
    requestedBaseQuantity: String(row.requested_base_quantity),
    acceptedBaseQuantity: row.accepted_base_quantity === null || row.accepted_base_quantity === undefined
      ? '0.000000000000'
      : String(row.accepted_base_quantity),
    reasonCode: row.reason_code,
    reasonNote: row.reason_note,
    receiptInventoryMovementLineId: row.receipt_inventory_movement_line_id ?? null,
  });
}

function mapReturnEvent(row) {
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

function mapCustomerReturn(row, lines = undefined, events = undefined) {
  return Object.freeze({
    id: row.id,
    number: row.return_number ?? null,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    status: row.status,
    note: row.note ?? null,
    revision: String(row.revision),
    inventoryMovementId: row.inventory_movement_id ?? null,
    receivedAt: row.received_at ?? null,
    receivedBy: row.received_by ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelledBy: row.cancelled_by ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    lineCount: row.line_count === undefined ? undefined : Number(row.line_count),
    requestedBaseQuantity: row.requested_base_quantity === undefined ? undefined : String(row.requested_base_quantity),
    acceptedBaseQuantity: row.accepted_base_quantity === undefined ? undefined : String(row.accepted_base_quantity),
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    lines,
    events,
  });
}

async function loadCustomerReturnDetail(client, { requestContext, customerReturnId, forUpdate = false }) {
  const header = await repository.getCustomerReturn(client, {
    installationId: requestContext.installationId,
    customerReturnId,
    forUpdate,
  });
  if (!header) return failure('CUSTOMER_RETURN_NOT_FOUND', 'Customer Return was not found');
  if (!warehouseAllowed(requestContext, header.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Customer Return is outside the current warehouse scope');
  }
  const [lines, events] = await Promise.all([
    repository.listCustomerReturnLines(client, { installationId: requestContext.installationId, customerReturnId }),
    repository.listCustomerReturnEvents(client, { installationId: requestContext.installationId, customerReturnId }),
  ]);
  return Object.freeze({
    ok: true,
    raw: header,
    customerReturn: mapCustomerReturn(
      header,
      Object.freeze(lines.map(mapReturnLine)),
      Object.freeze(events.map(mapReturnEvent)),
    ),
  });
}

async function loadReturnSourceLineLocked(client, { installationId, issueLineId }) {
  await client.query(
    `SELECT id FROM sales.delivery_order_inventory_issue_lines
      WHERE installation_id = $1 AND id = $2 FOR UPDATE`,
    [installationId, issueLineId],
  );
  const result = await client.query(
    `SELECT issue_line.id AS issue_line_id,
            issue_line.issue_id,
            issue.status AS issue_status,
            issue.inventory_movement_id,
            issue_line.inventory_movement_line_id,
            issue.delivery_order_id,
            delivery_order.delivery_order_number,
            delivery_order.status AS delivery_order_status,
            delivery_order.sales_order_id,
            delivery_order.customer_id,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            issue_line.delivery_order_line_id,
            delivery_line.sales_order_line_id,
            issue_line.warehouse_id,
            issue_line.location_id,
            issue_line.base_variant_id,
            issue_line.lot_id,
            delivery_line.sku_snapshot,
            delivery_line.item_name_snapshot,
            delivery_line.unit_code_snapshot,
            issue_line.issued_base_quantity,
            EXISTS (
              SELECT 1
                FROM accounting.receivable_document_lines receivable_line
                JOIN accounting.receivable_documents receivable_document
                  ON receivable_document.installation_id = receivable_line.installation_id
                 AND receivable_document.id = receivable_line.receivable_document_id
               WHERE receivable_line.installation_id = issue_line.installation_id
                 AND receivable_line.inventory_issue_line_id = issue_line.id
                 AND receivable_document.direction = 'DEBIT'
                 AND receivable_document.document_type IN ('SALE_DELIVERY', 'SALE_PICKUP')
                 AND receivable_document.status <> 'reversed'
            ) AS has_posted_receivable,
            COALESCE((
              SELECT sum(CASE
                WHEN header.status = 'received' THEN COALESCE(receipt.accepted_base_quantity, 0)
                ELSE return_line.requested_base_quantity
              END)
                FROM sales.customer_return_lines return_line
                JOIN sales.customer_returns header
                  ON header.installation_id = return_line.installation_id
                 AND header.id = return_line.customer_return_id
                LEFT JOIN sales.customer_return_receipt_lines receipt
                  ON receipt.installation_id = return_line.installation_id
                 AND receipt.customer_return_line_id = return_line.id
               WHERE return_line.installation_id = issue_line.installation_id
                 AND return_line.issue_line_id = issue_line.id
                 AND header.status IN ('draft', 'received')
            ), 0) AS claimed_return_base_quantity
       FROM sales.delivery_order_inventory_issue_lines issue_line
       JOIN sales.delivery_order_inventory_issues issue
         ON issue.installation_id = issue_line.installation_id AND issue.id = issue_line.issue_id
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = issue_line.installation_id AND delivery_order.id = issue.delivery_order_id
       JOIN sales.delivery_order_lines delivery_line
         ON delivery_line.installation_id = issue_line.installation_id AND delivery_line.id = issue_line.delivery_order_line_id
      WHERE issue_line.installation_id = $1 AND issue_line.id = $2`,
    [installationId, issueLineId],
  );
  return result.rows?.[0] ?? null;
}

export async function listCustomerReturnEligibility(client, {
  requestContext,
  deliveryOrderId = null,
  limit = 500,
  offset = 0,
}) {
  const permission = 'core.customer-return.read';
  if (!hasPermission(requestContext, permission)) return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  if (deliveryOrderId && !UUID_PATTERN.test(deliveryOrderId)) {
    return failure('INVALID_DELIVERY_ORDER_ID', 'Delivery Order ID is invalid');
  }
  const warehouses = [...warehouseIdSet(requestContext)];
  if (warehouses.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one warehouse scope is required');
  const rows = await repository.listReturnEligibility(client, {
    installationId: requestContext.installationId,
    warehouseIds: warehouses,
    deliveryOrderId,
    limit: Math.min(Math.max(Number(limit) || 500, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0),
  });
  return Object.freeze({ ok: true, eligibility: Object.freeze(rows.map(mapReturnEligibility)) });
}

export async function listCustomerReturns(client, {
  requestContext,
  status = null,
  limit = 200,
  offset = 0,
}) {
  const permission = 'core.customer-return.read';
  if (!hasPermission(requestContext, permission)) return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  if (status && !RETURN_STATUSES.has(status)) return failure('INVALID_STATUS', 'Customer Return status is invalid');
  const warehouses = [...warehouseIdSet(requestContext)];
  if (warehouses.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one warehouse scope is required');
  const rows = await repository.listCustomerReturns(client, {
    installationId: requestContext.installationId,
    warehouseIds: warehouses,
    status,
    limit: Math.min(Math.max(Number(limit) || 200, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0),
  });
  return Object.freeze({ ok: true, customerReturns: Object.freeze(rows.map((row) => mapCustomerReturn(row))) });
}

export async function getCustomerReturn(client, { requestContext, customerReturnId }) {
  const permission = 'core.customer-return.read';
  if (!hasPermission(requestContext, permission)) return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  const identityError = validateUuid(customerReturnId, 'customerReturnId');
  if (identityError) return identityError;
  const detail = await loadCustomerReturnDetail(client, { requestContext, customerReturnId });
  return detail.ok ? Object.freeze({ ok: true, customerReturn: detail.customerReturn }) : detail;
}

function validateCreateReturnPayload(payload) {
  if (!Array.isArray(payload?.lines) || payload.lines.length < 1 || payload.lines.length > 10000) {
    return failure('CUSTOMER_RETURN_LINES_REQUIRED', 'Customer Return requires 1-10000 source lines');
  }
  const lines = [];
  const seen = new Set();
  for (let index = 0; index < payload.lines.length; index += 1) {
    const input = payload.lines[index] ?? {};
    const issueLineId = String(input.issueLineId ?? '').trim();
    const quantity = parseQuantity(input.quantity);
    const reasonCode = String(input.reasonCode ?? '').trim().toUpperCase();
    const reasonNote = text(input.reasonNote, 2000);
    if (!UUID_PATTERN.test(issueLineId) || seen.has(issueLineId)) {
      return failure('INVALID_ISSUE_LINE_ID', 'Customer Return source line is invalid or duplicated', false, { line: index + 1 });
    }
    if (quantity === null || quantity <= 0n || !CODE_PATTERN.test(reasonCode) || !reasonNote) {
      return failure('INVALID_CUSTOMER_RETURN_LINE', 'Return quantity and reason are required', false, { line: index + 1 });
    }
    seen.add(issueLineId);
    lines.push(Object.freeze({ issueLineId, quantity, reasonCode, reasonNote }));
  }
  const note = text(payload?.note, 4000);
  if (payload?.note && !note) return failure('INVALID_NOTE', 'Customer Return note is invalid');
  return Object.freeze({ ok: true, lines: Object.freeze(lines), note });
}

export async function executeCreateCustomerReturn({ adapter, requestContext, idempotencyKey, payload }) {
  const permission = 'core.customer-return.create';
  if (!hasPermission(requestContext, permission)) return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  const idempotencyError = validateIdempotencyKey(idempotencyKey);
  if (idempotencyError) return idempotencyError;
  const validated = validateCreateReturnPayload(payload);
  if (!validated.ok) return validated;
  const canonicalPayload = Object.freeze({
    lines: validated.lines.map((line) => ({
      issueLineId: line.issueLineId,
      quantity: formatQuantity(line.quantity),
      reasonCode: line.reasonCode,
      reasonNote: line.reasonNote,
    })),
    note: validated.note,
  });
  const hash = payloadHash(canonicalPayload);
  try {
    const transaction = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        await repository.setCustomerReturnWriteContext(client);
        await repository.lockOperationKey(client, {
          installationId: requestContext.installationId,
          operation: 'return-create',
          idempotencyKey,
        });
        const replay = await repository.getCustomerReturnByCreateKey(client, {
          installationId: requestContext.installationId,
          idempotencyKey,
        });
        if (replay) {
          if (replay.create_payload_hash !== hash) {
            return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Customer Return key was used with another payload') };
          }
          const detail = await loadCustomerReturnDetail(client, { requestContext, customerReturnId: replay.id });
          if (!detail.ok) return { failed: detail };
          return Object.freeze({ ok: true, replayed: true, customerReturn: detail.customerReturn });
        }
        const loaded = [];
        for (const input of validated.lines) {
          const source = await loadReturnSourceLineLocked(client, {
            installationId: requestContext.installationId,
            issueLineId: input.issueLineId,
          });
          if (!source || source.issue_status !== 'POSTED'
            || !['dispatched', 'handed_over'].includes(source.delivery_order_status)) {
            return { failed: failure('CUSTOMER_RETURN_SOURCE_NOT_ELIGIBLE', 'Issued source line is not eligible for return') };
          }
          if (!source.has_posted_receivable) {
            return { failed: failure(
              'CUSTOMER_RETURN_RECEIVABLE_NOT_POSTED',
              'Chưa thể nhận hàng khách trả vì phiếu giao chưa phát sinh công nợ. Nếu khách chưa nhận hàng, hãy nhập hàng về tại Đối soát cuối chuyến.',
            ) };
          }
          if (!warehouseAllowed(requestContext, source.warehouse_id)) {
            return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Return source is outside the current warehouse scope') };
          }
          const issued = parseQuantity(source.issued_base_quantity);
          const claimed = parseQuantity(source.claimed_return_base_quantity);
          if (issued === null || claimed === null || input.quantity > issued - claimed) {
            return { failed: failure('CUSTOMER_RETURN_QUANTITY_CONFLICT', 'Requested return exceeds remaining issued quantity', true) };
          }
          loaded.push(Object.freeze({ input, source }));
        }
        const first = loaded[0].source;
        if (loaded.some(({ source }) => source.customer_id !== first.customer_id || source.warehouse_id !== first.warehouse_id)) {
          return { failed: failure('CUSTOMER_RETURN_MIXED_SOURCE_FORBIDDEN', 'One Customer Return must belong to one customer and warehouse') };
        }
        const customerReturnId = randomUUID();
        await repository.insertCustomerReturn(client, {
          id: customerReturnId,
          installationId: requestContext.installationId,
          customerId: first.customer_id,
          warehouseId: first.warehouse_id,
          note: validated.note,
          idempotencyKey,
          payloadHash: hash,
          actorId: requestContext.actorId,
        });
        for (let index = 0; index < loaded.length; index += 1) {
          const { input, source } = loaded[index];
          await repository.insertCustomerReturnLine(client, {
            id: randomUUID(),
            installationId: requestContext.installationId,
            customerReturnId,
            lineNumber: index + 1,
            deliveryOrderId: source.delivery_order_id,
            deliveryOrderLineId: source.delivery_order_line_id,
            issueId: source.issue_id,
            issueLineId: source.issue_line_id,
            inventoryMovementId: source.inventory_movement_id,
            inventoryMovementLineId: source.inventory_movement_line_id,
            salesOrderId: source.sales_order_id,
            salesOrderLineId: source.sales_order_line_id,
            customerId: source.customer_id,
            warehouseId: source.warehouse_id,
            locationId: source.location_id,
            baseVariantId: source.base_variant_id,
            lotId: source.lot_id,
            sku: source.sku_snapshot,
            itemName: source.item_name_snapshot,
            unitCode: source.unit_code_snapshot,
            quantity: formatQuantity(input.quantity),
            reasonCode: input.reasonCode,
            reasonNote: input.reasonNote,
            actorId: requestContext.actorId,
          });
        }
        const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
        await repository.insertCustomerReturnEvent(client, {
          installationId: requestContext.installationId,
          customerReturnId,
          eventType: 'CREATED',
          idempotencyKey,
          payloadHash: hash,
          actorId: requestContext.actorId,
          requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp,
          metadata: { customerId: first.customer_id, warehouseId: first.warehouse_id, lineCount: loaded.length },
          occurredAt,
        });
        const detail = await loadCustomerReturnDetail(client, { requestContext, customerReturnId });
        if (!detail.ok) return { failed: detail };
        const audit = buildAuditRecord({
          requestContext,
          action: 'sales.customer_return.create',
          resourceType: 'customer_return',
          resourceId: customerReturnId,
          afterData: detail.customerReturn,
          metadata: { customerId: first.customer_id, warehouseId: first.warehouse_id },
        });
        const event = buildOutboxEvent({
          requestContext,
          aggregateType: 'sales.customer_return',
          aggregateId: customerReturnId,
          eventType: 'core.sales.customer_return.created',
          eventVersion: 1,
          payload: detail.customerReturn,
          metadata: { customerId: first.customer_id, warehouseId: first.warehouse_id },
        });
        await insertAuditRecord(client, audit);
        await insertOutboxEvent(client, event);
        return Object.freeze({ ok: true, replayed: false, customerReturn: detail.customerReturn, auditId: audit.auditId, eventId: event.eventId });
      },
    });
    return transaction?.failed ?? transaction;
  } catch (error) {
    return knownDatabaseFailure(error) ?? failure('CUSTOMER_RETURN_CREATE_FAILED', 'Customer Return creation failed', true);
  }
}

function validateReceivePayload(payload) {
  const documentDate = strictDate(payload?.documentDate);
  const expectedRevision = /^\d+$/.test(String(payload?.expectedRevision ?? '')) ? String(payload.expectedRevision) : null;
  if (!documentDate || !expectedRevision) {
    return failure('INVALID_RECEIVE_INPUT', 'documentDate and expectedRevision are required');
  }
  if (!Array.isArray(payload?.lines) || payload.lines.length < 1 || payload.lines.length > 10000) {
    return failure('CUSTOMER_RETURN_RECEIPT_LINES_REQUIRED', 'Receipt quantities are required');
  }
  const lines = [];
  const seen = new Set();
  let total = 0n;
  for (let index = 0; index < payload.lines.length; index += 1) {
    const lineId = String(payload.lines[index]?.customerReturnLineId ?? '').trim();
    const quantity = parseQuantity(payload.lines[index]?.acceptedQuantity);
    if (!UUID_PATTERN.test(lineId) || seen.has(lineId) || quantity === null || quantity < 0n) {
      return failure('INVALID_RECEIPT_LINE', 'Customer Return receipt line is invalid', false, { line: index + 1 });
    }
    seen.add(lineId);
    total += quantity;
    lines.push(Object.freeze({ lineId, quantity }));
  }
  if (total <= 0n) return failure('ACCEPTED_QUANTITY_REQUIRED', 'At least one accepted quantity must be greater than zero');
  return Object.freeze({ ok: true, documentDate, expectedRevision, lines: Object.freeze(lines) });
}

async function loadReturnMovementSources(client, { installationId, customerReturnId, lineIds }) {
  const result = await client.query(
    `SELECT line.*,
            base.sku AS base_sku,
            base.unit_id AS base_unit_id,
            unit.code AS base_unit_code,
            lot.lot_code,
            lot.expiry_date
       FROM sales.customer_return_lines line
       JOIN shared.product_variants base
         ON base.installation_id = line.installation_id AND base.id = line.base_variant_id
       JOIN shared.units_of_measure unit
         ON unit.installation_id = base.installation_id AND unit.id = base.unit_id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = line.installation_id AND lot.id = line.lot_id
      WHERE line.installation_id = $1
        AND line.customer_return_id = $2
        AND line.id = ANY($3::uuid[])
      ORDER BY line.line_number ASC`,
    [installationId, customerReturnId, lineIds],
  );
  return result.rows ?? [];
}

async function executeCustomerReturnTransition({
  adapter,
  requestContext,
  customerReturnId,
  idempotencyKey,
  payload,
  operation,
}) {
  const permission = operation === 'receive' ? 'core.customer-return.receive' : 'core.customer-return.cancel';
  if (!hasPermission(requestContext, permission)) return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  const identityError = validateUuid(customerReturnId, 'customerReturnId');
  if (identityError) return identityError;
  const idempotencyError = validateIdempotencyKey(idempotencyKey);
  if (idempotencyError) return idempotencyError;
  const receiveInput = operation === 'receive' ? validateReceivePayload(payload) : null;
  if (receiveInput && !receiveInput.ok) return receiveInput;
  const reason = operation === 'cancel' ? text(payload?.reason, 1000) : null;
  if (operation === 'cancel' && !reason) return failure('CANCELLATION_REASON_REQUIRED', 'Cancellation reason is required');
  const canonicalPayload = operation === 'receive'
    ? {
        customerReturnId,
        documentDate: receiveInput.documentDate,
        expectedRevision: receiveInput.expectedRevision,
        lines: receiveInput.lines.map((line) => ({ customerReturnLineId: line.lineId, acceptedQuantity: formatQuantity(line.quantity) })),
      }
    : { customerReturnId, reason };
  const hash = payloadHash(canonicalPayload);
  try {
    const transaction = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        await repository.setCustomerReturnWriteContext(client);
        await repository.lockOperationKey(client, {
          installationId: requestContext.installationId,
          operation: `return-${operation}`,
          idempotencyKey,
        });
        const replayEvent = await repository.getCustomerReturnEventByKey(client, {
          installationId: requestContext.installationId,
          idempotencyKey,
        });
        const expectedEvent = operation === 'receive' ? 'RECEIVED' : 'CANCELLED';
        if (replayEvent) {
          if (replayEvent.payload_hash !== hash || replayEvent.customer_return_id !== customerReturnId
            || replayEvent.event_type !== expectedEvent) {
            return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Customer Return transition key was used with another payload') };
          }
          const detail = await loadCustomerReturnDetail(client, { requestContext, customerReturnId });
          if (!detail.ok) return { failed: detail };
          return Object.freeze({ ok: true, replayed: true, customerReturn: detail.customerReturn });
        }
        const before = await loadCustomerReturnDetail(client, { requestContext, customerReturnId, forUpdate: true });
        if (!before.ok) return { failed: before };
        if (before.raw.status !== 'draft') {
          return { failed: failure('CUSTOMER_RETURN_NOT_DRAFT', 'Only a draft Customer Return can be transitioned') };
        }
        let movementId = null;
        let numberAllocation = null;
        if (operation === 'receive') {
          if (String(before.raw.revision) !== receiveInput.expectedRevision) {
            return { failed: failure('CUSTOMER_RETURN_REVISION_CONFLICT', 'Customer Return changed concurrently', true) };
          }
          const sourceById = new Map(before.customerReturn.lines.map((line) => [line.id, line]));
          if (receiveInput.lines.some((line) => !sourceById.has(line.lineId))) {
            return { failed: failure('CUSTOMER_RETURN_LINE_NOT_FOUND', 'One or more receipt lines do not belong to this Customer Return') };
          }
          for (const input of receiveInput.lines) {
            const requested = parseQuantity(sourceById.get(input.lineId).requestedBaseQuantity);
            if (requested === null || input.quantity > requested) {
              return { failed: failure('CUSTOMER_RETURN_RECEIPT_QUANTITY_CONFLICT', 'Accepted quantity exceeds requested quantity') };
            }
          }
          const positiveInputs = receiveInput.lines.filter((line) => line.quantity > 0n);
          const sources = await loadReturnMovementSources(client, {
            installationId: requestContext.installationId,
            customerReturnId,
            lineIds: positiveInputs.map((line) => line.lineId),
          });
          const sourceMap = new Map(sources.map((line) => [line.id, line]));
          if (sourceMap.size !== positiveInputs.length) {
            return { failed: failure('CUSTOMER_RETURN_LINE_NOT_FOUND', 'One or more receipt sources were not found') };
          }
          const series = await ensureCustomerReturnSeries(client, {
            installationId: requestContext.installationId,
            actorId: requestContext.actorId,
          });
          if (!series) return { failed: failure('DOCUMENT_NUMBER_SERIES_UNAVAILABLE', 'Customer Return number series is unavailable', true) };
          numberAllocation = await allocateDocumentNumber(client, {
            installationId: requestContext.installationId,
            seriesId: series.id,
            idempotencyKey: deriveIdempotencyKey(
              'customer-return-number',
              `${customerReturnId}.${idempotencyKey}`,
            ),
            payload: { documentDate: receiveInput.documentDate, metadata: { customerReturnId } },
            actorId: requestContext.actorId,
            requestId: requestContext.requestId,
            sourceApp: requestContext.sourceApp,
          });
          if (!numberAllocation.ok) return { failed: numberAllocation };
          const movement = await postServerOwnedSalesMovement(client, {
            requestContext,
            idempotencyKey: deriveIdempotencyKey('customer-return-movement', idempotencyKey),
            payload: {
              movementType: 'SALES_CUSTOMER_RETURN',
              direction: 'IN',
              sourceDocumentType: 'CUSTOMER_RETURN',
              sourceDocumentId: customerReturnId,
              sourceDocumentNumber: numberAllocation.allocation.document_number,
              documentDate: receiveInput.documentDate,
              reasonCode: 'CUSTOMER_RETURN_RECEIPT',
              reasonNote: 'Nhận hàng khách trả vào kho theo phiếu đã xác nhận.',
              metadata: { customerReturnId, customerId: before.raw.customer_id, warehouseId: before.raw.warehouse_id },
              lines: positiveInputs.map((input) => {
                const source = sourceMap.get(input.lineId);
                return {
                  sourceLineId: source.id,
                  warehouseId: source.warehouse_id,
                  locationId: source.location_id,
                  baseVariantId: source.base_variant_id,
                  baseSku: source.base_sku,
                  baseUnitId: source.base_unit_id,
                  baseUnitCode: source.base_unit_code,
                  lotId: source.lot_id,
                  lotCode: source.lot_code,
                  expiryDate: source.expiry_date,
                  quantity: formatQuantity(input.quantity),
                  metadata: {
                    customerReturnId,
                    customerReturnLineId: source.id,
                    deliveryOrderId: source.delivery_order_id,
                    deliveryOrderLineId: source.delivery_order_line_id,
                    originalInventoryMovementId: source.inventory_movement_id,
                    originalInventoryMovementLineId: source.inventory_movement_line_id,
                    issueId: source.issue_id,
                    issueLineId: source.issue_line_id,
                  },
                };
              }),
            },
          });
          if (!movement.ok) return { failed: movement };
          movementId = movement.movement.id;
          for (let index = 0; index < positiveInputs.length; index += 1) {
            await repository.insertCustomerReturnReceiptLine(client, {
              installationId: requestContext.installationId,
              customerReturnId,
              customerReturnLineId: positiveInputs[index].lineId,
              inventoryMovementLineId: movement.lines[index].id,
              quantity: formatQuantity(positiveInputs[index].quantity),
              metadata: { originalInventoryMovementLineId: sourceMap.get(positiveInputs[index].lineId).inventory_movement_line_id },
              actorId: requestContext.actorId,
            });
          }
          if (!await repository.receiveCustomerReturn(client, {
            installationId: requestContext.installationId,
            customerReturnId,
            returnNumber: numberAllocation.allocation.document_number,
            numberAllocationId: numberAllocation.allocation.id,
            movementId,
            actorId: requestContext.actorId,
            receivedAt: requestContext.receivedAt ?? new Date().toISOString(),
          })) return { failed: failure('CUSTOMER_RETURN_RECEIVE_CONFLICT', 'Customer Return changed concurrently', true) };
        } else if (!await repository.cancelCustomerReturn(client, {
          installationId: requestContext.installationId,
          customerReturnId,
          reason,
          actorId: requestContext.actorId,
        })) return { failed: failure('CUSTOMER_RETURN_CANCEL_CONFLICT', 'Customer Return changed concurrently', true) };

        const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
        await repository.insertCustomerReturnEvent(client, {
          installationId: requestContext.installationId,
          customerReturnId,
          eventType: operation === 'receive' ? 'RECEIVED' : 'CANCELLED',
          idempotencyKey,
          payloadHash: hash,
          actorId: requestContext.actorId,
          requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp,
          reason,
          metadata: operation === 'receive'
            ? { inventoryMovementId: movementId, returnNumber: numberAllocation.allocation.document_number }
            : {},
          occurredAt,
        });
        const after = await loadCustomerReturnDetail(client, { requestContext, customerReturnId });
        if (!after.ok) return { failed: after };
        const action = operation === 'receive' ? 'sales.customer_return.receive' : 'sales.customer_return.cancel';
        const outboxType = operation === 'receive'
          ? 'core.sales.customer_return.received'
          : 'core.sales.customer_return.cancelled';
        const audit = buildAuditRecord({
          requestContext,
          action,
          resourceType: 'customer_return',
          resourceId: customerReturnId,
          beforeData: before.customerReturn,
          afterData: after.customerReturn,
          metadata: { warehouseId: before.raw.warehouse_id, inventoryMovementId: movementId },
        });
        const event = buildOutboxEvent({
          requestContext,
          aggregateType: 'sales.customer_return',
          aggregateId: customerReturnId,
          eventType: outboxType,
          eventVersion: Number(after.customerReturn.revision),
          payload: after.customerReturn,
          metadata: { warehouseId: before.raw.warehouse_id, inventoryMovementId: movementId },
        });
        await insertAuditRecord(client, audit);
        await insertOutboxEvent(client, event);
        return Object.freeze({ ok: true, replayed: false, customerReturn: after.customerReturn, auditId: audit.auditId, eventId: event.eventId });
      },
    });
    return transaction?.failed ?? transaction;
  } catch (error) {
    return knownDatabaseFailure(error) ?? failure(`CUSTOMER_RETURN_${operation.toUpperCase()}_FAILED`, `Customer Return ${operation} transaction failed`, true);
  }
}

export function executeReceiveCustomerReturn(args) {
  return executeCustomerReturnTransition({ ...args, operation: 'receive' });
}

export function executeCancelCustomerReturn(args) {
  return executeCustomerReturnTransition({ ...args, operation: 'cancel' });
}

export const salesDeliveryInventoryInternals = Object.freeze({
  canonicalize,
  payloadHash,
  parseQuantity,
  formatQuantity,
  strictDate,
  strictTimestamp,
  timestampDateOnly,
  validateCreateReturnPayload,
  validateReceivePayload,
});
