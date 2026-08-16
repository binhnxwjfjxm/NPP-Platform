import { randomUUID } from 'node:crypto';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as repo from '../db/repositories/backup.js';
import { normalizeBusinessPurgeTarget } from './business-data-purge.js';
import {
  generateOwnerDeletionCode,
  hashOwnerDeletionCode,
  loadOwnerDeletionChallengeRuntime,
  ownerDeletionCodeMatches,
  ownerDeletionRuntimeReady,
  sendOwnerDeletionChallengeEmail,
} from '../backup/owner-delete-challenge.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BACKUP_STALE_MS = 2 * 60 * 60 * 1000;
const DELETE_BACKUP_MAX_AGE_MS = 60 * 60 * 1000;

function text(value) { return String(value ?? '').trim(); }
function resultError(code, statusCode, message, details = {}) { return { ok: false, code, statusCode, message, details }; }
function publicJob(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    status: row.status,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    snapshotAt: row.snapshot_at,
    schemaVersion: row.schema_version,
    verifiedAt: row.verified_at,
    includeXlsx: row.include_xlsx,
    datasetCount: Number(row.dataset_count ?? 0),
    totalRowCount: Number(row.total_row_count ?? 0),
    failureCode: row.failure_code,
    failureMessage: row.failure_message_safe,
    artifacts: Object.freeze({
      databaseDump: row.dump_object_key ? { size: Number(row.dump_size ?? 0), sha256: row.dump_sha256 } : null,
      csvZip: row.csv_object_key ? { size: Number(row.csv_size ?? 0), sha256: row.csv_sha256 } : null,
      xlsx: row.xlsx_object_key ? { size: Number(row.xlsx_size ?? 0), sha256: row.xlsx_sha256 } : null,
      manifest: row.manifest_object_key ? { sha256: row.manifest_sha256 } : null,
    }),
  });
}

async function reconcileStaleBackupJob(pool, { requestContext, now = () => new Date() }) {
  const candidate = await repo.findActiveBackupJob(pool, { installationId: requestContext.installationId });
  if (!candidate) return null;
  const updatedAt = new Date(candidate.updated_at);
  if (!Number.isNaN(updatedAt.getTime()) && (now().getTime() - updatedAt.getTime()) <= BACKUP_STALE_MS) return null;

  const staleBefore = new Date(now().getTime() - BACKUP_STALE_MS);
  const result = await withAuditOutboxTransaction({
    adapter: pool,
    mutate: async (client) => {
      const active = await repo.lockActiveBackupJob(client, { installationId: requestContext.installationId });
      if (!active) return { replayed: true, staleJob: null };
      const activeUpdatedAt = new Date(active.updated_at);
      if (!Number.isNaN(activeUpdatedAt.getTime()) && activeUpdatedAt.getTime() >= staleBefore.getTime()) {
        return { replayed: true, staleJob: null };
      }
      const failed = await repo.failBackupJob(client, {
        installationId: requestContext.installationId,
        jobId: active.id,
        failureCode: 'BACKUP_JOB_INTERRUPTED',
        safeMessage: 'Tiến trình sao lưu trước đó đã bị gián đoạn',
      });
      await insertAuditRecord(client, buildAuditRecord({
        requestContext,
        action: 'backup_interrupted',
        resourceType: 'backup_job',
        resourceId: active.id,
        beforeData: { status: active.status },
        afterData: { status: 'FAILED', failureCode: 'BACKUP_JOB_INTERRUPTED' },
      }));
      return { staleJob: failed };
    },
  });
  return result.staleJob ?? null;
}

export async function createBackupJob(pool, { requestContext, includeXlsx = true, scheduleRun, now = () => new Date() }) {
  await reconcileStaleBackupJob(pool, { requestContext, now });
  const jobId = randomUUID();
  let created;
  try {
    created = await withAuditOutboxTransaction({
      adapter: pool,
      mutate: async (client) => {
        const existing = await repo.findActiveBackupJob(client, { installationId: requestContext.installationId });
        if (existing) return { failed: true, conflict: existing };
        const job = await repo.insertBackupJob(client, {
          id: jobId,
          installationId: requestContext.installationId,
          requestedBy: requestContext.actorId,
          sourceApp: requestContext.sourceApp,
          requestId: requestContext.requestId,
          includeXlsx: includeXlsx !== false,
        });
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action: 'backup_requested',
          resourceType: 'backup_job',
          resourceId: jobId,
          afterData: { status: job.status, includeXlsx: job.include_xlsx },
        }));
        return { job };
      },
    });
  } catch (error) {
    if (error?.code === '23505') {
      const existing = await repo.findActiveBackupJob(pool, { installationId: requestContext.installationId });
      if (existing) return resultError('BACKUP_ALREADY_RUNNING', 409, 'Đã có một bản sao lưu toàn bộ đang chạy', { existingJobId: existing.id });
    }
    throw error;
  }
  if (created.conflict) return resultError('BACKUP_ALREADY_RUNNING', 409, 'Đã có một bản sao lưu toàn bộ đang chạy', { existingJobId: created.conflict.id });
  if (typeof scheduleRun === 'function') scheduleRun(jobId);
  return { ok: true, statusCode: 202, job: publicJob(created.job) };
}

