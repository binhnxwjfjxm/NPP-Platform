import { PERMISSIONS } from '../access/permissions.js';
import { postManualInbound } from './manual-inbound.js';
import {
  previewManualInbound,
  validateManualInboundPostInventoryPolicy,
} from './manual-inbound-preparation.js';

function failure(code, message, statusCode = 400, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, retryable: false, details });
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function buildPostingPayload(preview) {
  return Object.freeze({
    warehouseId: preview.warehouse.id,
    inboundType: preview.header.inboundType,
    documentDate: preview.header.documentDate,
    referenceNumber: preview.header.referenceNumber,
    note: preview.header.note,
    metadata: Object.freeze({
      preparedFrom: 'MANUAL_INBOUND_OPERATOR_PREVIEW',
    }),
    rows: Object.freeze(preview.rows.map((row) => Object.freeze({
      sourceVariantId: row.sourceVariantId,
      sourceQuantity: row.sourceQuantity,
      locationId: row.locationId ?? null,
      lotCode: row.lotCode ?? null,
      manufacturedDate: row.manufacturedDate ?? null,
      expiryDate: row.expiryDate ?? null,
      supplierLotReference: row.supplierLotReference ?? null,
      sourceLineReference: `Dong-${row.lineNumber}`,
      unitCost: row.unitCost,
      metadata: Object.freeze({
        sourceLineNumbers: row.sourceLineNumbers,
        manualInboundCostSource: row.costSource,
      }),
    }))),
  });
}

export async function confirmManualInbound({ adapter, requestContext, idempotencyKey, payload }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPost)) {
    return failure('PERMISSION_DENIED', 'Không có quyền xác nhận Nhập kho thủ công.', 403);
  }

  const prepared = await previewManualInbound(adapter, { requestContext, payload });
  if (!prepared.ok) return prepared;
  if (!prepared.preview.ready) {
    return failure(
      'MANUAL_INBOUND_NOT_READY',
      'Dữ liệu còn thiếu hoặc chưa hợp lệ. Hãy kiểm tra lại trước khi xác nhận nhập.',
      409,
      { rowErrors: prepared.preview.rowErrors },
    );
  }

  const postingPayload = buildPostingPayload(prepared.preview);
  const policy = await validateManualInboundPostInventoryPolicy(adapter, {
    requestContext,
    rows: postingPayload.rows,
  });
  if (!policy.ok) return policy;

  return postManualInbound({
    adapter,
    requestContext,
    idempotencyKey,
    payload: postingPayload,
  });
}

export const manualInboundConfirmationInternals = Object.freeze({
  buildPostingPayload,
});
