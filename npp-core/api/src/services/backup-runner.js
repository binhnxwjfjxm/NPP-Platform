import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildR2ObjectKey } from '../storage/object-key.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import { fileMetadata } from '../backup/artifacts.js';
import * as repo from '../db/repositories/backup.js';
import { finalizeSystemBackupJob } from '../db/repositories/system-backup.js';

const DUMP_SNAPSHOT_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function safeTimestamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function publicFailure(error) {
  const known = new Map([
    ['BACKUP_STORAGE_UNAVAILABLE', 'Kho lưu trữ backup chưa sẵn sàng'],
    ['BACKUP_STORAGE_PUBLIC_BUCKET_FORBIDDEN', 'Backup yêu cầu R2 private; bucket public không được phép'],
    ['BACKUP_DUMP_FAILED', 'Không tạo được bản phục hồi PostgreSQL'],
    ['BACKUP_DUMP_VERIFY_FAILED', 'Bản phục hồi PostgreSQL tạo ra không hợp lệ'],
    ['BACKUP_STORAGE_UPLOAD_FAILED', 'Không tải được bản backup lên R2'],
    ['BACKUP_STORAGE_VERIFY_FAILED', 'Không xác minh được bản backup trên R2'],
    ['BACKUP_CHECKSUM_MISMATCH', 'Checksum bản backup không khớp'],
  ]);
  const code = known.has(error?.code) ? error.code : 'BACKUP_JOB_FAILED';
  return { code, message: known.get(code) ?? 'Sao lưu hệ thống không thành công' };
}

function backupError(code, cause = null) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function pgDumpEnvironment(config) {
  const url = new URL(config.databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database || !url.username) throw backupError('BACKUP_DUMP_FAILED');
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: config.databaseSslMode || 'require',
    PGAPPNAME: 'npp-core-backup',
  };
}

async function runPgTool(executable, args, env, failureCode, spawnImpl = spawn) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const child = spawnImpl(executable, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    child.once('error', () => {
      if (settled) return;
      settled = true;
      reject(backupError(failureCode));
    });
    child.stderr?.resume();
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(backupError(failureCode));
    });
  });
}

