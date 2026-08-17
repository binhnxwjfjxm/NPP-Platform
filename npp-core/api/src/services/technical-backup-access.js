import { randomUUID } from 'node:crypto';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as repo from '../db/repositories/system-backup.js';
import {
  TECHNICAL_BACKUP_RECIPIENT,
  generateTechnicalBackupCode,
  hashTechnicalBackupCode,
  hashTechnicalBackupUnlockToken,
  issueTechnicalBackupUnlockToken,
  loadTechnicalBackupAccessRuntime,
  parseTechnicalBackupUnlockToken,
  sendTechnicalBackupAccessEmail,
  technicalBackupAccessRuntimeReady,
  technicalBackupCodeMatches,
  technicalBackupUnlockTokenMatches,
} from '../backup/technical-access.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) { return String(value ?? '').trim(); }
function resultError(code, statusCode, message, details = {}) { return { ok: false, code, statusCode, message, details }; }

export async function requestTechnicalBackupChallenge(pool, {
  requestContext,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  const runtime = loadTechnicalBackupAccessRuntime({ env });
  if (!technicalBackupAccessRuntimeReady(runtime, fetchImpl)) {
    return resultError('TECHNICAL_BACKUP_ACCESS_UNAVAILABLE', 503, 'Mở khóa Khu vực kỹ thuật chưa sẵn sàng');
  }
  const challengeId = randomUUID();
  const code = generateTechnicalBackupCode();
  const challengeExpiresAt = new Date(now().getTime() + runtime.challengeTtlSeconds * 1000).toISOString();

  await withAuditOutboxTransaction({
    adapter: pool,
    mutate: async (client) => {
      await repo.revokeTechnicalBackupAccess(client, {
        installationId: requestContext.installationId,
        requestedBy: requestContext.actorId,
      });
      await repo.insertTechnicalBackupChallenge(client, {
        id: challengeId,
        installationId: requestContext.installationId,
        requestedBy: requestContext.actorId,
        sourceApp: requestContext.sourceApp,
        requestId: requestContext.requestId,
        recipientEmail: TECHNICAL_BACKUP_RECIPIENT,
        challengeCodeHash: hashTechnicalBackupCode(runtime, challengeId, code),
        challengeExpiresAt,
      });
      await insertAuditRecord(client, buildAuditRecord({
        requestContext,
        action: 'technical_backup_challenge_issued',
        resourceType: 'technical_backup_access',
        resourceId: challengeId,
        afterData: { challengeExpiresAt, recipient: TECHNICAL_BACKUP_RECIPIENT },
      }));
      return { created: true };
    },
  });

  try {
    await sendTechnicalBackupAccessEmail(fetchImpl, runtime, { code, challengeId });
    const delivery = await withAuditOutboxTransaction({
      adapter: pool,
      mutate: async (client) => {
        const sent = await repo.markTechnicalBackupChallengeSent(client, {
          installationId: requestContext.installationId,
          challengeId,
        });
        if (!sent) return { failed: true, deliveryRace: true };
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action: 'technical_backup_challenge_delivered',
          resourceType: 'technical_backup_access',
          resourceId: challengeId,
          afterData: { recipient: TECHNICAL_BACKUP_RECIPIENT },
        }));
        return { sent: true };
      },
    });
    if (!delivery.sent) throw new Error('TECHNICAL_BACKUP_CHALLENGE_DELIVERY_STATE_FAILED');
  } catch {
    await withAuditOutboxTransaction({
      adapter: pool,
      mutate: async (client) => {
        await repo.failTechnicalBackupChallenge(client, {
          installationId: requestContext.installationId,
          challengeId,
          failureCode: 'TECHNICAL_BACKUP_CHALLENGE_DELIVERY_FAILED',
        });
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action: 'technical_backup_challenge_delivery_failed',
          resourceType: 'technical_backup_access',
          resourceId: challengeId,
          afterData: { recipient: TECHNICAL_BACKUP_RECIPIENT },
        }));
        return { failedDelivery: true };
      },
    }).catch(() => null);
    return resultError('TECHNICAL_BACKUP_CHALLENGE_DELIVERY_FAILED', 503, 'Không gửi được mã mở khóa Khu vực kỹ thuật');
  }

  return {
    ok: true,
    statusCode: 201,
    challenge: {
      id: challengeId,
      challengeExpiresAt,
      recipient: TECHNICAL_BACKUP_RECIPIENT,
    },
  };
}

