import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import { createR2StorageAdapter } from '../storage/r2-adapter.js';
import { createBackupRunner } from '../services/backup-runner.js';
import {
  createBackupDownload,
  createBackupJob,
  createDeletionIntent,
  getBackupJob,
  listBackupJobs,
  verifyDeletionIntent,
} from '../services/backup.js';

const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const DEFAULT_BACKUP_MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024;

function apiError(code, message, statusCode = 500, retryable = false, details = {}) {
  return { code, message, statusCode, retryable, details };
}
function text(value) { return String(value ?? '').trim(); }
function boundedBackupBytes(value) {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= DEFAULT_BACKUP_MAX_OBJECT_BYTES
    ? parsed
    : DEFAULT_BACKUP_MAX_OBJECT_BYTES;
}

function authenticateAndAuthorize(req, res, options, permission, { ownerOnly = false } = {}) {
  const auth = options.authenticate(req, options.config);
  if (!auth?.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Cần đăng nhập', 401), options.requestId, options.receivedAt);
    return null;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, permission).ok) {
    sendError(res, apiError('FORBIDDEN', 'Không có quyền thực hiện thao tác này', 403), options.requestId, options.receivedAt);
    return null;
  }
  if (ownerOnly) {
    const roles = Array.isArray(requestContext.roles) ? requestContext.roles : [];
    if (!roles.some((role) => ['system:security-owner', 'system:implementation-owner'].includes(role))) {
      sendError(res, apiError('OWNER_REQUIRED', 'Chỉ Owner mới được thực hiện thao tác này', 403), options.requestId, options.receivedAt);
      return null;
    }
  }
  return requestContext;
}

function requireIdempotencyKey(req) {
  try {
    const normalized = normalizeIdempotencyKey(req.headers['idempotency-key']);
    return normalized ? { ok: true, key: normalized } : { ok: false };
  } catch {
    return { ok: false };
  }
}

async function bodyOrError(req, res, options) {
  try {
    return { ok: true, payload: await readJsonBody(req) };
  } catch (error) {
    sendError(res, apiError(error.code ?? 'INVALID_JSON_BODY', error.publicMessage ?? 'Nội dung yêu cầu không hợp lệ', error.statusCode ?? 400), options.requestId, options.receivedAt);
    return { ok: false, payload: null };
  }
}

function resultEnvelope(result) {
  if (result.job) return result.job;
  if (result.jobs) return result.jobs;
  if (result.download) return result.download;
  if (result.intent) return result.intent;
  return result;
}

function idempotentFailure(result, options) {
  return {
    statusCode: result.statusCode ?? 400,
    contentType: 'application/json',
    requestId: options.requestId,
    body: {
      error: {
        code: result.code,
        message: result.message,
        details: result.details ?? {},
        retryable: result.statusCode === 503,
      },
      requestId: options.requestId,
      receivedAt: options.receivedAt,
    },
  };
}