async function runPgDump(config, snapshotId, outputPath, spawnImpl = spawn) {
  if (!DUMP_SNAPSHOT_PATTERN.test(snapshotId)) throw backupError('BACKUP_DUMP_FAILED');
  const executable = String(process.env.PG_DUMP_BIN ?? 'pg_dump').trim() || 'pg_dump';
  const args = [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--snapshot=${snapshotId}`,
    `--file=${outputPath}`,
  ];
  await runPgTool(executable, args, pgDumpEnvironment(config), 'BACKUP_DUMP_FAILED', spawnImpl);
}

async function verifyPgDumpArchive(config, dumpPath, spawnImpl = spawn) {
  const executable = String(process.env.PG_RESTORE_BIN ?? 'pg_restore').trim() || 'pg_restore';
  await runPgTool(executable, ['--list', dumpPath], pgDumpEnvironment(config), 'BACKUP_DUMP_VERIFY_FAILED', spawnImpl);
}

async function verifyUploaded(storageAdapter, installationId, artifact) {
  const head = await storageAdapter.headObject({ installationId, key: artifact.key });
  if (head.size !== artifact.size) throw backupError('BACKUP_STORAGE_VERIFY_FAILED');
  const metadataChecksum = String(head.metadata?.sha256 ?? '').toLowerCase();
  if (metadataChecksum && metadataChecksum !== artifact.sha256) throw backupError('BACKUP_CHECKSUM_MISMATCH');
  if (head.checksumSha256) {
    let providerHex = '';
    const value = String(head.checksumSha256).trim();
    if (/^[0-9a-f]{64}$/i.test(value)) providerHex = value.toLowerCase();
    else {
      try { providerHex = Buffer.from(value, 'base64').toString('hex'); } catch {}
    }
    if (providerHex && providerHex !== artifact.sha256) throw backupError('BACKUP_CHECKSUM_MISMATCH');
  }
}

async function uploadDump(storageAdapter, installationId, artifact) {
  try {
    await storageAdapter.putObject({
      installationId,
      key: artifact.key,
      body: createReadStream(artifact.filePath),
      contentType: 'application/octet-stream',
      contentLength: artifact.size,
      checksumSha256: artifact.sha256,
      cacheControl: 'private, no-store',
      metadata: {
        'backup-job-id': artifact.jobId,
        'artifact-type': 'postgresql-custom-dump',
        sha256: artifact.sha256,
      },
    });
  } catch (error) {
    throw backupError('BACKUP_STORAGE_UPLOAD_FAILED', error);
  }
}

function artifactKey(installationId, filename, now) {
  return buildR2ObjectKey({ installationId, namespace: 'backups', filename, now, uuid: randomUUID() });
}

export function createBackupRunner({ pool, storageAdapter, config, now = () => new Date(), spawnImpl = spawn } = {}) {
  if (!pool?.connect || !pool?.query || !config) throw new Error('BACKUP_RUNNER_CONFIG_INVALID');

  async function run(jobId) {
    const startedAt = now().toISOString();
    const job = await repo.claimQueuedBackupJob(pool, { installationId: config.installationId, jobId, startedAt });
    if (!job) return null;
    const tempDir = await mkdtemp(path.join(tmpdir(), 'npp-backup-'));
    const client = await pool.connect();
    let transactionOpen = false;
    try {
      if (!storageAdapter) throw backupError('BACKUP_STORAGE_UNAVAILABLE');
      if (config.r2PublicBaseUrl) throw backupError('BACKUP_STORAGE_PUBLIC_BUCKET_FORBIDDEN');

      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      transactionOpen = true;
      const snapshotResult = await client.query("SELECT pg_export_snapshot() AS snapshot_id, transaction_timestamp() AS snapshot_at");
      const snapshotId = String(snapshotResult.rows[0]?.snapshot_id ?? '');
      const snapshotAt = new Date(snapshotResult.rows[0]?.snapshot_at ?? startedAt).toISOString();
      const migrationResult = await client.query('SELECT id FROM shared.schema_migrations ORDER BY id');
      const migrationIds = migrationResult.rows.map((row) => String(row.id));
      const schemaVersion = migrationIds.at(-1) ?? null;
      await repo.updateBackupStatus(pool, {
        installationId: config.installationId,
        jobId,
        status: 'DUMPING_DATABASE',
        snapshotAt,
        schemaVersion,
      });

      const stamp = safeTimestamp(snapshotAt);
      const dumpPath = path.join(tempDir, `hung-phat-system-${stamp}.dump`);
      await runPgDump(config, snapshotId, dumpPath, spawnImpl);
      await verifyPgDumpArchive(config, dumpPath, spawnImpl);
      await client.query('COMMIT');
      transactionOpen = false;

      await repo.updateBackupStatus(pool, { installationId: config.installationId, jobId, status: 'HASHING' });
      const dumpMeta = await fileMetadata(dumpPath);
      const dump = {
        ...dumpMeta,
        jobId,
        filePath: dumpPath,
        key: artifactKey(config.installationId, path.basename(dumpPath), now()),
      };

      await repo.updateBackupStatus(pool, { installationId: config.installationId, jobId, status: 'UPLOADING_R2' });
      await uploadDump(storageAdapter, config.installationId, dump);

      await repo.updateBackupStatus(pool, { installationId: config.installationId, jobId, status: 'VERIFYING_R2' });
      await verifyUploaded(storageAdapter, config.installationId, dump);

      const verifiedAt = now().toISOString();
      const auditContext = {
        installationId: config.installationId,
        actorId: job.requested_by,
        employeeId: null,
        sourceApp: job.source_app,
        requestId: job.request_id,
      };
      const finalized = await withAuditOutboxTransaction({
        adapter: pool,
        mutate: async (auditClient) => {
          const completed = await finalizeSystemBackupJob(auditClient, {
            installationId: config.installationId,
            jobId,
            dump,
            verifiedAt,
          });
          await insertAuditRecord(auditClient, buildAuditRecord({
            requestContext: auditContext,
            action: 'backup_verified',
            resourceType: 'backup_job',
            resourceId: jobId,
            afterData: {
              status: 'VERIFIED',
              purpose: 'SYSTEM_BACKUP',
              snapshotAt,
              verifiedAt,
              schemaVersion,
              r2Verified: true,
              artifact: {
                type: 'postgresql_custom_dump',
                size: dump.size,
                sha256: dump.sha256,
              },
            },
          }));
          return { completed };
        },
      });
      return finalized.completed ?? null;
    } catch (error) {
      if (transactionOpen) {
        try { await client.query('ROLLBACK'); } catch {}
      }
      const failure = publicFailure(error);
      const auditContext = {
        installationId: config.installationId,
        actorId: job.requested_by,
        employeeId: null,
        sourceApp: job.source_app,
        requestId: job.request_id,
      };
      await withAuditOutboxTransaction({
        adapter: pool,
        mutate: async (auditClient) => {
          const failed = await repo.failBackupJob(auditClient, {
            installationId: config.installationId,
            jobId,
            failureCode: failure.code,
            safeMessage: failure.message,
          });
          if (!failed) return { failed: true, jobMissing: true };
          await insertAuditRecord(auditClient, buildAuditRecord({
            requestContext: auditContext,
            action: 'backup_failed',
            resourceType: 'backup_job',
            resourceId: jobId,
            afterData: { status: 'FAILED', purpose: 'SYSTEM_BACKUP', failureCode: failure.code },
          }));
          return { jobFailed: true };
        },
      }).catch(async () => {
        await repo.failBackupJob(pool, {
          installationId: config.installationId,
          jobId,
          failureCode: failure.code,
          safeMessage: failure.message,
        }).catch(() => null);
      });
      return null;
    } finally {
      client.release();
      await rm(tempDir, { recursive: true, force: true }).catch(() => null);
    }
  }

  return Object.freeze({ run });
}