export async function getBackupJob(pool, { installationId, jobId }) {
  if (!UUID_PATTERN.test(text(jobId))) return resultError('BACKUP_JOB_ID_INVALID', 400, 'Mã backup không hợp lệ');
  const job = await repo.getBackupJob(pool, { installationId, jobId });
  return job ? { ok: true, job: publicJob(job) } : resultError('BACKUP_JOB_NOT_FOUND', 404, 'Không tìm thấy bản backup');
}

export async function listBackupJobs(pool, { requestContext, limit = 20, now = () => new Date() }) {
  await reconcileStaleBackupJob(pool, { requestContext, now });
  const safeLimit = Number.isInteger(limit) ? Math.min(50, Math.max(1, limit)) : 20;
  const jobs = await repo.listBackupJobs(pool, { installationId: requestContext.installationId, limit: safeLimit });
  return { ok: true, jobs: jobs.map(publicJob) };
}

function artifactFromJob(job, artifactType) {
  if (artifactType === 'database') return job.dump_object_key ? { key: job.dump_object_key, filename: 'npp-backup.dump' } : null;
  if (artifactType === 'csv') return job.csv_object_key ? { key: job.csv_object_key, filename: 'npp-data.zip' } : null;
  if (artifactType === 'xlsx') return job.xlsx_object_key ? { key: job.xlsx_object_key, filename: 'npp-data.xlsx' } : null;
  if (artifactType === 'manifest') return job.manifest_object_key ? { key: job.manifest_object_key, filename: 'manifest.json' } : null;
  return null;
}

export async function createBackupDownload(pool, storageAdapter, { requestContext, jobId, artifactType, expiresIn = 300 }) {
  if (!storageAdapter) return resultError('BACKUP_STORAGE_UNAVAILABLE', 503, 'Kho lưu trữ backup chưa sẵn sàng');
  if (!UUID_PATTERN.test(text(jobId))) return resultError('BACKUP_JOB_ID_INVALID', 400, 'Mã backup không hợp lệ');
  const job = await repo.getBackupJob(pool, { installationId: requestContext.installationId, jobId });
  if (!job) return resultError('BACKUP_JOB_NOT_FOUND', 404, 'Không tìm thấy bản backup');
  if (job.status !== 'VERIFIED') return resultError('BACKUP_NOT_VERIFIED', 409, 'Chỉ được tải bản backup đã xác minh');
  const artifact = artifactFromJob(job, text(artifactType).toLowerCase());
  if (!artifact) return resultError('BACKUP_ARTIFACT_NOT_FOUND', 404, 'Artifact backup không tồn tại');
  const download = await storageAdapter.createPresignedGetUrl({
    installationId: requestContext.installationId,
    key: artifact.key,
    expiresIn,
    downloadFilename: artifact.filename,
  });
  await withAuditOutboxTransaction({
    adapter: pool,
    mutate: async (client) => {
      await insertAuditRecord(client, buildAuditRecord({
        requestContext,
        action: 'backup_download_requested',
        resourceType: 'backup_job',
        resourceId: jobId,
        afterData: { artifactType: text(artifactType).toLowerCase(), expiresIn: download.expiresIn },
      }));
      return { ok: true };
    },
  });
  return { ok: true, download: { url: download.url, expiresIn: download.expiresIn } };
}

