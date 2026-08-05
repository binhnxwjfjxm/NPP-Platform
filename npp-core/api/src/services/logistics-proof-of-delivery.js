import { createHash, randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
} from '../audit-outbox.js';
import { buildR2ObjectKey } from '../storage/object-key.js';
import * as driverRepository from '../db/repositories/logistics-driver-delivery.js';
import * as repository from '../db/repositories/logistics-proof-of-delivery.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const POD_TYPES = new Set(['photo', 'signature', 'otp', 'manual_confirm']);
const PHOTO_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const MAX_CAPTURE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CAPTURE_FUTURE_MS = 5 * 60 * 1000;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter((value) => UUID_PATTERN.test(value)))]
    : [];
}

function normalizedText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function normalizeCapturedAt(value, now = new Date()) {
  const normalized = normalizedText(value, 64);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  const delta = parsed.getTime() - now.getTime();
  if (delta > MAX_CAPTURE_FUTURE_MS || delta < -MAX_CAPTURE_AGE_MS) return null;
  return parsed.toISOString();
}

function decodeBase64(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, '');
  if (!normalized || !BASE64_PATTERN.test(normalized)) return null;
  const body = Buffer.from(normalized, 'base64');
  if (!body.length || body.toString('base64') !== normalized) return null;
  return body;
}

function normalizeProofPayload(payload, { maxObjectBytes, now = new Date() }) {
  const podType = String(payload?.podType ?? '').trim().toLowerCase();
  if (!POD_TYPES.has(podType)) return failure('INVALID_POD_TYPE', 'POD type is invalid');

  const capturedAt = normalizeCapturedAt(payload?.capturedAt ?? now.toISOString(), now);
  if (!capturedAt) return failure('INVALID_POD_CAPTURE_TIME', 'POD capture time is invalid');

  const receiverName = payload?.receiverName == null ? null : normalizedText(payload.receiverName, 200);
  if (payload?.receiverName != null && !receiverName) {
    return failure('INVALID_POD_RECEIVER_NAME', 'Receiver name is invalid');
  }
  const confirmationReference = payload?.confirmationReference == null
    ? null
    : normalizedText(payload.confirmationReference, 200);
  if (payload?.confirmationReference != null && !confirmationReference) {
    return failure('INVALID_POD_CONFIRMATION_REFERENCE', 'POD confirmation reference is invalid');
  }
  const note = payload?.note == null ? null : normalizedText(payload.note, 2000);
  if (payload?.note != null && !note) return failure('INVALID_POD_NOTE', 'POD note is invalid');

  let file = null;
  if (podType === 'photo') {
    const originalFilename = normalizedText(payload?.fileName, 180);
    const contentType = normalizedText(payload?.contentType, 128)?.toLowerCase() ?? null;
    const body = decodeBase64(payload?.contentBase64);
    if (!originalFilename || !contentType || !PHOTO_CONTENT_TYPES.has(contentType) || !body) {
      return failure('INVALID_POD_PHOTO', 'POD photo data is invalid');
    }
    if (!Number.isInteger(maxObjectBytes) || maxObjectBytes < 1) {
      return failure('POD_STORAGE_CONFIGURATION_INVALID', 'POD storage configuration is invalid', true);
    }
    if (body.byteLength > maxObjectBytes) {
      return failure('POD_PHOTO_TOO_LARGE', 'POD photo exceeds the configured size limit', false, {
        maxObjectBytes,
      });
    }
    file = Object.freeze({
      body,
      originalFilename,
      contentType,
      byteSize: body.byteLength,
      checksumSha256: createHash('sha256').update(body).digest('hex'),
    });
  } else if (payload?.contentBase64 != null || payload?.fileName != null || payload?.contentType != null) {
    return failure('POD_FILE_FORBIDDEN', 'Only photo POD can contain a file');
  }

  if (podType === 'signature' && !receiverName && !confirmationReference) {
    return failure('POD_SIGNATURE_REFERENCE_REQUIRED', 'Signature POD requires receiver or reference');
  }
  if (podType === 'otp' && !confirmationReference) {
    return failure('POD_OTP_REFERENCE_REQUIRED', 'OTP POD requires a confirmation reference');
  }
  if (podType === 'manual_confirm' && !receiverName && !note) {
    return failure('POD_MANUAL_CONFIRMATION_REQUIRED', 'Manual confirmation requires receiver or note');
  }

  const canonicalPayload = Object.freeze({
    podType,
    capturedAt,
    receiverName,
    confirmationReference,
    note,
    file: file
      ? Object.freeze({
          originalFilename: file.originalFilename,
          contentType: file.contentType,
          byteSize: file.byteSize,
          checksumSha256: file.checksumSha256,
        })
      : null,
  });
  return Object.freeze({
    ok: true,
    normalized: Object.freeze({
      ...canonicalPayload,
      file,
      payloadHash: payloadHash(canonicalPayload),
    }),
  });
}

