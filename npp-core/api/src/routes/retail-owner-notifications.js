import { createErrorEnvelope, createSuccessEnvelope } from '@npp/contracts';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import {
  isRetailOwner,
  registerRetailOwnerWebPush,
  retailOwnerUserId,
  retailWebPushPublicConfig,
  sendRetailOwnerWebPush,
  unregisterRetailOwnerWebPush,
} from '../services/retail-owner-notification.js';

const ROOT = '/api/retail/owner-notifications';

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

async function payloadOrError(req, res, options) {
  try {
    return { ok: true, payload: await readJsonBody(req) };
  } catch (error) {
    sendError(
      res,
      apiError(error.code ?? 'INVALID_JSON_BODY', error.publicMessage ?? 'Dữ liệu gửi lên không hợp lệ', error.statusCode ?? 400),
      options.requestId,
      options.receivedAt,
    );
    return { ok: false, payload: null };
  }
}

function responseForServiceResult(result, options) {
  if (result.ok) {
    return {
      statusCode: 200,
      contentType: 'application/json',
      requestId: options.requestId,
      body: createSuccessEnvelope(result.data ?? result, options.requestId, options.receivedAt),
    };
  }
  const statusCode = result.statusCode ?? (result.retryable ? 503 : 400);
  return {
    statusCode,
    contentType: 'application/json',
    requestId: options.requestId,
    body: createErrorEnvelope({
      code: result.code ?? 'RETAIL_PUSH_FAILED',
      message: result.message ?? 'Thông báo tạm thời chưa sẵn sàng',
      statusCode,
      retryable: result.retryable === true,
      details: {},
    }, options.requestId, options.receivedAt),
  };
}

async function executeMutation(req, res, options, requestContext, route, payload, onProcess) {
  if (!requireIdempotency(req, res, options)) return true;
  const execution = await options.executeRequestWithIdempotency({
    idempotencyStore: options.idempotencyStore,
    req,
    requestContext,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
    route,
    payload,
    onProcess,
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

export async function handleRetailOwnerNotificationRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith(ROOT)) return false;

  const requestContext = authenticateOwner(req, res, options);
  if (!requestContext) return true;

  if (url.pathname === `${ROOT}/config`) {
    if (String(req.method ?? '').toUpperCase() !== 'GET') {
      sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức yêu cầu không được hỗ trợ', 405), options.requestId, options.receivedAt);
      return true;
    }
    res.setHeader('Cache-Control', 'no-store');
    sendSuccess(res, retailWebPushPublicConfig(options.env ?? process.env), options.requestId, options.receivedAt);
    return true;
  }

  if (String(req.method ?? '').toUpperCase() !== 'POST') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức yêu cầu không được hỗ trợ', 405), options.requestId, options.receivedAt);
    return true;
  }

  if (url.pathname === `${ROOT}/subscriptions`) {
    const body = await payloadOrError(req, res, options);
    if (!body.ok) return true;
    return executeMutation(
      req,
      res,
      options,
      requestContext,
      url.pathname,
      { subscription: body.payload?.subscription ?? null },
      async () => responseForServiceResult(await registerRetailOwnerWebPush({
        db: options.getPool(),
        requestContext,
        subscription: body.payload?.subscription,
        userAgent: req.headers['user-agent'],
      }), options),
    );
  }

  if (url.pathname === `${ROOT}/subscriptions/remove`) {
    const body = await payloadOrError(req, res, options);
    if (!body.ok) return true;
    return executeMutation(
      req,
      res,
      options,
      requestContext,
      url.pathname,
      { endpoint: body.payload?.endpoint ?? null },
      async () => responseForServiceResult(await unregisterRetailOwnerWebPush({
        db: options.getPool(),
        requestContext,
        endpoint: body.payload?.endpoint,
      }), options),
    );
  }

  if (url.pathname === `${ROOT}/test`) {
    return executeMutation(
      req,
      res,
      options,
      requestContext,
      url.pathname,
      { operation: 'retail-owner-notification-test' },
      async () => {
        const result = await sendRetailOwnerWebPush({
          db: options.getPool(),
          installationId: requestContext.installationId,
          userId: retailOwnerUserId(requestContext),
          test: true,
          env: options.env ?? process.env,
          fetchImpl: options.fetchImpl ?? globalThis.fetch,
        });
        return responseForServiceResult(result, options);
      },
    );
  }

  sendError(res, apiError('NOT_FOUND', 'Không tìm thấy chức năng thông báo', 404), options.requestId, options.receivedAt);
  return true;
}