export async function createDeletionIntent(pool, {
  requestContext,
  backupJobId,
  targetCode,
  reason,
  env = process.env,
  ownerConfig = null,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  if (!UUID_PATTERN.test(text(backupJobId))) return resultError('BACKUP_JOB_ID_INVALID', 400, 'Mã backup không hợp lệ');
  const normalizedTargetCode = normalizeBusinessPurgeTarget(targetCode);
  if (!normalizedTargetCode) return resultError('PURGE_TARGET_INVALID', 400, 'Mục dữ liệu cần xóa không hợp lệ');
  const backup = await repo.getBackupJob(pool, { installationId: requestContext.installationId, jobId: backupJobId });
  if (!backup) return resultError('BACKUP_JOB_NOT_FOUND', 404, 'Không tìm thấy bản backup');
  if (backup.status !== 'VERIFIED' || !backup.verified_at || !backup.snapshot_at) {
    return resultError('DELETE_BACKUP_REQUIRED', 409, 'Cần một bản sao lưu đã xác minh trước khi xác nhận xóa dữ liệu');
  }
  const snapshotAt = new Date(backup.snapshot_at);
  if (Number.isNaN(snapshotAt.getTime()) || now().getTime() - snapshotAt.getTime() > DELETE_BACKUP_MAX_AGE_MS) {
    return resultError('DELETE_BACKUP_TOO_OLD', 409, 'Bản sao lưu bảo vệ đã quá cũ cho yêu cầu xóa dữ liệu');
  }
  const runtime = loadOwnerDeletionChallengeRuntime({ env, ownerConfig });
  if (!ownerDeletionRuntimeReady(runtime, fetchImpl)) {
    return resultError('DATA_DELETION_CHALLENGE_UNAVAILABLE', 503, 'Xác minh Owner cho yêu cầu xóa chưa sẵn sàng');
  }
  const intentId = randomUUID();
  const code = generateOwnerDeletionCode();
  const expiresAt = new Date(now().getTime() + runtime.ttlSeconds * 1000).toISOString();
  const normalizedReason = text(reason).slice(0, 1000) || null;
  const transaction = await withAuditOutboxTransaction({
    adapter: pool,
    mutate: async (client) => {
      const intent = await repo.insertDeletionIntent(client, {
        id: intentId,
        installationId: requestContext.installationId,
        backupJobId,
        targetCode: normalizedTargetCode,
        requestedBy: requestContext.actorId,
        sourceApp: requestContext.sourceApp,
        requestId: requestContext.requestId,
        reason: normalizedReason,
        challengeCodeHash: hashOwnerDeletionCode(runtime, intentId, code),
        challengeExpiresAt: expiresAt,
        ownerRecipientCount: runtime.recipients.length,
      });
      await insertAuditRecord(client, buildAuditRecord({
        requestContext,
        action: 'data_deletion_challenge_issued',
        resourceType: 'data_deletion_intent',
        resourceId: intentId,
        afterData: { backupJobId, targetCode: normalizedTargetCode, ownerRecipientCount: runtime.recipients.length, challengeExpiresAt: expiresAt },
      }));
      return { intent };
    },
  });
  try {
    await sendOwnerDeletionChallengeEmail(fetchImpl, runtime, { code, sourceApp: requestContext.sourceApp });
    const delivery = await withAuditOutboxTransaction({
      adapter: pool,
      mutate: async (client) => {
        const sent = await repo.markDeletionChallengeSent(client, { installationId: requestContext.installationId, intentId });
        if (!sent) return { failed: true, deliveryRace: true };
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action: 'data_deletion_challenge_delivered',
          resourceType: 'data_deletion_intent',
          resourceId: intentId,
          afterData: { backupJobId, targetCode: normalizedTargetCode, ownerRecipientCount: runtime.recipients.length },
        }));
        return { sent: true };
      },
    });
    if (!delivery.sent) throw new Error('DATA_DELETION_CHALLENGE_DELIVERY_STATE_FAILED');
  } catch {
    await withAuditOutboxTransaction({
      adapter: pool,
      mutate: async (client) => {
        await repo.failDeletionIntent(client, { installationId: requestContext.installationId, intentId, failureCode: 'DATA_DELETION_CHALLENGE_DELIVERY_FAILED' });
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action: 'data_deletion_challenge_delivery_failed',
          resourceType: 'data_deletion_intent',
          resourceId: intentId,
          afterData: { backupJobId, targetCode: normalizedTargetCode, ownerRecipientCount: runtime.recipients.length },
        }));
        return { ok: true };
      },
    }).catch(() => null);
    return resultError('DATA_DELETION_CHALLENGE_DELIVERY_FAILED', 503, 'Không gửi được mã xác nhận tới toàn bộ Owner');
  }
  return {
    ok: true,
    statusCode: 201,
    intent: {
      id: transaction.intent.id,
      status: 'CHALLENGE_PENDING',
      backupJobId,
      targetCode: normalizedTargetCode,
      challengeExpiresAt: expiresAt,
      ownerRecipientCount: runtime.recipients.length,
    },
  };
}