function mapProof(row, download = {}) {
  return Object.freeze({
    id: row.id,
    deliveryAttemptId: row.delivery_attempt_id,
    tripId: row.trip_id,
    assignmentId: row.assignment_id,
    deliveryOrderId: row.delivery_order_id,
    driverProfileId: row.driver_profile_id,
    podType: row.pod_type,
    receiverName: row.receiver_name ?? null,
    confirmationReference: row.confirmation_reference ?? null,
    note: row.note ?? null,
    capturedAt: row.captured_at,
    file: row.object_key
      ? Object.freeze({
          fileName: row.original_filename,
          contentType: row.content_type,
          byteSize: Number(row.byte_size),
          checksumSha256: row.checksum_sha256,
          downloadUrl: download.url ?? null,
          downloadExpiresIn: download.expiresIn ?? null,
        })
      : null,
  });
}

async function resolveDriver(client, requestContext, permission) {
  if (!hasPermission(requestContext, 'core.delivery-trip.driver-read')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-trip.driver-read is required');
  }
  if (!hasPermission(requestContext, permission)) {
    return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  }
  if (!UUID_PATTERN.test(String(requestContext?.employeeId ?? ''))) {
    return failure('DELIVERY_DRIVER_IDENTITY_REQUIRED', 'A trusted employee identity is required');
  }
  const scopes = warehouseIds(requestContext);
  if (scopes.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'Driver has no authorized warehouse scope');
  const driver = await driverRepository.getActiveDriverByEmployee(client, {
    installationId: requestContext.installationId,
    employeeId: requestContext.employeeId,
  });
  if (!driver) return failure('DELIVERY_DRIVER_PROFILE_NOT_FOUND', 'Active driver profile was not found');
  return Object.freeze({ ok: true, driver, warehouseIds: Object.freeze(scopes) });
}

async function withDownloadUrl(storageAdapter, requestContext, row) {
  if (!row.object_key || !storageAdapter) return mapProof(row);
  try {
    const signed = await storageAdapter.createPresignedGetUrl({
      installationId: requestContext.installationId,
      key: row.object_key,
      expiresIn: 300,
      downloadFilename: row.original_filename,
    });
    return mapProof(row, signed);
  } catch {
    return mapProof(row);
  }
}

function proofEventKey(idempotencyKey, attemptId) {
  return `pod:${payloadHash({ idempotencyKey, attemptId }).slice(0, 48)}`;
}

