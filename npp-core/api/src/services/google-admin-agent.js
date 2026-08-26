import { createHash, createSign } from 'node:crypto';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const RESOURCE_PATTERN = /^projects\/([a-z][a-z0-9-]{4,61}[a-z0-9]|[0-9]{6,20})\/locations\/([a-z0-9-]{2,40})\/reasoningEngines\/([A-Za-z0-9._-]{1,160})$/;
const SAFE_MODEL = /^[A-Za-z0-9._-]{1,128}$/;
const SAFE_PROJECT_ID = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

let cachedAccessToken = null;

function runtimeError(code, message, statusCode = 503, retryable = true, details = {}) {
  return Object.assign(new Error(code), { code, publicMessage: message, statusCode, retryable, details });
}

function text(value) {
  return String(value ?? '').trim();
}

function parseJson(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    throw runtimeError(code, 'Kết nối Trợ lý Công Ty chưa được cấu hình đầy đủ', 503, false);
  }
}

export function parseAdminAgentResourceName(value) {
  const resourceName = text(value);
  const match = RESOURCE_PATTERN.exec(resourceName);
  if (!match) {
    throw runtimeError('ADMIN_AI_AGENT_RESOURCE_INVALID', 'Kết nối Trợ lý Công Ty chưa được cấu hình đầy đủ', 503, false);
  }
  return Object.freeze({ resourceName, projectId: match[1], location: match[2], resourceId: match[3] });
}

function serviceAccount(env) {
  const raw = text(env.ADMIN_AI_AGENT_SERVICE_ACCOUNT_JSON);
  if (!raw) throw runtimeError('ADMIN_AI_AGENT_CREDENTIAL_MISSING', 'Kết nối Trợ lý Công Ty chưa được cấu hình đầy đủ', 503, false);
  const parsed = parseJson(raw, 'ADMIN_AI_AGENT_CREDENTIAL_INVALID');
  const projectId = text(parsed?.project_id);
  const clientEmail = text(parsed?.client_email);
  const privateKey = text(parsed?.private_key).replace(/\\n/g, '\n');
  if (!SAFE_PROJECT_ID.test(projectId) || !clientEmail.includes('@') || !privateKey.includes('PRIVATE KEY')) {
    throw runtimeError('ADMIN_AI_AGENT_CREDENTIAL_INVALID', 'Kết nối Trợ lý Công Ty chưa được cấu hình đầy đủ', 503, false);
  }
  return Object.freeze({ projectId, clientEmail, privateKey });
}

export function readAdminAgentRuntimeConfig(env = process.env) {
  const resource = parseAdminAgentResourceName(env.ADMIN_AI_AGENT_RESOURCE_NAME);
  const model = text(env.ADMIN_AI_AGENT_MODEL) || 'gemini-2.5-pro';
  if (!SAFE_MODEL.test(model)) {
    throw runtimeError('ADMIN_AI_AGENT_MODEL_INVALID', 'Model Trợ lý Công Ty chưa được cấu hình hợp lệ', 503, false);
  }
  const credential = serviceAccount(env);
  const consumerProjectId = text(env.ADMIN_AI_AGENT_CONSUMER_PROJECT_ID) || credential.projectId;
  if (!SAFE_PROJECT_ID.test(consumerProjectId)) {
    throw runtimeError('ADMIN_AI_AGENT_CONSUMER_PROJECT_INVALID', 'Kết nối Trợ lý Công Ty chưa được cấu hình đầy đủ', 503, false);
  }
  return Object.freeze({ resource, model, credential, consumerProjectId });
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signedAssertion(credential, nowMs) {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iss: credential.clientEmail,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: issuedAt,
    exp: issuedAt + 3600,
  });
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(credential.privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function accessToken(config, fetchImpl, nowMs = Date.now()) {
  const cacheKey = `${config.credential.clientEmail}|${config.consumerProjectId}`;
  if (cachedAccessToken?.cacheKey === cacheKey && cachedAccessToken.expiresAt > nowMs + 60_000) {
    return cachedAccessToken.token;
  }
  const assertion = signedAssertion(config.credential, nowMs);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  const token = text(payload?.access_token);
  const expiresIn = Number(payload?.expires_in ?? 0);
  if (!response.ok || !token || !Number.isFinite(expiresIn) || expiresIn < 60) {
    throw runtimeError('ADMIN_AI_AGENT_AUTH_UNAVAILABLE', 'Trợ lý Công Ty tạm thời chưa kết nối được', 503, true);
  }
  cachedAccessToken = Object.freeze({ cacheKey, token, expiresAt: nowMs + (expiresIn * 1000) });
  return token;
}

function count(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function usageMetadata(event) {
  const metadata = event?.usage_metadata ?? event?.usageMetadata ?? null;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return Object.freeze({
    promptTokenCount: count(metadata.prompt_token_count ?? metadata.promptTokenCount),
    cachedContentTokenCount: count(metadata.cached_content_token_count ?? metadata.cachedContentTokenCount),
    candidatesTokenCount: count(metadata.candidates_token_count ?? metadata.candidatesTokenCount),
    thoughtsTokenCount: count(metadata.thoughts_token_count ?? metadata.thoughtsTokenCount),
    toolUsePromptTokenCount: count(metadata.tool_use_prompt_token_count ?? metadata.toolUsePromptTokenCount),
    totalTokenCount: count(metadata.total_token_count ?? metadata.totalTokenCount),
  });
}

function unwrapEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.output && typeof value.output === 'object' && !Array.isArray(value.output)) return value.output;
  return value;
}

