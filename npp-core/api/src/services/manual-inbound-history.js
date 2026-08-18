import { PERMISSIONS } from '../access/permissions.js';
import { getManualInboundHistoryDetail, searchManualInboundDocuments } from '../db/repositories/manual-inbound-history.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INBOUND_TYPES = new Set(['MANUAL_RECEIPT', 'OFF_DOCUMENT_CUSTOMER_RETURN', 'RECOVERY', 'OTHER']);

function failure(code, message, statusCode = 400) {
  return Object.freeze({ ok: false, code, message, statusCode, retryable: false, details: {} });
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function allowedWarehouseIds(requestContext) {
  return [...new Set(
    (Array.isArray(requestContext?.scopes?.warehouseIds) ? requestContext.scopes.warehouseIds : [])
      .map((id) => String(id ?? '').trim())
      .filter((id) => UUID_PATTERN.test(id)),
  )];
}

function optionalText(value, maxLength) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return { ok: true, value: null };
  if (normalized.length > maxLength) return failure('INVALID_SEARCH', 'Điều kiện tìm kiếm quá dài.');
  return { ok: true, value: normalized };
}

export async function searchManualInboundHistory(client, {
  requestContext,
  inboundType,
  referenceNumber,
  limit = 100,
  offset = 0,
}) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundRead)) {
    return failure('PERMISSION_DENIED', 'Không có quyền xem Nhập kho thủ công.', 403);
  }
  const warehouseIds = allowedWarehouseIds(requestContext);
  if (warehouseIds.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'Chưa được cấp phạm vi kho.', 403);

  const normalizedType = String(inboundType ?? '').trim().toUpperCase() || null;
  if (normalizedType && !INBOUND_TYPES.has(normalizedType)) {
    return failure('INVALID_MANUAL_INBOUND_TYPE', 'Loại nhập kho không hợp lệ.');
  }
  const normalizedReference = optionalText(referenceNumber, 160);
  if (!normalizedReference.ok) return normalizedReference;

  const documents = await searchManualInboundDocuments(client, {
    installationId: requestContext.installationId,
    warehouseIds,
    inboundType: normalizedType,
    referenceNumber: normalizedReference.value,
    limit: Math.min(Math.max(Number(limit) || 100, 1), 200),
    offset: Math.max(Number(offset) || 0, 0),
  });

  return Object.freeze({
    ok: true,
    documents: Object.freeze(documents.map((document) => Object.freeze({
      id: document.id,
      inboundType: document.inbound_type,
      warehouseCode: document.warehouse_code,
      warehouseName: document.warehouse_name,
      documentDate: String(document.document_date).slice(0, 10),
      referenceNumber: document.reference_number,
      note: document.note,
      createdAt: document.created_at,
      status: document.reversal_movement_id ? 'REVERSED' : 'POSTED',
      reversalDate: document.reversal_document_date ? String(document.reversal_document_date).slice(0, 10) : null,
      reversalNote: document.reversal_reason_note ?? null,
    }))),
  });
}

export async function readManualInboundHistoryDetail(client, { requestContext, documentId }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundRead)) {
    return failure('PERMISSION_DENIED', 'Không có quyền xem Nhập kho thủ công.', 403);
  }
  const warehouseIds = allowedWarehouseIds(requestContext);
  if (warehouseIds.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'Chưa được cấp phạm vi kho.', 403);
  const normalizedDocumentId = String(documentId ?? '').trim();
  if (!UUID_PATTERN.test(normalizedDocumentId)) {
    return failure('INVALID_MANUAL_INBOUND_ID', 'Chứng từ nhập kho không hợp lệ.');
  }

  const rows = await getManualInboundHistoryDetail(client, {
    installationId: requestContext.installationId,
    warehouseIds,
    documentId: normalizedDocumentId,
  });
  if (!rows.length) return failure('MANUAL_INBOUND_NOT_FOUND', 'Không tìm thấy chứng từ nhập kho trong phạm vi được cấp.', 404);
  const first = rows[0];
  return Object.freeze({
    ok: true,
    detail: Object.freeze({
      documentId: first.document_id,
      documentDate: String(first.document_date).slice(0, 10),
      referenceNumber: first.reference_number ?? null,
      warehouseCode: first.warehouse_code,
      warehouseName: first.warehouse_name,
      lines: Object.freeze(rows.map((row) => Object.freeze({
        baseVariantId: row.base_variant_id,
        sku: row.sku,
        productName: row.product_name ?? null,
        baseUnitCode: row.base_unit_code ?? null,
        quantityBefore: row.quantity_before,
        quantityDelta: row.quantity_delta,
        quantityAfter: row.quantity_after,
      }))),
    }),
  });
}