export async function verifyTechnicalBackupChallenge(pool, {
  requestContext,
  challengeId,
  code,
  env = process.env,
  now = () => new Date(),
}) {
  if (!UUID_PATTERN.test(text(challengeId))) return resultError('TECHNICAL_BACKUP_CHALLENGE_ID_INVALID', 400, 'Mã yêu cầu mở khóa không hợp lệ');
  if (!/^\d{6}$/.test(text(code))) return resultError('TECHNICAL_BACKUP_CODE_INVALID', 400, 'Mã xác nhận phải gồm 6 chữ số');
  const runtime = loadTechnicalBackupAccessRuntime({ env });
  if (runtime.pepper.length < 32) return resultError('TECHNICAL_BACKUP_ACCESS_UNAVAILABLE', 503, 'Mở khóa Khu vực kỹ thuật chưa sẵn sàng');

  return withAuditOutboxTransaction({
    adapter: pool,
    mutate: async (client) => {
      const challenge = await repo.lockTechnicalBackupChallenge(client, {
        installationId: requestContext.installationId,
        challengeId,
        requestedBy: requestContext.actorId,
      });
      if (!challenge) return { ...resultError('TECHNICAL_BACKUP_CHALLENGE_NOT_FOUND', 404, 'Không tìm thấy yêu cầu mở khóa'), failed: true };
      if (challenge.status !== 'CHALLENGE_PENDING') {
        return { ...resultError('TECHNICAL_BACKUP_CHALLENGE_NOT_ACTIVE', 409, 'Yêu cầu mở khóa không còn hiệu lực'), failed: true };
      }
      if (!challenge.challenge_sent_at) {
        return { ...resultError('TECHNICAL_BACKUP_CHALLENGE_NOT_DELIVERED', 409, 'Mã mở khóa chưa được gửi thành công'), failed: true };
      }
      const expiresAt = new Date(challenge.challenge_expires_at);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now().getTime()) {
        await repo.failTechnicalBackupChallenge(client, {
          installationId: requestContext.installationId,
          challengeId,
          failureCode: 'TECHNICAL_BACKUP_CHALLENGE_EXPIRED',
          status: 'EXPIRED',
        });
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action: 'technical_backup_challenge_expired',
          resourceType: 'technical_backup_access',
          resourceId: challengeId,
          afterData: { status: 'EXPIRED' },
        }));
        return { ...resultError('TECHNICAL_BACKUP_CHALLENGE_EXPIRED', 410, 'Mã mở khóa đã hết hạn'), expectedAuditCount: 1 };
      }
      const actualHash = hashTechnicalBackupCode(runtime, challengeId, text(code));
      if (!technicalBackupCodeMatches(challenge.challenge_code_hash, actualHash)) {
        const rejected = await repo.incrementTechnicalBackupChallengeFailure(client, {
          installationId: requestContext.installationId,
          challengeId,
          maxAttempts: runtime.maxAttempts,
        });
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action: 'technical_backup_challenge_rejected',
          resourceType: 'technical_backup_access',
          resourceId: challengeId,
          afterData: {
            failedAttempts: Number(rejected?.challenge_failed_attempts ?? challenge.challenge_failed_attempts ?? 0),
            status: rejected?.status ?? challenge.status,
          },
        }));
        return { ...resultError('TECHNICAL_BACKUP_CODE_REJECTED', 401, 'Mã mở khóa không đúng'), expectedAuditCount: 1 };
      }

      const verifiedAt = now().toISOString();
      const unlockExpiresAt = new Date(now().getTime() + runtime.unlockTtlSeconds * 1000).toISOString();
      const issued = issueTechnicalBackupUnlockToken(runtime, challengeId);
      const unlocked = await repo.unlockTechnicalBackupAccess(client, {
        installationId: requestContext.installationId,
        challengeId,
        verifiedAt,
        unlockTokenHash: issued.tokenHash,
        unlockExpiresAt,
      });
      if (!unlocked) return { ...resultError('TECHNICAL_BACKUP_UNLOCK_FAILED', 409, 'Không thể mở Khu vực kỹ thuật'), failed: true };
      await insertAuditRecord(client, buildAuditRecord({
        requestContext,
        action: 'technical_backup_unlocked',
        resourceType: 'technical_backup_access',
        resourceId: challengeId,
        afterData: { unlockExpiresAt, recipient: TECHNICAL_BACKUP_RECIPIENT },
      }));
      return { ok: true, unlock: { token: issued.token, expiresAt: unlockExpiresAt } };
    },
  });
}

export async function getTechnicalBackupAccessStatus(pool, {
  requestContext,
  token,
  env = process.env,
  now = () => new Date(),
}) {
  const parsed = parseTechnicalBackupUnlockToken(token);
  if (!parsed) return { ok: true, access: { unlocked: false, expiresAt: null } };
  const runtime = loadTechnicalBackupAccessRuntime({ env });
  if (runtime.pepper.length < 32) return { ok: true, access: { unlocked: false, expiresAt: null } };
  const row = await repo.getTechnicalBackupAccess(pool, {
    installationId: requestContext.installationId,
    challengeId: parsed.challengeId,
    requestedBy: requestContext.actorId,
  });
  if (!row || row.status !== 'UNLOCKED' || !row.unlock_token_hash || !row.unlock_expires_at) {
    return { ok: true, access: { unlocked: false, expiresAt: null } };
  }
  const expiresAt = new Date(row.unlock_expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now().getTime()) {
    return { ok: true, access: { unlocked: false, expiresAt: null } };
  }
  const actualHash = hashTechnicalBackupUnlockToken(runtime, parsed.challengeId, parsed.token);
  if (!technicalBackupUnlockTokenMatches(row.unlock_token_hash, actualHash)) {
    return { ok: true, access: { unlocked: false, expiresAt: null } };
  }
  return { ok: true, access: { unlocked: true, expiresAt: expiresAt.toISOString() } };
}

export async function requireTechnicalBackupAccess(pool, options) {
  const status = await getTechnicalBackupAccessStatus(pool, options);
  return status.access.unlocked
    ? { ok: true, access: status.access }
    : resultError('TECHNICAL_BACKUP_UNLOCK_REQUIRED', 423, 'Cần mở khóa Khu vực kỹ thuật trước khi thao tác sao lưu hệ thống');
}
