import { createErrorEnvelope, createSuccessEnvelope } from '@npp/contracts';
import { normalizeIdempotencyKey } from '../idempotency.js';
import { sendError, sendJson } from '../http-utils.js';
import {
  isRetailOwner,
  retailOwnerExternalId,
  sendRetailOwnerPush,
} from '../services/retail-owner-notification.js';

function apiError(code, message, statusCode = 500, retryable = false, details = {}) {
  return { code, message, statusCode, retryable, details };
}

function authenticateOwner(req, res, options) {
  const auth = options.authenticate(req, options.config);
  if (!auth?.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Cần đăng nhập để tiếp tục', 401), options.requestId, options.receivedAt);
    return null;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!isRetailOwner(requestContext) || requestContext.sourceApp !== 'retail-web') {
    sendError(res, apiError('FORBIDDEN', 'Chỉ tài khoản Owner trên Bán tại quầy được dùng chức năng này', 403), options.requestId, options.receivedAt);
    return null;
  }
  return requestContext;
}

function requireIdempotency(req, res, options) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) throw new Error('missing');
    return key;
  } catch {
    sendError(
      res,
      apiError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống gửi trùng không hợp lệ', 400),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
}

export async function handleRetailOwnerNotificationRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/api/retail/owner-notifications/test') return false;
  if (String(req.method ?? '').toUpperCase() !== 'POST') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức yêu cầu không được hỗ trợ', 405), options.requestId, options.receivedAt);
    return true;
  }

  const requestContext = authenticateOwner(req, res, options);
  if (!requestContext) return true;
  if (!requireIdempotency(req, res, options)) return true;

  const sender = options.retailOwnerPushSender ?? sendRetailOwnerPush;
  const externalId = retailOwnerExternalId(requestContext);
  const execution = await options.executeRequestWithIdempotency({
    idempotencyStore: options.idempotencyStore,
    req,
    requestContext,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
    route: url.pathname,
    payload: { operation: 'retail-owner-notification-test' },
    onProcess: async () => {
      const result = await sender({
        db: options.getPool(),
        installationId: requestContext.installationId,
        recipientExternalIds: [externalId],
        test: true,
        env: options.env ?? process.env,
        fetchImpl: options.fetchImpl ?? globalThis.fetch,
      });
      if (!result.ok) {
        const statusCode = result.code === 'RETAIL_PUSH_PROVIDER_REJECTED' && !result.retryable ? 502 : 503;
        return {
          statusCode,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createErrorEnvelope({
            code: result.code,
            message: result.message,
            statusCode,
            retryable: result.retryable === true,
            details: {},
          }, options.requestId, options.receivedAt),
        };
      }
      return {
        statusCode: 200,
        contentType: 'application/json',
        requestId: options.requestId,
        body: createSuccessEnvelope({
          sent: !result.skipped,
          recipientCount: result.recipientCount,
          messageId: result.messageId,
        }, options.requestId, options.receivedAt),
      };
    },
  });

  res.setHeader('Cache-Control', 'no-store');
  sendJson(
    res,
    execution.response.statusCode,
    execution.response.body,
    execution.response.requestId ?? options.requestId,
    execution.response.contentType,
  );
  return true;
}
