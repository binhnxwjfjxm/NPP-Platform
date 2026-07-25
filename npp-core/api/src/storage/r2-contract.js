import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import { buildR2ObjectKey } from './object-key.js';
import { createStorageError, STORAGE_ERROR_CODES } from './errors.js';

const DEFAULT_CONTENT_TYPE = 'text/plain; charset=utf-8';
const DEFAULT_PAYLOAD = 'npp-r2-contract-check';
const MAX_CONTRACT_BYTES = 4096;

function validationError(message) {
  return createStorageError(STORAGE_ERROR_CODES.keyInvalid, message, {
    retryable: false,
    statusCode: 400,
  });
}

export function normalizeR2ContractPayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw validationError('Storage contract payload must be an object');
  }

  const namespace = typeof payload.namespace === 'string' && payload.namespace.trim()
    ? payload.namespace.trim()
    : 'contracts';
  const filename = typeof payload.filename === 'string' && payload.filename.trim()
    ? payload.filename.trim()
    : 'contract-check.txt';
  const contentType = typeof payload.contentType === 'string' && payload.contentType.trim()
    ? payload.contentType.trim().slice(0, 255)
    : DEFAULT_CONTENT_TYPE;
  const content = payload.content === undefined ? DEFAULT_PAYLOAD : payload.content;

  if (typeof content !== 'string') throw validationError('Storage contract content must be a string');
  const body = Buffer.from(content, 'utf8');
  if (body.byteLength > MAX_CONTRACT_BYTES) {
    throw createStorageError(STORAGE_ERROR_CODES.objectTooLarge, 'Storage contract payload is too large', {
      retryable: false,
      statusCode: 413,
      details: { maxContractBytes: MAX_CONTRACT_BYTES },
    });
  }

  return Object.freeze({ namespace, filename, contentType, body });
}

async function compensateDelete(storageAdapter, requestContext, key) {
  try {
    await storageAdapter.deleteObject({
      installationId: requestContext.installationId,
      key,
    });
  } catch {
    throw createStorageError(
      STORAGE_ERROR_CODES.auditCleanupFailed,
      'Storage contract cleanup failed',
      { retryable: true, statusCode: 503 },
    );
  }
}

export async function executeR2ContractOperation({
  storageAdapter,
  auditAdapter,
  requestContext,
  payload,
  now = new Date(),
  uuid,
} = {}) {
  if (!storageAdapter) {
    throw createStorageError(STORAGE_ERROR_CODES.disabled, 'R2 storage is disabled', {
      retryable: false,
      statusCode: 503,
    });
  }
  if (!auditAdapter || typeof auditAdapter.connect !== 'function') {
    throw createStorageError(STORAGE_ERROR_CODES.auditFailed, 'Storage audit is unavailable', {
      retryable: true,
      statusCode: 503,
    });
  }
  if (!requestContext?.installationId || !requestContext?.requestId) {
    throw validationError('Server-owned request context is required');
  }

  const normalized = normalizeR2ContractPayload(payload);
  const key = buildR2ObjectKey({
    installationId: requestContext.installationId,
    namespace: normalized.namespace,
    filename: normalized.filename,
    now,
    ...(uuid ? { uuid } : {}),
  });

  let uploaded = false;
  let uploadResult;
  let headResult;

  try {
    uploadResult = await storageAdapter.putObject({
      installationId: requestContext.installationId,
      key,
      body: normalized.body,
      contentType: normalized.contentType,
      contentLength: normalized.body.byteLength,
      metadata: {
        request_id: requestContext.requestId,
        source_app: requestContext.sourceApp,
      },
      cacheControl: 'no-store',
    });
    uploaded = true;
    headResult = await storageAdapter.headObject({
      installationId: requestContext.installationId,
      key,
    });
  } catch (error) {
    if (uploaded) await compensateDelete(storageAdapter, requestContext, key);
    throw error;
  }

  let auditId;
  try {
    const auditRecord = buildAuditRecord({
      requestContext,
      action: 'core.storage.r2.contract',
      resourceType: 'storage.object',
      resourceId: key,
      afterData: {
        key,
        contentType: headResult.contentType ?? uploadResult.contentType,
        size: headResult.size ?? uploadResult.size,
        result: 'verified',
      },
      metadata: { adapter: 'r2' },
    });

    const auditResult = await withAuditOutboxTransaction({
      adapter: auditAdapter,
      mutate: async (client) => {
        await insertAuditRecord(client, auditRecord);
        return { auditId: auditRecord.auditId };
      },
    });
    auditId = auditResult.auditId;
  } catch {
    await compensateDelete(storageAdapter, requestContext, key);
    throw createStorageError(STORAGE_ERROR_CODES.auditFailed, 'Storage audit failed', {
      retryable: true,
      statusCode: 503,
    });
  }

  const deletion = await storageAdapter.deleteObject({
    installationId: requestContext.installationId,
    key,
  });

  return Object.freeze({
    key,
    size: headResult.size ?? uploadResult.size,
    contentType: headResult.contentType ?? uploadResult.contentType,
    etag: headResult.etag ?? uploadResult.etag ?? null,
    checksumSha256: uploadResult.checksumSha256 ?? null,
    auditId,
    deleted: deletion.deleted,
  });
}
