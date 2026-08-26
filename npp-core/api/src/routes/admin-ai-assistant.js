import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import { queryGoogleAdminAgent } from '../services/google-admin-agent.js';
import { recordAdminAgentUsage } from '../services/admin-ai-usage.js';

const ROOT = '/api/ai/admin-assistant';
const OWNER_ROLES = new Set(['bootstrap', 'system:security-owner', 'system:implementation-owner']);
const SAFE_CONVERSATION_ID = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_MESSAGE_LENGTH = 6000;

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return Object.assign(new Error(code), { code, publicMessage: message, details, retryable, statusCode });
}

function ownerAllowed(context) {
  const roles = Array.isArray(context?.roles) ? context.roles : [];
  return roles.some((role) => OWNER_ROLES.has(role));
}

function requireIdempotencyKey(req) {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined || raw === null) {
    throw apiError('IDEMPOTENCY_KEY_REQUIRED', 'Yêu cầu Trợ lý Công Ty cần mã chống gửi trùng', {}, false, 400);
  }
  try {
    return normalizeIdempotencyKey(raw);
  } catch {
    throw apiError('IDEMPOTENCY_KEY_INVALID', 'Mã chống gửi trùng không hợp lệ', {}, false, 400);
  }
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw apiError('ADMIN_AI_REQUEST_INVALID', 'Nội dung cần hỏi chưa hợp lệ', {}, false, 400);
  }
  const message = String(payload.message ?? '').trim();
  const conversationId = String(payload.conversationId ?? '').trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    throw apiError('ADMIN_AI_MESSAGE_INVALID', 'Nội dung cần hỏi phải có từ 1 đến 6.000 ký tự', {}, false, 400);
  }
  if (!SAFE_CONVERSATION_ID.test(conversationId)) {
    throw apiError('ADMIN_AI_CONVERSATION_INVALID', 'Phiên Trợ lý Công Ty không hợp lệ', {}, false, 400);
  }
  return Object.freeze({ message, conversationId });
}

async function authenticate(req, res, options) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Cần đăng nhập', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  return options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
}

function publicFailure(res, error, options) {
  if (error?.publicMessage && Number.isInteger(error?.statusCode)) {
    sendError(res, apiError(
      error.code ?? 'ADMIN_AI_UNAVAILABLE',
      error.publicMessage,
      error.details ?? {},
      Boolean(error.retryable),
      error.statusCode,
    ), options.requestId, options.receivedAt);
    return;
  }
  sendError(res, apiError('ADMIN_AI_UNAVAILABLE', 'Trợ lý Công Ty tạm thời chưa sẵn sàng', {}, true, 503), options.requestId, options.receivedAt);
}

export async function handleAdminAiAssistantRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== ROOT) return false;
  const context = await authenticate(req, res, options);
  if (!context) return true;
  if (!ownerAllowed(context)) {
    sendError(res, apiError('FORBIDDEN', 'Tài khoản hiện tại không có quyền dùng Trợ lý Công Ty', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }
  if (String(req.method ?? 'GET').toUpperCase() !== 'POST') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  let idempotencyKey;
  let payload;
  try {
    idempotencyKey = requireIdempotencyKey(req);
    payload = normalizePayload(await readJsonBody(req));
  } catch (error) {
    publicFailure(res, error, options);
    return true;
  }

  try {
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore,
      req,
      requestContext: context,
      requestId: options.requestId,
      receivedAt: options.receivedAt,
      route: ROOT,
      payload,
      onProcess: async () => {
        const providerResult = await queryGoogleAdminAgent({
          env: options.env ?? process.env,
          fetchImpl: options.fetchImpl ?? fetch,
          actorId: context.actorId,
          conversationId: payload.conversationId,
          message: payload.message,
        });

        let usageRecorded = false;
        let usage = null;
        if (providerResult.usageMetadata) {
          try {
            usage = await recordAdminAgentUsage(
              options.getPool(),
              context,
              providerResult,
              idempotencyKey,
              options.requestId,
              options.receivedAt,
            );
            usageRecorded = true;
          } catch (error) {
            console.error(JSON.stringify({
              event: 'admin_ai_usage_record_failed',
              requestId: options.requestId,
              providerRequestId: providerResult.providerRequestId,
              errorCode: typeof error?.code === 'string' ? error.code : null,
            }));
          }
        } else {
          console.error(JSON.stringify({
            event: 'admin_ai_usage_metadata_missing',
            requestId: options.requestId,
            providerRequestId: providerResult.providerRequestId,
          }));
        }

        return {
          statusCode: 200,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope({
            replyText: providerResult.replyText,
            conversationId: providerResult.conversationId,
            usageRecorded,
            usage,
            readOnly: true,
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
  } catch (error) {
    publicFailure(res, error, options);
  }
  return true;
}
