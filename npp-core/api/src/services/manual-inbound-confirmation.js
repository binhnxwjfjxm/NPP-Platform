import { createHash } from 'node:crypto';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import { PERMISSIONS } from '../access/permissions.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as repository from '../db/repositories/manual-inbound.js';
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

function operatorPayloadHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function buildPostingPayload(preview, requestHash) {
  return Object.freeze({
    warehouseId: preview.warehouse.id,
    inboundType: preview.header.inboundType,
    documentDate: preview.header.documentDate,
    referenceNumber: preview.header.referenceNumber,
    note: preview.header.note,
    metadata: Object.freeze({
      preparedFrom: 'MANUAL_INBOUND_OPERATOR_PREVIEW',
      operatorRequestHash: requestHash,
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
 * Confirm owns one PostgreSQL transaction for preflight + canonical ledger
 * posting, not two pooled connections. The advisory xact lock uses the same
 * scope as inventory-ledger. GET status can therefore tell an active request
 * from an absent receipt, even before the stock movement starts.
 */
function confirmationScope(requestContext, idempotencyKey) {
  return `${requestContext.installationId}:${idempotencyKey}`;
}
async function tryConfirmationLock(client, requestContext, idempotencyKey) {
  const result = await client.query(
    'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
    [confirmationScope(requestContext, idempotencyKey)],
  );
  return result.rows?.[0]?.acquired === true;
}
function validateConfirmation(requestContext, idempotencyKey) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPost))
    return failure('PERMISSION_DENIED', 'Không có quyền xác nhận Nhập kho thủ công.', 403);
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? '')))
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key không hợp lệ.');
  return null;
}
function inProgressFailure() {
  return Object.freeze({
    ok: false, code: 'MANUAL_INBOUND_CONFIRM_IN_PROGRESS', statusCode: 409,
    message: 'Phiếu nhập đang được xử lý. Hãy kiểm tra trạng thái trước khi thử lại.',
    retryable: true, details: {},
  });
}

export async function readManualInboundConfirmationStatus({ adapter, requestContext, idempotencyKey }) {
  const invalid = validateConfirmation(requestContext, idempotencyKey);
  if (invalid) return invalid;
  const client = await adapter.connect();
  let finished = false;
  let broken = false;
  try {
    await client.query('BEGIN');
    if (!await tryConfirmationLock(client, requestContext, idempotencyKey)) {
      await client.query('ROLLBACK');
      finished = true;
      return Object.freeze({ ok: true, posted: false, processing: true, document: null });
    }
    const status = await getManualInboundConfirmationStatus(client, { requestContext, idempotencyKey });
    const cancelled = status.ok && !status.posted
      ? await repository.getManualInboundConfirmationCancellation(client, {
        installationId: requestContext.installationId, idempotencyKey,
      }) : null;
    await client.query('COMMIT');
    finished = true;
    return status.ok
      ? Object.freeze({ ...status, processing: false, cancelled: Boolean(cancelled) })
      : status;
  } catch (error) {
    if (!finished) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

export async function confirmManualInbound({ adapter, requestContext, idempotencyKey, payload }) {
  const invalid = validateConfirmation(requestContext, idempotencyKey);
  if (invalid) return invalid;
  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      // A concurrent request must not re-validate stale product data or post
      // while another confirmation with the same key is still in progress.
      if (!await tryConfirmationLock(client, requestContext, idempotencyKey))
        return { failed: inProgressFailure(), skipAudit: true };
      // Replay the previous committed receipt BEFORE preview: policies, stock,
      // prices or products may have changed since the earlier confirmation.
      const previous = await getManualInboundConfirmationStatus(client, { requestContext, idempotencyKey });
      if (!previous.ok) return { failed: previous, skipAudit: true };
      if (previous.posted) {
        // New receipts pin the exact original operator payload to the key.
        // Older receipts without this metadata remain readable/replayable.
        const expectedHash = previous.operatorRequestHash;
        if (expectedHash && expectedHash !== operatorPayloadHash(payload)) {
          return {
            failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH',
              'Khóa xác nhận đã dùng cho một phiếu nhập có nội dung khác.', 409),
            skipAudit: true,
          };
        }
        return Object.freeze({ ok: true, replayed: true, document: previous.document });
      }
      // A cancelled intent is terminal. A delayed retry using the original key
      // must never create a stock movement or a new receipt.
      const cancelled = await repository.getManualInboundConfirmationCancellation(client, {
        installationId: requestContext.installationId, idempotencyKey,
      });
      if (cancelled) return {
        failed: failure('MANUAL_INBOUND_CONFIRMATION_CANCELLED',
          'Yêu cầu nhập trước đã kết thúc và không được ghi sổ. Hãy kiểm tra lại dữ liệu trước khi xác nhận phiếu mới.', 409),
        skipAudit: true,
      };

      const prepared = await previewManualInbound(client, { requestContext, payload });
      if (!prepared.ok) return { failed: prepared, skipAudit: true };
      if (!prepared.preview.ready) return {
        failed: failure('MANUAL_INBOUND_NOT_READY',
          'Dữ liệu còn thiếu hoặc chưa hợp lệ. Hãy kiểm tra lại trước khi xác nhận nhập.',
          409, { rowErrors: prepared.preview.rowErrors }),
        skipAudit: true,
      };
      const postingPayload = buildPostingPayload(prepared.preview, operatorPayloadHash(payload));
      const policy = await validateManualInboundPostInventoryPolicy(client, {
        requestContext, rows: postingPayload.rows,
      });
      if (!policy.ok) return { failed: policy, skipAudit: true };

      const posted = await postManualInbound({
        transactionClient: client, requestContext, idempotencyKey, payload: postingPayload,
      });
      return posted.ok ? posted : { failed: posted, skipAudit: true };
    },
  });
  return transaction?.failed ?? transaction;
}


