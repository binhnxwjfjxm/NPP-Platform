import { createHash } from 'node:crypto';
import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import {
  createCustomerOrderingHomeBannerStorage,
  CUSTOMER_ORDERING_HOME_BANNER_CONTENT_TYPE,
} from '../storage/customer-ordering-home-banner.js';
import * as service from '../services/customer-ordering-home-content.js';

const ROOT = '/api/customer-ordering-home-content';
const BANNER = '/api/customer-ordering-home-content/banner';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const OWNER_ROLES = new Set(['system:security-owner', 'system:implementation-owner']);

function apiError(code, message, statusCode = 400, retryable = false) {
  return { code, message, details: {}, retryable, statusCode };
}

function authenticate(req, res, options) {
  const auth = options.authenticate(req, options.config);
  if (!auth?.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Cần đăng nhập', 401), options.requestId, options.receivedAt);
    return null;
  }
  return options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
}

function canWrite(options, requestContext) {
  if ((requestContext.roles ?? []).some((role) => OWNER_ROLES.has(role))) return true;
  return options.authorize(requestContext, options.PERMISSIONS.coreOrganizationWrite).ok;
}

function requireKey(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    return key ? { ok: true, key } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function readImage(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_IMAGE_BYTES) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      if (!overflow) chunks.push(bytes);
    });
    req.on('end', () => {
      if (overflow || size < 1) {
        reject(apiError('INVALID_BANNER_IMAGE_SIZE', 'Dung lượng ảnh banner không hợp lệ.', overflow ? 413 : 400));
        return;
      }
      resolve(Buffer.concat(chunks, size));
    });
    req.on('error', () => reject(apiError('INVALID_BANNER_IMAGE_REQUEST', 'Không đọc được ảnh banner.', 400)));
  });
}

function mutationResponse(content, options) {
  return {
    statusCode: 200,
    contentType: 'application/json',
    requestId: options.requestId,
    body: createSuccessEnvelope({ content }, options.requestId, options.receivedAt),
  };
}

export async function handleCustomerOrderingHomeContentRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname !== ROOT && pathname !== BANNER) return false;

  const requestContext = authenticate(req, res, options);
  if (!requestContext) return true;
  const method = String(req.method ?? 'GET').toUpperCase();

  if (pathname === ROOT && method === 'GET') {
    if (!options.authorize(requestContext, options.PERMISSIONS.coreConfigRead).ok && !canWrite(options, requestContext)) {
      sendError(res, apiError('FORBIDDEN', 'Không có quyền xem nội dung đặt hàng.', 403), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const result = await service.getCustomerOrderingHomeContent(options.getPool(), {
        installationId: requestContext.installationId,
        config: options.config,
      });
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(res, { content: result.content }, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('HOME_CONTENT_UNAVAILABLE', 'Nội dung đặt hàng tạm thời chưa sẵn sàng.', 503, true), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (!canWrite(options, requestContext)) {
    sendError(res, apiError('FORBIDDEN', 'Không có quyền thay đổi nội dung đặt hàng.', 403), options.requestId, options.receivedAt);
    return true;
  }

  const key = requireKey(req);
  if (!key.ok) {
    sendError(res, apiError('INVALID_IDEMPOTENCY_KEY', 'Mã nhận diện yêu cầu không hợp lệ.', 400), options.requestId, options.receivedAt);
    return true;
  }

  if (pathname === ROOT && method === 'PATCH') {
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, error.statusCode), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const execution = await options.executeRequestWithIdempotency({
        idempotencyStore: options.idempotencyStore,
        req,
        requestContext,
        requestId: options.requestId,
        receivedAt: options.receivedAt,
        route: ROOT,
        payload,
        onProcess: async () => {
          const tx = await withAuditOutboxTransaction({
            adapter: options.getPool(),
            mutate: async (client) => {
              const before = await service.getCustomerOrderingHomeContent(client, {
                installationId: requestContext.installationId,
                config: options.config,
              });
              const result = await service.updateCustomerOrderingHomeContent(client, {
                installationId: requestContext.installationId,
                config: options.config,
                payload,
                actorId: requestContext.actorId,
              });
              if (!result.ok) return { failed: result };
              await insertAuditRecord(client, buildAuditRecord({
                requestContext,
                action: 'update',
                resourceType: 'customer_ordering_home_content',
                resourceId: requestContext.installationId,
                beforeData: before.content,
                afterData: result.content,
                metadata: { source: 'COMPANY_SETTINGS' },
              }));
              return { content: result.content };
            },
          });
          if (tx.failed) {
            return {
              statusCode: 400,
              contentType: 'application/json',
              requestId: options.requestId,
              body: {
                error: { code: tx.failed.code, message: tx.failed.message, retryable: false, details: {} },
                requestId: options.requestId,
                receivedAt: options.receivedAt,
              },
            };
          }
          return mutationResponse(tx.content, options);
        },
      });
      res.setHeader('Cache-Control', 'no-store');
      sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
    } catch {
      sendError(res, apiError('HOME_CONTENT_UPDATE_FAILED', 'Không lưu được nội dung đặt hàng.', 503, true), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (pathname === BANNER && method === 'PUT') {
    const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== CUSTOMER_ORDERING_HOME_BANNER_CONTENT_TYPE) {
      sendError(res, apiError('INVALID_BANNER_IMAGE_TYPE', 'Ảnh banner phải được chuyển sang WebP trước khi tải lên.', 400), options.requestId, options.receivedAt);
      return true;
    }
    let bytes;
    try {
      bytes = await readImage(req);
    } catch (error) {
      sendError(res, error, options.requestId, options.receivedAt);
      return true;
    }
    const fingerprint = createHash('sha256').update(bytes).digest('hex');
    const payload = { byteSize: bytes.length, contentType, sha256: fingerprint };
    try {
      const execution = await options.executeRequestWithIdempotency({
        idempotencyStore: options.idempotencyStore,
        req,
        requestContext,
        requestId: options.requestId,
        receivedAt: options.receivedAt,
        route: BANNER,
        payload,
        onProcess: async () => {
          const storage = createCustomerOrderingHomeBannerStorage(options.config);
          await storage.putBanner(bytes);
          const head = await storage.headBanner();
          if (head.contentType !== CUSTOMER_ORDERING_HOME_BANNER_CONTENT_TYPE || head.size !== bytes.length) {
            return {
              statusCode: 503,
              contentType: 'application/json',
              requestId: options.requestId,
              body: {
                error: { code: 'BANNER_UPLOAD_VERIFY_FAILED', message: 'Ảnh đã tải lên nhưng chưa xác minh được.', retryable: true, details: {} },
                requestId: options.requestId,
                receivedAt: options.receivedAt,
              },
            };
          }
          const tx = await withAuditOutboxTransaction({
            adapter: options.getPool(),
            mutate: async (client) => {
              const result = await service.markCustomerOrderingHomeBannerUploaded(client, {
                installationId: requestContext.installationId,
                config: options.config,
                actorId: requestContext.actorId,
              });
              await insertAuditRecord(client, buildAuditRecord({
                requestContext,
                action: 'banner_upload',
                resourceType: 'customer_ordering_home_content',
                resourceId: requestContext.installationId,
                afterData: result.content,
                metadata: { source: 'COMPANY_SETTINGS', byteSize: bytes.length },
              }));
              return { content: result.content };
            },
          });
          return mutationResponse(tx.content, options);
        },
      });
      res.setHeader('Cache-Control', 'no-store');
      sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
    } catch {
      sendError(res, apiError('BANNER_UPLOAD_FAILED', 'Không tải được ảnh banner.', 503, true), options.requestId, options.receivedAt);
    }
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.', 405), options.requestId, options.receivedAt);
  return true;
}