function knownDatabaseFailure(error) {
  const message = String(error?.message ?? '');
  const mappings = [
    ['delivery_attempt_proofs_idempotency_unique', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used by another POD'],
    ['delivery_attempt_proofs_object_key_unique', 'POD_OBJECT_CONFLICT', 'POD object was already recorded'],
    ['delivery_attempt_proof_lineage_mismatch', 'POD_LINEAGE_MISMATCH', 'POD does not match delivery attempt lineage'],
  ];
  for (const [needle, code, publicMessage] of mappings) {
    if (message.includes(needle) || error?.constraint === needle) {
      return failure(code, publicMessage);
    }
  }
  return null;
}

export async function attachDriverProof({
  adapter,
  storageAdapter,
  requestContext,
  tripId,
  assignmentId,
  attemptId,
  idempotencyKey,
  payload,
  maxObjectBytes,
}) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  if (!UUID_PATTERN.test(String(assignmentId ?? ''))) return failure('INVALID_ASSIGNMENT_ID', 'Assignment id is invalid');
  if (!UUID_PATTERN.test(String(attemptId ?? ''))) return failure('INVALID_DELIVERY_ATTEMPT_ID', 'Delivery attempt id is invalid');
  if (!IDEMPOTENCY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must use 1-128 safe characters');
  }

  const now = new Date();
  const parsed = normalizeProofPayload(payload, { maxObjectBytes, now });
  if (!parsed.ok) return parsed;
  const normalized = parsed.normalized;
  if (normalized.podType === 'photo' && !storageAdapter) {
    return failure('POD_STORAGE_UNAVAILABLE', 'Photo storage is not configured', true);
  }

  const client = await adapter.connect();
  let uploadedObjectKey = null;
  try {
    await client.query('BEGIN');
    const identity = await resolveDriver(client, requestContext, 'core.pod.attach');
    if (!identity.ok) {
      await client.query('ROLLBACK');
      return identity;
    }
    await repository.setProofOfDeliveryWriteContext(client);
    await repository.lockProofOfDeliveryKey(client, {
      installationId: requestContext.installationId,
      attemptId,
      idempotencyKey,
    });
    const lineage = await repository.getAttemptForDriver(client, {
      installationId: requestContext.installationId,
      tripId,
      assignmentId,
      attemptId,
      driverProfileId: identity.driver.id,
      warehouseIds: identity.warehouseIds,
    });
    if (!lineage) {
      await client.query('ROLLBACK');
      return failure('DELIVERY_ATTEMPT_NOT_FOUND', 'Delivery attempt was not found');
    }

    const keyed = await repository.getProofByIdempotencyKey(client, {
      installationId: requestContext.installationId,
      idempotencyKey,
    });
    if (keyed) {
      if (keyed.delivery_attempt_id !== attemptId || keyed.payload_hash !== normalized.payloadHash) {
        await client.query('ROLLBACK');
        return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another POD payload');
      }
      await client.query('COMMIT');
      return Object.freeze({
        ok: true,
        proof: await withDownloadUrl(storageAdapter, requestContext, keyed),
        replayed: true,
      });
    }

    const proofId = randomUUID();
    let stored = null;
    if (normalized.file) {
      const key = buildR2ObjectKey({
        installationId: requestContext.installationId,
        namespace: 'images',
        filename: normalized.file.originalFilename,
        uuid: proofId,
        now,
      });
      stored = await storageAdapter.putObject({
        installationId: requestContext.installationId,
        key,
        body: normalized.file.body,
        contentType: normalized.file.contentType,
        contentLength: normalized.file.byteSize,
        checksumSha256: normalized.file.checksumSha256,
        cacheControl: 'private, no-store',
        metadata: {
          purpose: 'proof-of-delivery',
          attempt_id: attemptId,
          proof_id: proofId,
        },
      });
      uploadedObjectKey = stored.key;
    }

    const inserted = await repository.insertProof(client, {
      id: proofId,
      installationId: requestContext.installationId,
      deliveryAttemptId: attemptId,
      tripId: lineage.trip_id,
      tripStopId: lineage.trip_stop_id,
      assignmentId: lineage.assignment_id,
      deliveryOrderId: lineage.delivery_order_id,
      driverProfileId: lineage.driver_profile_id,
      podType: normalized.podType,
      objectKey: stored?.key ?? null,
      originalFilename: normalized.file?.originalFilename ?? null,
      contentType: normalized.file?.contentType ?? null,
      byteSize: normalized.file?.byteSize ?? null,
      checksumSha256: normalized.file?.checksumSha256 ?? null,
      receiverName: normalized.receiverName,
      confirmationReference: normalized.confirmationReference,
      note: normalized.note,
      capturedAt: normalized.capturedAt,
      idempotencyKey,
      payloadHash: normalized.payloadHash,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
    });
    const snapshot = mapProof(inserted);

    await repository.insertProofTripEvent(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      tripId: lineage.trip_id,
      idempotencyKey: proofEventKey(idempotencyKey, attemptId),
      payloadHash: normalized.payloadHash,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      metadata: {
        proofId,
        attemptId,
        assignmentId: lineage.assignment_id,
        deliveryOrderId: lineage.delivery_order_id,
        podType: normalized.podType,
        hasFile: Boolean(stored),
      },
      occurredAt: normalized.capturedAt,
    });

    await insertAuditRecord(client, buildAuditRecord({
      requestContext,
      action: 'logistics.delivery_attempt.pod_attach',
      resourceType: 'delivery_attempt_proof',
      resourceId: proofId,
      afterData: snapshot,
      metadata: {
        tripId: lineage.trip_id,
        assignmentId: lineage.assignment_id,
        deliveryOrderId: lineage.delivery_order_id,
        warehouseId: lineage.warehouse_id,
      },
      occurredAt: normalized.capturedAt,
    }));
    const outboxNow = new Date().toISOString();
    const outbox = buildOutboxEvent({
      requestContext,
      aggregateType: 'logistics.delivery_attempt',
      aggregateId: attemptId,
      eventType: 'core.delivery_attempt.pod_attached',
      eventVersion: 1,
      payload: snapshot,
      metadata: {
        proofId,
        tripId: lineage.trip_id,
        assignmentId: lineage.assignment_id,
        deliveryOrderId: lineage.delivery_order_id,
        warehouseId: lineage.warehouse_id,
      },
      createdAt: outboxNow,
      availableAt: outboxNow,
    });
    await insertOutboxEvent(client, outbox);
    await client.query('COMMIT');
    uploadedObjectKey = null;
    return Object.freeze({
      ok: true,
      proof: await withDownloadUrl(storageAdapter, requestContext, inserted),
      replayed: false,
      eventId: outbox.eventId,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (uploadedObjectKey && storageAdapter) {
      try {
        await storageAdapter.deleteObject({
          installationId: requestContext.installationId,
          key: uploadedObjectKey,
        });
      } catch {
        console.error(JSON.stringify({
          event: 'pod_orphan_cleanup_failed',
          requestId: requestContext.requestId,
          objectKey: uploadedObjectKey,
        }));
      }
    }
    if (typeof error?.code === 'string' && error.code.startsWith('STORAGE_')) {
      return failure(error.code, error.publicMessage ?? 'POD storage operation failed', Boolean(error.retryable));
    }
    console.error(JSON.stringify({
      event: 'pod_transaction_failed',
      requestId: requestContext.requestId,
      name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
      constraint: typeof error?.constraint === 'string' ? error.constraint.slice(0, 160) : null,
    }));
    return knownDatabaseFailure(error)
      ?? failure('POD_TRANSACTION_FAILED', 'POD transaction failed', true);
  } finally {
    if (typeof client.release === 'function') await client.release();
  }
}

export async function listDriverProofs({
  adapter,
  storageAdapter,
  requestContext,
  tripId,
  assignmentId,
  attemptId,
}) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))
      || !UUID_PATTERN.test(String(assignmentId ?? ''))
      || !UUID_PATTERN.test(String(attemptId ?? ''))) {
    return failure('INVALID_POD_LINEAGE', 'POD lineage is invalid');
  }
  const client = await adapter.connect();
  try {
    await client.query('BEGIN');
    const identity = await resolveDriver(client, requestContext, 'core.pod.read');
    if (!identity.ok) {
      await client.query('ROLLBACK');
      return identity;
    }
    const lineage = await repository.getAttemptForDriver(client, {
      installationId: requestContext.installationId,
      tripId,
      assignmentId,
      attemptId,
      driverProfileId: identity.driver.id,
      warehouseIds: identity.warehouseIds,
    });
    if (!lineage) {
      await client.query('ROLLBACK');
      return failure('DELIVERY_ATTEMPT_NOT_FOUND', 'Delivery attempt was not found');
    }
    const rows = await repository.listProofs(client, {
      installationId: requestContext.installationId,
      attemptId,
    });
    await client.query('COMMIT');
    const proofs = await Promise.all(rows.map((row) => withDownloadUrl(storageAdapter, requestContext, row)));
    return Object.freeze({ ok: true, proofs: Object.freeze(proofs) });
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return failure('POD_QUERY_FAILED', 'POD is temporarily unavailable', true);
  } finally {
    if (typeof client.release === 'function') await client.release();
  }
}