/**
 * Atomically close an uncertain, unposted confirmation. Status/read and close
 * acquire the exact same advisory lock as confirm; a late POST cannot post
 * afterwards because every confirm checks this immutable cancellation record.
 */
export async function cancelUnpostedManualInboundConfirmation({ adapter, requestContext, idempotencyKey }) {
  const invalid = validateConfirmation(requestContext, idempotencyKey);
  if (invalid) return invalid;
  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      if (!await tryConfirmationLock(client, requestContext, idempotencyKey))
        return { failed: inProgressFailure(), skipAudit: true };
      const previous = await getManualInboundConfirmationStatus(client, { requestContext, idempotencyKey });
      if (!previous.ok) return { failed: previous, skipAudit: true };
      if (previous.posted)
        return Object.freeze({ ok: true, replayed: true, posted: true, cancelled: false, document: previous.document });
      const existing = await repository.getManualInboundConfirmationCancellation(client, {
        installationId: requestContext.installationId, idempotencyKey,
      });
      if (existing)
        return Object.freeze({ ok: true, replayed: true, posted: false, cancelled: true, document: null });

      const closed = await repository.insertManualInboundConfirmationCancellation(client, {
        installationId: requestContext.installationId,
        idempotencyKey,
        cancelledBy: requestContext.actorId,
        requestId: requestContext.requestId,
      });
      if (!closed) throw new Error('manual_inbound_cancel_insert_not_confirmed');
      await insertAuditRecord(client, buildAuditRecord({
        requestContext,
        action: 'inventory.manual_inbound.confirmation_cancelled',
        resourceType: 'manual_inbound_confirmation',
        resourceId: idempotencyKey,
        afterData: { cancelled: true, posted: false },
      }));
      return Object.freeze({ ok: true, posted: false, cancelled: true, document: null });
    },
  });
  return transaction?.failed ?? transaction;
}

export const manualInboundConfirmationInternals = Object.freeze({
  buildPostingPayload,
  tryConfirmationLock,
  confirmationScope,
});
