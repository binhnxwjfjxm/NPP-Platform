import { createHash, randomUUID } from 'node:crypto';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import { PERMISSIONS } from '../access/permissions.js';
import { postInventoryMovement, reverseInventoryMovement } from './inventory-ledger.js';
import * as repository from '../db/repositories/manual-inbound.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COST_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/;
const INBOUND_TYPES = new Set([
  'MANUAL_RECEIPT',
  'OFF_DOCUMENT_CUSTOMER_RETURN',
  'RECOVERY',
  'OTHER',
]);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (maxLength > 0 && normalized.length > maxLength)) return null;
  return normalized;
}

function strictDate(value) {
  const normalized = text(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized ?? '');
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])) return null;
  return normalized;
}

function objectValue(value, maxBytes = 16000) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return JSON.stringify(value).length <= maxBytes ? value : null;
  } catch {
    return null;
  }
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes(permission);
}

function allowedWarehouseIds(requestContext) {
  return [...new Set(
    (Array.isArray(requestContext?.scopes?.warehouseIds) ? requestContext.scopes.warehouseIds : [])
      .filter((id) => typeof id === 'string' && UUID_PATTERN.test(id.trim()))
      .map((id) => id.trim()),
  )];
}

function deterministicDocumentId(installationId, idempotencyKey) {
  const raw = createHash('sha256').update(`${installationId}:${idempotencyKey}`).digest('hex').slice(0, 32).split('');
  raw[12] = '5';
  raw[16] = (8 | (Number.parseInt(raw[16], 16) & 3)).toString(16);
  const hex = raw.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeUnitCost(value, lineNumber) {
  const normalized = text(value, 48);
  if (!normalized || !COST_PATTERN.test(normalized)) {
    return failure(
      'MANUAL_INBOUND_COST_REQUIRED',
      `Dòng ${lineNumber}: Lô 1 yêu cầu giá vốn dương trước khi ghi sổ.`,
    );
  }
  const [whole, fraction = ''] = normalized.split('.');
  const scaled = BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, '0'));
  if (scaled <= 0n) {
    return failure('MANUAL_INBOUND_COST_REQUIRED', `Dòng ${lineNumber}: Giá vốn phải lớn hơn 0.`);
  }
  return Object.freeze({ ok: true, value: `${whole}.${fraction.padEnd(12, '0')}` });
}

export function normalizeManualInboundPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Dữ liệu Nhập kho thủ công không hợp lệ.');
  }
  const warehouseId = text(payload.warehouseId, 64);
  if (!warehouseId || !UUID_PATTERN.test(warehouseId)) {
    return failure('INVALID_WAREHOUSE_ID', 'Kho nhập không hợp lệ.');
  }
  const inboundType = text(payload.inboundType, 64)?.toUpperCase() ?? null;
  if (!inboundType || !INBOUND_TYPES.has(inboundType)) {
    return failure('INVALID_MANUAL_INBOUND_TYPE', 'Loại nhập kho thủ công không hợp lệ.');
  }
  const documentDate = strictDate(payload.documentDate);
  if (!documentDate) return failure('INVALID_DOCUMENT_DATE', 'Ngày chứng từ không hợp lệ.');
  const referenceNumber = text(payload.referenceNumber, 160);
  const note = text(payload.note, 2000);
  if (inboundType === 'OTHER' && !note) {
    return failure('MANUAL_INBOUND_NOTE_REQUIRED', 'Loại “Khác” bắt buộc có ghi chú.');
  }
  const metadata = objectValue(payload.metadata);
  if (metadata === null) return failure('INVALID_METADATA', 'Thông tin bổ sung không hợp lệ.');
  if (!Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > 500) {
    return failure('INVALID_ROWS', 'Chứng từ phải có từ 1 đến 500 dòng hàng.');
  }

  const rows = [];
  for (let index = 0; index < payload.rows.length; index += 1) {
    const source = payload.rows[index];
    const lineNumber = index + 1;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return failure('INVALID_ROW', `Dòng ${lineNumber} không hợp lệ.`);
    }
    const sourceVariantId = text(source.sourceVariantId, 64);
    if (!sourceVariantId || !UUID_PATTERN.test(sourceVariantId)) {
      return failure('INVALID_SOURCE_VARIANT_ID', `Dòng ${lineNumber}: SKU không hợp lệ.`);
    }
    const sourceQuantity = text(source.sourceQuantity, 32);
    if (!sourceQuantity) return failure('INVALID_QUANTITY', `Dòng ${lineNumber}: Thiếu số lượng.`);
    const unitCost = normalizeUnitCost(source.unitCost, lineNumber);
    if (!unitCost.ok) return unitCost;
    const lineMetadata = objectValue(source.metadata);
    if (lineMetadata === null) return failure('INVALID_ROW_METADATA', `Dòng ${lineNumber}: Thông tin bổ sung không hợp lệ.`);
    rows.push(Object.freeze({
      sourceVariantId,
      sourceQuantity,
      locationId: text(source.locationId, 64),
      lotId: text(source.lotId, 64),
      lotCode: text(source.lotCode, 100),
      manufacturedDate: text(source.manufacturedDate, 10),
      expiryDate: text(source.expiryDate, 10),
      supplierLotReference: text(source.supplierLotReference, 160),
      sourceLineReference: text(source.sourceLineReference, 160) ?? `Dong-${lineNumber}`,
      unitCost: unitCost.value,
      metadata: lineMetadata,
    }));
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      warehouseId,
      inboundType,
      documentDate,
      referenceNumber,
      note,
      metadata,
      rows: Object.freeze(rows),
    }),
  });
}

