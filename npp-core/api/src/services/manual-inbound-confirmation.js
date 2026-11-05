import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import { PERMISSIONS } from '../access/permissions.js';
import { getManualInboundConfirmationStatus, postManualInbound } from './manual-inbound.js';
import {
  validateManualInboundPostInventoryPolicy,
} from './manual-inbound-preparation.js';
import { previewManualInboundOperator as previewManualInbound } from './manual-inbound-operator-preview.js';

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
      ...(preview.header.supplierId ? {
        supplierId: preview.header.supplierId,
        supplierCode: preview.header.supplierCode,
        supplierName: preview.header.supplierName,
      } : {}),
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


/*
 * A confirmation can time out in the browser while the backend is still
 * validating or committing. Lock before preview (not only during ledger
 * posting) so a same-key retry never races a request still in preflight.
 * Session-level locks are required because postManualInbound owns a separate
 * database transaction/connection. Never keep the lock after the operation.
 */
async function withConfirmationGuard(adapter, requestContext, idempotencyKey, operation) {
  const scope = `manual-inbound-confirm:${requestContext.installationId}:${idempotencyKey}`;
  const client = await adapter.connect();
  let acquired = false;
  let releaseFailure = null;
  try {
    const result = await client.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [scope],
    );
    acquired = result.rows?.[0]?.acquired === true;
    if (!acquired) {
      return Object.freeze({
        ok: false,
        code: 'MANUAL_INBOUND_CONFIRM_IN_PROGRESS',
        message: 'Phiếu nhập đang được xử lý. Hãy kiểm tra trạng thái trước khi thử lại.',
        statusCode: 409,
        retryable: true,
        details: {},
      });
    }
    return await operation(client);
  } finally {
    if (acquired) {
      try {
        const unlocked = await client.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released',
          [scope],
        );
        if (unlocked.rows?.[0]?.released !== true) {
          throw new Error('manual_inbound_confirmation_guard_release_failed');
        }
      } catch (error) {
        releaseFailure = error;
      }
    }
    client.release(releaseFailure || undefined);
    if (releaseFailure) throw releaseFailure;
  }
}

export async function readManualInboundConfirmationStatus({ adapter, requestContext, idempotencyKey }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPost)) {
    return failure('PERMISSION_DENIED', 'Không có quyền xác nhận Nhập kho thủ công.', 403);
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key không hợp lệ.');
  }
  const status = await withConfirmationGuard(
    adapter, requestContext, idempotencyKey,
    (client) => getManualInboundConfirmationStatus(client, { requestContext, idempotencyKey }),
  );
  if (status.code === 'MANUAL_INBOUND_CONFIRM_IN_PROGRESS') {
    return Object.freeze({ ok: true, posted: false, processing: true, document: null });
  }
  return status.ok ? Object.freeze({ ...status, processing: false }) : status;
}

export async function confirmManualInbound({ adapter, requestContext, idempotencyKey, payload }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPost)) {
    return failure('PERMISSION_DENIED', 'Không có quyền xác nhận Nhập kho thủ công.', 403);
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key không hợp lệ.');
  }

  return withConfirmationGuard(adapter, requestContext, idempotencyKey, async (client) => {
    // A previously committed confirmation takes priority over a fresh preview.
    // Product availability/policy may have changed since the original posting.
    const previous = await getManualInboundConfirmationStatus(client, { requestContext, idempotencyKey });
    if (!previous.ok) return previous;
    if (previous.posted) {
      return Object.freeze({ ok: true, replayed: true, document: previous.document });
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
      adapter, requestContext, idempotencyKey, payload: postingPayload,
    });
  });
}

export const manualInboundConfirmationInternals = Object.freeze({
  buildPostingPayload,
  withConfirmationGuard,
});