export async function listDispatcherProofs({
  adapter,
  storageAdapter,
  requestContext,
  tripId,
  attemptId,
}) {
  if (!UUID_PATTERN.test(String(tripId ?? '')) || !UUID_PATTERN.test(String(attemptId ?? ''))) {
    return failure('INVALID_POD_LINEAGE', 'POD lineage is invalid');
  }
  if (!hasPermission(requestContext, 'core.pod.read')
      || !hasPermission(requestContext, 'core.delivery-trip.read')) {
    return failure('PERMISSION_DENIED', 'POD read permission is required');
  }
  const scopes = warehouseIds(requestContext);
  if (scopes.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'No authorized warehouse scope');
  try {
    const lineage = await repository.getAttemptForDispatcher(adapter, {
      installationId: requestContext.installationId,
      tripId,
      attemptId,
      warehouseIds: scopes,
    });
    if (!lineage) return failure('DELIVERY_ATTEMPT_NOT_FOUND', 'Delivery attempt was not found');
    const rows = await repository.listProofs(adapter, {
      installationId: requestContext.installationId,
      attemptId,
    });
    const proofs = await Promise.all(rows.map((row) => withDownloadUrl(storageAdapter, requestContext, row)));
    return Object.freeze({ ok: true, proofs: Object.freeze(proofs) });
  } catch {
    return failure('POD_QUERY_FAILED', 'POD is temporarily unavailable', true);
  }
}

export const logisticsProofOfDeliveryInternals = Object.freeze({
  canonicalize,
  payloadHash,
  decodeBase64,
  normalizeCapturedAt,
  normalizeProofPayload,
  proofEventKey,
});