function mappedDocument(document, lines = []) {
  if (!document) return null;
  return Object.freeze({
    ...document,
    status: document.reversal_movement_id ? 'REVERSED' : 'POSTED',
    lines: Object.freeze(lines),
  });
}

export async function getManualInbound(client, { requestContext, id }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundRead)) {
    return failure('PERMISSION_DENIED', 'Không có quyền xem Nhập kho thủ công.');
  }
  if (!UUID_PATTERN.test(String(id ?? ''))) return failure('INVALID_DOCUMENT_ID', 'Chứng từ không hợp lệ.');
  const document = await repository.getManualInboundDocumentById(client, {
    installationId: requestContext.installationId,
    id,
  });
  if (!document) return failure('MANUAL_INBOUND_NOT_FOUND', 'Không tìm thấy chứng từ Nhập kho thủ công.');
  if (!allowedWarehouseIds(requestContext).includes(document.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Chứng từ nằm ngoài phạm vi kho được cấp.');
  }
  const lines = await repository.listManualInboundDocumentLines(client, {
    installationId: requestContext.installationId,
    documentId: id,
  });
  return Object.freeze({ ok: true, document: mappedDocument(document, lines) });
}

export async function listManualInbounds(client, { requestContext, limit = 100, offset = 0 }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundRead)) {
    return failure('PERMISSION_DENIED', 'Không có quyền xem Nhập kho thủ công.');
  }
  const warehouseIds = allowedWarehouseIds(requestContext);
  if (warehouseIds.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'Chưa được cấp phạm vi kho.');
  const documents = await repository.listManualInboundDocuments(client, {
    installationId: requestContext.installationId,
    warehouseIds,
    limit: Math.min(Math.max(Number(limit) || 100, 1), 200),
    offset: Math.max(Number(offset) || 0, 0),
  });
  return Object.freeze({ ok: true, documents: Object.freeze(documents.map((document) => mappedDocument(document))) });
}

export async function postManualInbound({ adapter, requestContext, idempotencyKey, payload }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPost)) {
    return failure('PERMISSION_DENIED', 'Không có quyền xác nhận Nhập kho thủ công.');
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key không hợp lệ.');
  }
  const normalized = normalizeManualInboundPayload(payload);
  if (!normalized.ok) return normalized;
  if (!allowedWarehouseIds(requestContext).includes(normalized.value.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Kho nhập nằm ngoài phạm vi được cấp.');
  }

  const documentId = deterministicDocumentId(requestContext.installationId, idempotencyKey);
  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      const movementPayload = {
        movementType: 'MANUAL_INBOUND',
        sourceDomain: 'INVENTORY',
        sourceDocumentType: 'MANUAL_INBOUND',
        sourceDocumentId: documentId,
        sourceDocumentNumber: normalized.value.referenceNumber,
        documentDate: normalized.value.documentDate,
        reasonCode: normalized.value.inboundType,
        reasonNote: normalized.value.note,
        metadata: {
          ...normalized.value.metadata,
          manualInboundType: normalized.value.inboundType,
          referenceNumber: normalized.value.referenceNumber,
        },
        lines: normalized.value.rows.map((row) => ({
          warehouseId: normalized.value.warehouseId,
          locationId: row.locationId,
          sourceVariantId: row.sourceVariantId,
          sourceQuantity: row.sourceQuantity,
          lotId: row.lotId,
          lotCode: row.lotCode,
          manufacturedDate: row.manufacturedDate,
          expiryDate: row.expiryDate,
          supplierLotReference: row.supplierLotReference,
          sourceLineReference: row.sourceLineReference,
          metadata: {
            ...row.metadata,
            unitCost: row.unitCost,
            currencyCode: 'VND',
            costSource: 'MANUAL_INBOUND_EXPLICIT',
          },
        })),
      };
      const movementResult = await postInventoryMovement(client, {
        requestContext,
        idempotencyKey,
        payload: movementPayload,
      });
      if (!movementResult.ok) return { failed: movementResult, skipAudit: true };
      if (movementResult.replayed) {
        const existing = await repository.getManualInboundDocumentByMovementId(client, {
          installationId: requestContext.installationId,
          movementId: movementResult.movement.id,
        });
        if (!existing) {
          return { failed: failure('MANUAL_INBOUND_REPLAY_INCOMPLETE', 'Không tìm thấy chứng từ của lần xác nhận trước.'), skipAudit: true };
        }
        const existingLines = await repository.listManualInboundDocumentLines(client, {
          installationId: requestContext.installationId,
          documentId: existing.id,
        });
        return { ok: true, replayed: true, document: mappedDocument(existing, existingLines), movement: movementResult.movement };
      }

      const document = await repository.insertManualInboundDocument(client, {
        id: documentId,
        installationId: requestContext.installationId,
        inboundType: normalized.value.inboundType,
        warehouseId: normalized.value.warehouseId,
        documentDate: normalized.value.documentDate,
        referenceNumber: normalized.value.referenceNumber,
        note: normalized.value.note,
        movementId: movementResult.movement.id,
        createdAt: requestContext.receivedAt ?? new Date().toISOString(),
        createdBy: requestContext.actorId,
        requestId: requestContext.requestId,
        metadata: normalized.value.metadata,
      });
      const lines = await repository.insertManualInboundDocumentLines(client, movementResult.lines.map((line, index) => ({
        id: randomUUID(),
        installationId: requestContext.installationId,
        documentId,
        lineNumber: Number(line.line_number),
        warehouseId: line.warehouse_id,
        locationId: line.location_id,
        sourceVariantId: line.source_variant_id,
        sourceSku: line.source_sku,
        sourceUnitId: line.source_unit_id,
        sourceUnitCode: line.source_unit_code,
        sourceQuantity: String(line.source_quantity),
        conversionToBase: String(line.conversion_to_base),
        baseVariantId: line.base_variant_id,
        baseSku: line.base_sku,
        baseQuantity: String(line.base_quantity_delta),
        lotId: line.lot_id,
        lotCode: line.lot_code,
        expiryDate: line.expiry_date,
        enteredUnitCost: normalized.value.rows[index].unitCost,
        currencyCode: 'VND',
        sourceLineReference: line.source_line_reference,
        metadata: line.metadata ?? {},
      })));
      const domainDocument = mappedDocument(document, lines);
      const audit = buildAuditRecord({
        requestContext,
        action: 'inventory.manual_inbound.post',
        resourceType: 'manual_inbound_document',
        resourceId: documentId,
        afterData: { document: domainDocument, movement: movementResult.movement },
        metadata: { inboundType: normalized.value.inboundType },
      });
      const event = buildOutboxEvent({
        requestContext,
        aggregateType: 'manual_inbound_document',
        aggregateId: documentId,
        eventType: 'inventory.manual-inbound.posted',
        eventVersion: 1,
        payload: { documentId, movementId: movementResult.movement.id, inboundType: normalized.value.inboundType },
        metadata: {},
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, event);
      return {
        ok: true,
        replayed: false,
        document: domainDocument,
        movement: movementResult.movement,
        auditId: audit.auditId,
        eventId: event.eventId,
      };
    },
  });
  return transaction?.failed ?? transaction;
}