async function executeIdempotent(req, res, options, requestContext, { route, payload, process }) {
  const key = requireIdempotencyKey(req);
  if (!key.ok) {
    sendError(res, apiError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key bắt buộc và phải theo canonical contract', 400), options.requestId, options.receivedAt);
    return;
  }
  try {
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore,
      req,
      requestContext,
      requestId: options.requestId,
      receivedAt: options.receivedAt,
      route,
      payload,
      onProcess: async () => {
        const result = await process();
        if (!result.ok) return idempotentFailure(result, options);
        return {
          statusCode: result.statusCode ?? 200,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(resultEnvelope(result), options.requestId, options.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('IDEMPOTENCY_STORAGE_ERROR', 'Kho chống trùng tạm thời không khả dụng', 503, true), options.requestId, options.receivedAt);
  }
}

function resolveBackupStorageRuntime(options) {
  if (options.backupStorageAdapter) {
    return { adapter: options.backupStorageAdapter, config: options.backupStorageConfig ?? options.config };
  }
  const env = options.env ?? process.env;
  const backupBucket = text(env.BACKUP_R2_BUCKET);
  if (!backupBucket || !options.config?.r2Enabled) return { adapter: null, config: options.config };
  const samePublicBucket = backupBucket === options.config.r2Bucket && Boolean(options.config.r2PublicBaseUrl);
  const backupConfig = Object.freeze({
    ...options.config,
    r2Bucket: backupBucket,
    r2PublicBaseUrl: samePublicBucket ? options.config.r2PublicBaseUrl : '',
    r2MaxObjectBytes: boundedBackupBytes(env.BACKUP_R2_MAX_OBJECT_BYTES),
  });
  return { adapter: createR2StorageAdapter(backupConfig), config: backupConfig };
}

function createRunner(options, storageRuntime) {
  return options.backupRunner ?? createBackupRunner({
    pool: options.getPool(),
    storageAdapter: storageRuntime.adapter,
    config: storageRuntime.config,
  });
}

export async function handleBackupRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const method = String(req.method ?? 'GET').toUpperCase();
  const backupMatch = new RegExp(`^/api/backups/(${UUID_PATTERN})$`).exec(url.pathname);
  const downloadMatch = new RegExp(`^/api/backups/(${UUID_PATTERN})/download$`).exec(url.pathname);
  const deleteVerifyMatch = new RegExp(`^/api/data-deletions/(${UUID_PATTERN})/verify$`).exec(url.pathname);
  const isBackupRoot = url.pathname === '/api/backups';
  const isDeleteRoot = url.pathname === '/api/data-deletions';
  if (!isBackupRoot && !backupMatch && !downloadMatch && !isDeleteRoot && !deleteVerifyMatch) return false;

  const storageRuntime = resolveBackupStorageRuntime(options);

  if (isBackupRoot && method === 'GET') {
    const requestContext = authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreBackupRead);
    if (!requestContext) return true;
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const result = await listBackupJobs(options.getPool(), { requestContext, limit });
    const queued = result.jobs.filter((job) => job.status === 'QUEUED');
    if (queued.length) {
      const runner = createRunner(options, storageRuntime);
      for (const job of queued) setImmediate(() => { void runner.run(job.id); });
    }
    sendSuccess(res, result.jobs, options.requestId, options.receivedAt);
    return true;
  }

  if (isBackupRoot && method === 'POST') {
    const requestContext = authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreBackupCreate, { ownerOnly: true });
    if (!requestContext) return true;
    const body = await bodyOrError(req, res, options);
    if (!body.ok) return true;
    const payload = { includeXlsx: body.payload?.includeXlsx !== false };
    const runner = createRunner(options, storageRuntime);
    await executeIdempotent(req, res, options, requestContext, {
      route: '/api/backups',
      payload,
      process: () => createBackupJob(options.getPool(), {
        requestContext,
        includeXlsx: payload.includeXlsx,
        scheduleRun: (jobId) => setImmediate(() => { void runner.run(jobId); }),
      }),
    });
    return true;
  }

  if (backupMatch && method === 'GET') {
    const requestContext = authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreBackupRead);
    if (!requestContext) return true;
    const result = await getBackupJob(options.getPool(), { installationId: requestContext.installationId, jobId: backupMatch[1] });
    if (!result.ok) sendError(res, apiError(result.code, result.message, result.statusCode, false, result.details), options.requestId, options.receivedAt);
    else {
      if (result.job.status === 'QUEUED') setImmediate(() => { void createRunner(options, storageRuntime).run(result.job.id); });
      sendSuccess(res, result.job, options.requestId, options.receivedAt);
    }
    return true;
  }

  if (downloadMatch && method === 'POST') {
    const requestContext = authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreBackupDownload, { ownerOnly: true });
    if (!requestContext) return true;
    const body = await bodyOrError(req, res, options);
    if (!body.ok) return true;
    const payload = { artifactType: String(body.payload?.artifactType ?? '') };
    await executeIdempotent(req, res, options, requestContext, {
      route: `/api/backups/${downloadMatch[1]}/download`,
      payload,
      process: () => createBackupDownload(options.getPool(), storageRuntime.adapter, {
        requestContext,
        jobId: downloadMatch[1],
        artifactType: payload.artifactType,
        expiresIn: Math.min(300, options.config.r2PresignedUrlMaxSeconds),
      }),
    });
    return true;
  }

  if (isDeleteRoot && method === 'POST') {
    const requestContext = authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreDataDeletionAuthorize, { ownerOnly: true });
    if (!requestContext) return true;
    const body = await bodyOrError(req, res, options);
    if (!body.ok) return true;
    const payload = { backupJobId: String(body.payload?.backupJobId ?? ''), reason: String(body.payload?.reason ?? '') };
    await executeIdempotent(req, res, options, requestContext, {
      route: '/api/data-deletions',
      payload,
      process: () => createDeletionIntent(options.getPool(), {
        requestContext,
        backupJobId: payload.backupJobId,
        reason: payload.reason,
        env: options.env ?? process.env,
        ownerConfig: options.ownerConfig ?? null,
        fetchImpl: options.fetchImpl ?? globalThis.fetch,
      }),
    });
    return true;
  }

  if (deleteVerifyMatch && method === 'POST') {
    const requestContext = authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreDataDeletionAuthorize, { ownerOnly: true });
    if (!requestContext) return true;
    const body = await bodyOrError(req, res, options);
    if (!body.ok) return true;
    const payload = { code: String(body.payload?.code ?? '') };
    await executeIdempotent(req, res, options, requestContext, {
      route: `/api/data-deletions/${deleteVerifyMatch[1]}/verify`,
      payload,
      process: () => verifyDeletionIntent(options.getPool(), {
        requestContext,
        intentId: deleteVerifyMatch[1],
        code: payload.code,
        env: options.env ?? process.env,
        ownerConfig: options.ownerConfig ?? null,
      }),
    });
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', 405), options.requestId, options.receivedAt);
  return true;
}
