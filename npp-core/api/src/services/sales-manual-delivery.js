import { createHash, randomUUID } from 'node:crypto';
import { createIdempotencyKey, IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as deliveryOrderRepository from '../db/repositories/sales-delivery-orders.js';
import * as repository from '../db/repositories/sales-delivery-inventory.js';
import * as manualRepository from '../db/repositories/sales-manual-delivery.js';
import { postServerOwnedSalesMovement } from './sales-inventory-ledger.js';
import { postReceivableFromManualHandover } from './manual-delivery-receivable.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const SCALE = 1_000_000_000_000n;
const PERMISSION = 'core.delivery-order.manual-handover';

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

function deterministicUuid(seed) {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function derivedKey(operation, seed) {
  return createIdempotencyKey(operation, deterministicUuid(`${operation}\u0000${seed}`));
}

function parseQuantity(value) {
  const match = QUANTITY_PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(12, '0'));
}

function text(value, maxLength) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function timestamp(value) {
  const normalized = text(value, 64);
  const parsed = normalized ? new Date(normalized) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}

function dateOnlyInVietnam(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const read = (type) => parts.find((part) => part.type === type)?.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function hasPermission(requestContext) {
  return new Set([
    ...(requestContext?.permissions ?? []),
    ...(requestContext?.grantedPermissions ?? []),
  ]).has(PERMISSION);
}

function warehouseAllowed(requestContext, warehouseId) {
  return new Set(requestContext?.scopes?.warehouseIds ?? []).has(warehouseId);
}

async function loadIssue(client, { requestContext, issueId }) {
  const row = await repository.getIssueById(client, {
    installationId: requestContext.installationId,
    issueId,
  });
  if (!row) return failure('DELIVERY_INVENTORY_ISSUE_NOT_FOUND', 'Delivery inventory issue was not found');
  if (!warehouseAllowed(requestContext, row.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Delivery inventory issue is outside the current warehouse scope');
  }
  return Object.freeze({ ok: true, issue: Object.freeze({
    id: row.id,
    deliveryOrderId: row.delivery_order_id,
    deliveryOrderNumber: row.delivery_order_number ?? null,
    salesOrderId: row.sales_order_id,
    warehouseId: row.warehouse_id,
    issueSourceType: row.issue_source_type,
    issueSourceId: row.issue_source_id,
    status: row.status,
    inventoryMovementId: row.inventory_movement_id ?? null,
    receiverName: row.receiver_name ?? null,
    receiverNote: row.receiver_note ?? null,
    postedAt: row.posted_at ?? null,
  }) });
}

function knownDatabaseFailure(error) {
  const message = String(error?.message ?? '');
  for (const [needle, code, publicMessage] of [
    ['delivery_order_inventory_issues_one_active_idx', 'DELIVERY_ORDER_ALREADY_ISSUED', 'Delivery Order already has an active inventory issue'],
    ['delivery_issue_exceeds_delivery_order_line', 'DELIVERY_ISSUE_QUANTITY_CONFLICT', 'Inventory issue exceeds the Delivery Order line quantity'],
    ['inventory_reservation_issue_exceeds_remaining', 'RESERVATION_QUANTITY_CONFLICT', 'Exact reservation does not have enough remaining quantity'],
    ['inventory_reservation_balance_mismatch', 'RESERVATION_BALANCE_CONFLICT', 'Reservation and inventory balance are inconsistent'],
    ['inventory_negative_stock_denied', 'INSUFFICIENT_INVENTORY', 'Inventory is insufficient for this issue'],
    ['receivable_documents_source_unique', 'RECEIVABLE_SOURCE_CONFLICT', 'Manual handover already has a receivable document'],
  ]) {
    if (message.includes(needle)) return failure(code, publicMessage, code.endsWith('CONFLICT'));
  }
  return null;
}

export async function executeManualDeliveryHandover({
  adapter, requestContext, deliveryOrderId, idempotencyKey, payload,
}) {
  if (!hasPermission(requestContext)) return failure('PERMISSION_DENIED', `Permission ${PERMISSION} is required`);
  if (!UUID_PATTERN.test(String(deliveryOrderId ?? ''))) return failure('INVALID_IDENTITY', 'deliveryOrderId is invalid');
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must use the canonical safe-character contract');
  }
  const receiverName = text(payload?.receiverName, 256);
  const receiverNote = payload?.receiverNote ? text(payload.receiverNote, 2000) : null;
  const handedOverAt = timestamp(payload?.handedOverAt);
  if (!receiverName) return failure('RECEIVER_NAME_REQUIRED', 'Receiver name is required for manual delivery');
  if (payload?.receiverNote && !receiverNote) return failure('INVALID_RECEIVER_NOTE', 'Receiver note must not exceed 2000 characters');
  if (!handedOverAt) return failure('INVALID_HANDOVER_TIME', 'Manual delivery handover time is invalid');

  const issueSourceType = 'MANUAL_HANDOVER';
  const issueSourceId = `manual.${deliveryOrderId}`;
  const canonicalPayload = { deliveryOrderId, issueSourceType, issueSourceId, handedOverAt, receiverName, receiverNote };
  const hash = payloadHash(canonicalPayload);

  try {
    const result = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        await repository.setDeliveryIssueWriteContext(client);
        await repository.lockOperationKey(client, {
          installationId: requestContext.installationId,
          operation: 'manual-handover',
          idempotencyKey,
        });
        const replay = await repository.getIssueByIdempotencyKey(client, {
          installationId: requestContext.installationId,
          idempotencyKey,
        });
        if (replay) {
          if (replay.payload_hash !== hash || replay.delivery_order_id !== deliveryOrderId
            || replay.issue_source_type !== issueSourceType) {
            return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Manual handover key was used with another payload') };
          }
          const detail = await loadIssue(client, { requestContext, issueId: replay.id });
          return detail.ok ? Object.freeze({ ok: true, replayed: true, issue: detail.issue }) : { failed: detail };
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
          return { failed: failure('DELIVERY_ORDER_NOT_READY', 'Delivery Order is not ready for manual delivery') };
        }
        if (header.handover_mode !== 'DELIVERY' || header.sales_order_delivery_mode !== 'DELIVERY') {
          return { failed: failure('DELIVERY_ORDER_MODE_MISMATCH', 'Manual delivery is only valid for DELIVERY orders') };
        }
        if (!header.delivery_order_number) return { failed: failure('DELIVERY_ORDER_NUMBER_REQUIRED', 'Delivery Order must have an official number') };
        if (await repository.getActiveIssueForDeliveryOrder(client, {
          installationId: requestContext.installationId, deliveryOrderId, forUpdate: true,
        })) return { failed: failure('DELIVERY_ORDER_ALREADY_ISSUED', 'Delivery Order already has an active inventory issue') };

        const sourceLines = await repository.listDeliveryOrderIssueSourceLines(client, {
          installationId: requestContext.installationId, deliveryOrderId,
        });
        if (!sourceLines.length) return { failed: failure('DELIVERY_ORDER_LINES_REQUIRED', 'Delivery Order has no source lines') };
        for (const line of sourceLines) {
          const quantity = parseQuantity(line.delivery_base_quantity);
          const reserved = parseQuantity(line.reservation_quantity);
          const consumed = parseQuantity(line.reservation_consumed_quantity);
          if (quantity === null || reserved === null || consumed === null || quantity <= 0n
            || consumed + quantity > reserved || !['ACTIVE', 'CONSUMED'].includes(line.reservation_state)
            || line.demand_state !== 'ACTIVE') {
            return { failed: failure('DELIVERY_ORDER_LINE_NOT_ISSUABLE', 'Delivery Order line no longer has valid packed reservation quantity', true, { deliveryOrderLineId: line.id }) };
          }
        }

        const issueId = randomUUID();
        await repository.insertIssue(client, {
          id: issueId, installationId: requestContext.installationId, deliveryOrderId,
          issueSourceType, issueSourceId, receiverName, receiverNote, idempotencyKey,
          payloadHash: hash, actorId: requestContext.actorId,
        });
        const issueLines = [];
        for (const source of sourceLines) {
          const issueLineId = randomUUID();
          const quantity = String(source.delivery_base_quantity);
          const issueLine = await repository.insertIssueLine(client, {
            id: issueLineId, installationId: requestContext.installationId, issueId, deliveryOrderId,
            deliveryOrderLineId: source.id, fulfillmentDemandId: source.fulfillment_demand_id,
            fulfillmentAllocationId: source.fulfillment_allocation_id,
            inventoryReservationId: source.inventory_reservation_id, warehouseId: source.warehouse_id,
            locationId: source.location_id, baseVariantId: source.base_variant_id, lotId: source.lot_id,
            quantity, actorId: requestContext.actorId,
          });
          issueLines.push({ issueLine, source });
          const adjustment = {
            adjustmentType: 'CONSUME', reservationId: source.inventory_reservation_id, quantity,
            deliveryOrderId, deliveryOrderLineId: source.id, issueId, issueLineId,
          };
          await repository.insertReservationAdjustment(client, {
            installationId: requestContext.installationId, reservationId: source.inventory_reservation_id,
            adjustmentType: 'CONSUME', quantity, sourceDocumentType: 'DELIVERY_ORDER',
            sourceDocumentId: deliveryOrderId, sourceLineId: issueLineId,
            idempotencyKey: derivedKey('manual-consume', `${idempotencyKey}:${issueLineId}`),
            payloadHash: payloadHash(adjustment), actorId: requestContext.actorId,
            requestId: requestContext.requestId, sourceApp: requestContext.sourceApp,
            metadata: adjustment, occurredAt: handedOverAt,
          });
        }

        const movementResult = await postServerOwnedSalesMovement(client, {
          requestContext,
          idempotencyKey: derivedKey('manual-movement', idempotencyKey),
          payload: {
            movementType: 'SALES_DELIVERY_ISSUE', direction: 'OUT', sourceDocumentType: 'DELIVERY_ORDER',
            sourceDocumentId: deliveryOrderId, sourceDocumentNumber: header.delivery_order_number,
            documentDate: dateOnlyInVietnam(handedOverAt), reasonCode: 'MANUAL_DELIVERY_HANDOVER',
            reasonNote: `Giao thủ công cho ${receiverName}`,
            metadata: { deliveryOrderId, salesOrderId: header.sales_order_id, issueId, issueSourceType, issueSourceId },
            lines: issueLines.map(({ issueLine, source }) => ({
              sourceLineId: issueLine.id, warehouseId: source.warehouse_id, locationId: source.location_id,
              baseVariantId: source.base_variant_id, baseSku: source.base_sku, baseUnitId: source.base_unit_id,
              baseUnitCode: source.base_unit_code, lotId: source.lot_id, lotCode: source.lot_code,
              expiryDate: source.expiry_date, quantity: String(source.delivery_base_quantity),
              metadata: { issueId, issueLineId: issueLine.id, deliveryOrderId, deliveryOrderLineId: source.id,
                salesOrderId: source.sales_order_id, salesOrderLineId: source.sales_order_line_id,
                fulfillmentDemandId: source.fulfillment_demand_id, fulfillmentAllocationId: source.fulfillment_allocation_id,
                inventoryReservationId: source.inventory_reservation_id },
            })),
          },
        });
        if (!movementResult.ok) return { failed: movementResult };
        if (movementResult.lines.length !== issueLines.length) return { failed: failure('INVENTORY_MOVEMENT_LINE_MISMATCH', 'Inventory movement line count is invalid') };
        for (let index = 0; index < issueLines.length; index += 1) {
          await repository.attachMovementLineToIssueLine(client, {
            installationId: requestContext.installationId,
            issueLineId: issueLines[index].issueLine.id,
            movementLineId: movementResult.lines[index].id,
          });
        }
        if (!await repository.finalizeIssue(client, {
          installationId: requestContext.installationId, issueId, movementId: movementResult.movement.id,
          actorId: requestContext.actorId, postedAt: handedOverAt,
        })) return { failed: failure('DELIVERY_ISSUE_CONFLICT', 'Manual delivery issue changed concurrently', true) };
        if (!await repository.updateDeliveryOrderIssueStatus(client, {
          installationId: requestContext.installationId, deliveryOrderId, status: 'handed_over',
          actorId: requestContext.actorId,
        })) return { failed: failure('DELIVERY_ORDER_TRANSITION_CONFLICT', 'Delivery Order changed concurrently', true) };

        const demandIds = [...new Set(sourceLines.map((line) => line.fulfillment_demand_id))];
        await repository.refreshFulfillmentIssuedProjection(client, { installationId: requestContext.installationId, demandIds, actorId: requestContext.actorId });
        await repository.refreshSalesOrderFulfillmentStatus(client, { installationId: requestContext.installationId, salesOrderId: header.sales_order_id, actorId: requestContext.actorId });
        const receivable = await postReceivableFromManualHandover(client, { requestContext, issueId });
        if (!receivable.ok) return { failed: receivable };
        await manualRepository.refreshAcceptedDeliveryStatus(client, { installationId: requestContext.installationId, salesOrderId: header.sales_order_id, actorId: requestContext.actorId });
        await deliveryOrderRepository.insertDeliveryOrderEvent(client, {
          installationId: requestContext.installationId, deliveryOrderId, eventType: 'MANUAL_HANDED_OVER',
          idempotencyKey, payloadHash: hash, actorId: requestContext.actorId,
          requestId: requestContext.requestId, sourceApp: requestContext.sourceApp,
          metadata: { issueId, inventoryMovementId: movementResult.movement.id, issueSourceType, issueSourceId, receiverName },
          occurredAt: handedOverAt,
        });
        const detail = await loadIssue(client, { requestContext, issueId });
        if (!detail.ok) return { failed: detail };
        const audit = buildAuditRecord({
          requestContext, action: 'sales.delivery_order.manual_handover', resourceType: 'delivery_order_inventory_issue',
          resourceId: issueId, afterData: detail.issue,
          metadata: { deliveryOrderId, inventoryMovementId: movementResult.movement.id, warehouseId: header.warehouse_id,
            receivableDocumentId: receivable.receivableDocument?.id ?? null }, occurredAt: handedOverAt,
        });
        const event = buildOutboxEvent({
          requestContext, aggregateType: 'sales.delivery_order', aggregateId: deliveryOrderId,
          eventType: 'core.sales.delivery_order.manual_handed_over', eventVersion: 1, payload: detail.issue,
          metadata: { inventoryMovementId: movementResult.movement.id, warehouseId: header.warehouse_id,
            receivableDocumentId: receivable.receivableDocument?.id ?? null },
          createdAt: handedOverAt, availableAt: handedOverAt,
        });
        await insertAuditRecord(client, audit);
        await insertOutboxEvent(client, event);
        return Object.freeze({
          ok: true, replayed: false, issue: detail.issue, receivableDocument: receivable.receivableDocument,
          auditId: audit.auditId, eventId: event.eventId,
          expectedAuditCount: receivable.receivableDocument ? 2 : 1,
          expectedOutboxCount: receivable.receivableDocument ? 2 : 1,
        });
      },
    });
    return result?.failed ?? result;
  } catch (error) {
    return knownDatabaseFailure(error) ?? failure('MANUAL_DELIVERY_HANDOVER_FAILED', 'Manual delivery handover transaction failed', true);
  }
}

export const manualDeliveryInternals = Object.freeze({ deterministicUuid, derivedKey, payloadHash });