export async function reverseManualInbound({ adapter, requestContext, idempotencyKey, id, payload }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundReverse)) {
    return failure('PERMISSION_DENIED', 'Không có quyền đảo Nhập kho thủ công.');
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key không hợp lệ.');
  }
  if (!UUID_PATTERN.test(String(id ?? ''))) return failure('INVALID_DOCUMENT_ID', 'Chứng từ không hợp lệ.');

  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      const document = await repository.getManualInboundDocumentById(client, {
        installationId: requestContext.installationId,
        id,
        forUpdate: true,
      });
      if (!document) return { failed: failure('MANUAL_INBOUND_NOT_FOUND', 'Không tìm thấy chứng từ Nhập kho thủ công.'), skipAudit: true };
      if (!allowedWarehouseIds(requestContext).includes(document.warehouse_id)) {
        return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Chứng từ nằm ngoài phạm vi kho được cấp.'), skipAudit: true };
      }
      const reversal = await reverseInventoryMovement(client, {
        requestContext,
        idempotencyKey,
        movementId: document.movement_id,
        payload,
      });
      if (!reversal.ok) return { failed: reversal, skipAudit: true };
      if (reversal.replayed) {
        const refreshed = await repository.getManualInboundDocumentById(client, {
          installationId: requestContext.installationId,
          id,
        });
        return { ok: true, replayed: true, document: mappedDocument(refreshed), movement: reversal.movement };
      }
      const audit = buildAuditRecord({
        requestContext,
        action: 'inventory.manual_inbound.reverse',
        resourceType: 'manual_inbound_document',
        resourceId: id,
        afterData: { reversalMovementId: reversal.movement.id },
        metadata: { originalMovementId: document.movement_id },
      });
      const event = buildOutboxEvent({
        requestContext,
        aggregateType: 'manual_inbound_document',
        aggregateId: id,
        eventType: 'inventory.manual-inbound.reversed',
        eventVersion: 1,
        payload: { documentId: id, originalMovementId: document.movement_id, reversalMovementId: reversal.movement.id },
        metadata: {},
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, event);
      const refreshed = await repository.getManualInboundDocumentById(client, {
        installationId: requestContext.installationId,
        id,
      });
      return {
        ok: true,
        replayed: false,
        document: mappedDocument(refreshed),
        movement: reversal.movement,
        auditId: audit.auditId,
        eventId: event.eventId,
      };
    },
  });
  return transaction?.failed ?? transaction;
}

export const manualInboundInternals = Object.freeze({
  deterministicDocumentId,
  normalizeManualInboundPayload,
});
