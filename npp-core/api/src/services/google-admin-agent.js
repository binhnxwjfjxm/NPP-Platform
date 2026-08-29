const SAFE_GATEWAY_ORIGIN = /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{2,5})?$/;
const SAFE_MODEL = /^[A-Za-z0-9._-]{1,128}$/;
const GATEWAY_PATH = '/api/admin-agent/gateway';
const GATEWAY_HEADER = 'x-company-admin-ai-gateway';
const GATEWAY_VALUE = 'company-admin';

function runtimeError(code, message, statusCode = 503, retryable = true, details = {}) {
  return Object.assign(new Error(code), { code, publicMessage: message, statusCode, retryable, details });
}

function text(value) {
  return String(value ?? '').trim();
}

export function readAdminAgentRuntimeConfig(env = process.env) {
  const gatewayBaseUrl = text(env.ADMIN_AI_GATEWAY_BASE_URL).replace(/\/$/, '');
  const token = text(env.WEBSITE_AI_API_TOKEN);
  const model = text(env.ADMIN_AI_AGENT_MODEL) || 'gemini-2.5-pro';
  if (!SAFE_GATEWAY_ORIGIN.test(gatewayBaseUrl)) {
    throw runtimeError('ADMIN_AI_GATEWAY_URL_INVALID', 'Kết nối Trợ lý Công Ty chưa được cấu hình đầy đủ', 503, false);
  }
  if (!token) {
    throw runtimeError('ADMIN_AI_GATEWAY_TOKEN_MISSING', 'Kết nối Trợ lý Công Ty chưa được cấu hình đầy đủ', 503, false);
  }
  if (!SAFE_MODEL.test(model) || model !== 'gemini-2.5-pro') {
    throw runtimeError('ADMIN_AI_AGENT_MODEL_INVALID', 'Model Trợ lý Công Ty chưa được cấu hình hợp lệ', 503, false);
  }
  return Object.freeze({ gatewayBaseUrl, token, model });
}

function count(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const usage = Object.freeze({
    promptTokenCount: count(value.promptTokenCount),
    cachedContentTokenCount: count(value.cachedContentTokenCount),
    candidatesTokenCount: count(value.candidatesTokenCount),
    thoughtsTokenCount: count(value.thoughtsTokenCount),
    toolUsePromptTokenCount: count(value.toolUsePromptTokenCount),
    totalTokenCount: count(value.totalTokenCount),
  });
  const expectedTotal = usage.promptTokenCount + usage.candidatesTokenCount + usage.thoughtsTokenCount + usage.toolUsePromptTokenCount;
  if (usage.totalTokenCount !== expectedTotal || usage.cachedContentTokenCount > usage.promptTokenCount) return null;
  return usage;
}

export function parseAdminAgentGatewayResponse(payload, expectedConversationId, expectedModel = 'gemini-2.5-pro') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.ok !== true) {
    throw runtimeError('ADMIN_AI_GATEWAY_RESPONSE_INVALID', 'Trợ lý Công Ty tạm thời chưa sẵn sàng', 502, true);
  }
  const replyText = text(payload.replyText);
  const conversationId = text(payload.conversationId);
  const providerRequestId = text(payload.providerRequestId) || null;
  const model = text(payload.model);
  const occurredAt = text(payload.occurredAt);
  if (payload.capability !== 'company-admin-ai' || payload.readOnly !== true) {
    throw runtimeError('ADMIN_AI_GATEWAY_CAPABILITY_INVALID', 'Trợ lý Công Ty tạm thời chưa sẵn sàng', 502, false);
  }
  if (!replyText || conversationId !== expectedConversationId || model !== expectedModel || !Number.isFinite(Date.parse(occurredAt))) {
    throw runtimeError('ADMIN_AI_GATEWAY_RESPONSE_INVALID', 'Trợ lý Công Ty tạm thời chưa sẵn sàng', 502, true);
  }
  return Object.freeze({
    replyText,
    conversationId,
    providerRequestId,
    model,
    occurredAt,
    usageMetadata: normalizeUsage(payload.usageMetadata),
  });
}

export async function queryGoogleAdminAgent({
  env = process.env,
  fetchImpl = fetch,
  actorId,
  conversationId,
  message,
}) {
  const config = readAdminAgentRuntimeConfig(env);
  let response;
  try {
    response = await fetchImpl(`${config.gatewayBaseUrl}${GATEWAY_PATH}`, {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${config.token}`,
        [GATEWAY_HEADER]: GATEWAY_VALUE,
        'content-type': 'application/json; charset=utf-8',
        accept: 'application/json',
      },
      body: JSON.stringify({ actorId, conversationId, message }),
      signal: AbortSignal.timeout(70_000),
    });
  } catch {
    throw runtimeError('ADMIN_AI_GATEWAY_UNAVAILABLE', 'Trợ lý Công Ty tạm thời chưa kết nối được', 503, true);
  }

  const payload = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) {
    throw runtimeError('ADMIN_AI_GATEWAY_AUTH_INVALID', 'Kết nối Trợ lý Công Ty chưa được cấu hình đầy đủ', 503, false);
  }
  if (!response.ok) {
    console.error(JSON.stringify({
      event: 'admin_ai_gateway_error',
      httpStatus: response.status,
      code: text(payload?.code) || null,
    }));
    throw runtimeError('ADMIN_AI_GATEWAY_UNAVAILABLE', 'Trợ lý Công Ty tạm thời chưa sẵn sàng', 503, true);
  }
  return parseAdminAgentGatewayResponse(payload, conversationId, config.model);
}