export async function verifyDeletionIntent(pool, {
  requestContext,
  intentId,
  code,
  env = process.env,
  ownerConfig = null,
  now = () => new Date(),
}) {
  if (!UUID_PATTERN.test(text(intentId))) return resultError('DATA_DELETION_INTENT_ID_INVALID', 400, 'Mã yêu cầu xóa không hợp lệ');
  if (!/^\d{6}$/.test(text(code))) return resultError('DATA_DELETION_CODE_INVALID', 400, 'Mã xác nhận phải gồm 6 chữ số');
  const runtime = loadOwnerDeletionChallengeRuntime({ env, ownerConfig });
  if (runtime.pepper.length < 32) return resultError('DATA_DELETION_CHALLENGE_UNAVAILABLE', 503, 'Xác minh Owner cho yêu cầu xóa chưa sẵn sàng');
  return withAuditOutboxTransaction({
    adapter: pool,
    mutate: async (client) => {
      const intent = await repo.lockDeletionIntent(client, { installationId: requestContext.installationId, intentId });
      if (!intent) return { ...resultError('DATA_DELETION_INTENT_NOT_FOUND', 404, 'Không tìm thấy yêu cầu xóa'), failed: true };
      if (intent.status === 'AUTHORIZED') {
        return {
          ok: true,
          replayed: true,
          intent: {
            id: intent.id,
            status: 'AUTHORIZED',
            backupJobId: intent.backup_job_id,
            targetCode: intent.target_code,
            authorizedAt: intent.authorized_at,
            purgeExecuted: false,
          },
        };
      }
      if (intent.status !== 'CHALLENGE_PENDING') {
        return { ...resultError('DATA_DELETION_INTENT_NOT_ACTIVE', 409, 'Yêu cầu xóa không còn ở trạng thái chờ xác minh'), failed: true };
      }
      if (!intent.challenge_sent_at) {
        return { ...resultError('DATA_DELETION_CHALLENGE_NOT_DELIVERED', 409, 'Mã xác nhận chưa được gửi thành công'), failed: true };
      }
      const expiresAt = new Date(intent.challenge_expires_at);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now().getTime()) {
        await repo.failDeletionIntent(client, { installationId: requestContext.installationId, intentId, failureCode: 'DATA_DELETION_CODE_EXPIRED' });
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action: 'data_deletion_challenge_expired',
          resourceType: 'data_deletion_intent',
          resourceId: intentId,
          afterData: { backupJobId: intent.backup_job_id, targetCode: intent.target_code, status: 'FAILED', failureCode: 'DATA_DELETION_CODE_EXPIRED' },
        }));
        return { ...resultError('DATA_DELETION_CODE_EXPIRED', 410, 'Mã xác nhận đã hết hạn'), expectedAuditCount: 1 };
      }
      const actualHash = hashOwnerDeletionCode(runtime, intentId, text(code));
      if (!ownerDeletionCodeMatches(intent.challenge_code_hash, actualHash)) {
        const rejected = await repo.incrementDeletionChallengeFailure(client, {
          installationId: requestContext.installationId,
          intentId,
          maxAttempts: runtime.maxAttempts,
        });
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action: 'data_deletion_challenge_rejected',
          resourceType: 'data_deletion_intent',
          resourceId: intentId,
          afterData: {
            backupJobId: intent.backup_job_id,
            targetCode: intent.target_code,
            failedAttempts: Number(rejected?.challenge_failed_attempts ?? intent.challenge_failed_attempts ?? 0),
            status: rejected?.status ?? intent.status,
          },
        }));
        return { ...resultError('DATA_DELETION_CODE_INVALID', 401, 'Mã xác nhận không đúng'), expectedAuditCount: 1 };
      }
      const verifiedAt = now().toISOString();
      const authorized = await repo.authorizeDeletionIntent(client, { installationId: requestContext.installationId, intentId, verifiedAt });
      if (!authorized) {
        return { ...resultError('DATA_DELETION_INTENT_NOT_ACTIVE', 409, 'Yêu cầu xóa không còn ở trạng thái chờ xác minh'), failed: true };
      }
      await insertAuditRecord(client, buildAuditRecord({
        requestContext,
        action: 'data_deletion_authorized',
        resourceType: 'data_deletion_intent',
        resourceId: intentId,
        afterData: { backupJobId: authorized.backup_job_id, targetCode: authorized.target_code, authorizedAt: verifiedAt, purgeExecuted: false },
      }));
      return {
        ok: true,
        intent: {
          id: intentId,
          status: 'AUTHORIZED',
          backupJobId: authorized.backup_job_id,
          targetCode: authorized.target_code,
          authorizedAt: verifiedAt,
          purgeExecuted: false,
        },
      };
    },
  });
}