function eventText(event) {
  if (event?.content?.role !== 'model' || !Array.isArray(event?.content?.parts)) return '';
  return event.content.parts
    .map((part) => (part && typeof part === 'object' ? text(part.text) : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function jsonEvents(bodyText) {
  const events = [];
  for (const rawLine of String(bodyText ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(':') || line === 'event: message') continue;
    const candidate = line.startsWith('data:') ? line.slice(5).trim() : line;
    if (!candidate || candidate === '[DONE]') continue;
    if (!candidate.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(candidate);
      const event = unwrapEvent(parsed);
      if (event) events.push(event);
    } catch {
      // Ignore non-JSON transport lines. A usable response still must contain a final model event.
    }
  }
  return events;
}

export function parseAdminAgentRuntimeResponse(bodyText) {
  const events = jsonEvents(bodyText);
  let replyText = '';
  let partialText = '';
  let providerRequestId = null;
  let sawUsage = false;
  const totals = {
    promptTokenCount: 0,
    cachedContentTokenCount: 0,
    candidatesTokenCount: 0,
    thoughtsTokenCount: 0,
    toolUsePromptTokenCount: 0,
    totalTokenCount: 0,
  };
  const seenUsageEvents = new Set();

  for (const event of events) {
    providerRequestId ||= text(event.invocation_id ?? event.invocationId) || null;
    const responseText = eventText(event);
    if (responseText) {
      if (event.partial === true) partialText += responseText;
      else replyText = responseText;
    }
    const metadata = usageMetadata(event);
    const eventId = text(event.id);
    const usageIdentity = eventId || `${events.indexOf(event)}`;
    if (metadata && !seenUsageEvents.has(usageIdentity)) {
      seenUsageEvents.add(usageIdentity);
      sawUsage = true;
      for (const key of Object.keys(totals)) totals[key] += metadata[key];
    }
  }

  const finalReply = (replyText || partialText).trim();
  if (!finalReply) throw runtimeError('ADMIN_AI_AGENT_REPLY_EMPTY', 'Trợ lý Công Ty chưa trả được câu trả lời', 502, true);
  const expectedTotal = totals.promptTokenCount + totals.candidatesTokenCount + totals.thoughtsTokenCount + totals.toolUsePromptTokenCount;
  const normalizedUsage = sawUsage && totals.totalTokenCount === expectedTotal && totals.cachedContentTokenCount <= totals.promptTokenCount
    ? Object.freeze({ ...totals })
    : null;
  return Object.freeze({ replyText: finalReply, providerRequestId, usageMetadata: normalizedUsage });
}

function providerUserId(actorId) {
  return `admin-${createHash('sha256').update(String(actorId)).digest('hex').slice(0, 32)}`;
}

function safeProviderError(payload) {
  const error = payload?.error && typeof payload.error === 'object' ? payload.error : null;
  return Object.freeze({
    code: typeof error?.code === 'number' ? error.code : null,
    status: text(error?.status).slice(0, 80) || null,
  });
}

async function ensureProviderSession({ config, fetchImpl, token, userId, sessionId }) {
  const endpoint = `https://${config.resource.location}-aiplatform.googleapis.com/v1/${config.resource.resourceName}:query`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
      'x-goog-user-project': config.consumerProjectId,
    },
    body: JSON.stringify({
      class_method: 'async_create_session',
      input: {
        user_id: userId,
        session_id: sessionId,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return;
  const payload = await response.json().catch(() => null);
  const provider = safeProviderError(payload);
  if (response.status === 409 || provider.status === 'ALREADY_EXISTS') return;
  console.error(JSON.stringify({
    event: 'admin_ai_agent_session_error',
    httpStatus: response.status,
    provider,
  }));
  throw runtimeError('ADMIN_AI_AGENT_SESSION_UNAVAILABLE', 'Phiên Trợ lý Công Ty tạm thời chưa sẵn sàng', 503, true);
}

export async function queryGoogleAdminAgent({
  env = process.env,
  fetchImpl = fetch,
  actorId,
  conversationId,
  message,
  now = () => new Date(),
}) {
  const config = readAdminAgentRuntimeConfig(env);
  const token = await accessToken(config, fetchImpl, now().getTime());
  const userId = providerUserId(actorId);
  await ensureProviderSession({
    config,
    fetchImpl,
    token,
    userId,
    sessionId: conversationId,
  });
  const endpoint = `https://${config.resource.location}-aiplatform.googleapis.com/v1/${config.resource.resourceName}:streamQuery?alt=sse`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
      accept: 'text/event-stream',
      'x-goog-user-project': config.consumerProjectId,
    },
    body: JSON.stringify({
      class_method: 'async_stream_query',
      input: {
        user_id: userId,
        session_id: conversationId,
        message,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const bodyText = await response.text();
  if (Buffer.byteLength(bodyText, 'utf8') > MAX_RESPONSE_BYTES) {
    throw runtimeError('ADMIN_AI_AGENT_RESPONSE_TOO_LARGE', 'Phản hồi Trợ lý Công Ty vượt quá giới hạn xử lý', 502, false);
  }
  if (!response.ok) {
    let payload = null;
    try { payload = JSON.parse(bodyText); } catch { payload = null; }
    console.error(JSON.stringify({
      event: 'admin_ai_agent_provider_error',
      httpStatus: response.status,
      provider: safeProviderError(payload),
    }));
    throw runtimeError('ADMIN_AI_AGENT_UNAVAILABLE', 'Trợ lý Công Ty tạm thời chưa sẵn sàng', 503, true);
  }
  const parsed = parseAdminAgentRuntimeResponse(bodyText);
  return Object.freeze({
    ...parsed,
    model: config.model,
    occurredAt: now().toISOString(),
    conversationId,
  });
}
