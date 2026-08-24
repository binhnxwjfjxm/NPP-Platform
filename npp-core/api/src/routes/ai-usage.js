import { randomUUID } from 'node:crypto';
import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';

const EVENTS_ROOT = '/api/ai/usage-events';
const SUMMARY_ROOT = '/api/ai/usage-summary';
const MANAGER_ROLES = new Set(['bootstrap', 'system:security-owner', 'system:implementation-owner']);
const SOURCES = new Set(['admin', 'website', 'ordering']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SLUG = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const SAFE_MODEL = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_TOKEN_COUNT = 10_000_000_000;
const RATE_SCALE = 1_000_000_000n;
const TOKENS_PER_MILLION = 1_000_000n;

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return Object.assign(new Error(code), { code, publicMessage: message, details, retryable, statusCode });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalText(value, max, label) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) {
    throw apiError('AI_USAGE_PAYLOAD_INVALID', `${label} vượt quá độ dài cho phép`, {}, false, 400);
  }
  return normalized;
}

function tokenCount(value, name) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_TOKEN_COUNT) {
    throw apiError('AI_USAGE_PAYLOAD_INVALID', `${name} không hợp lệ`, {}, false, 400);
  }
  return number;
}

function normalizeIso(value, fallback) {
  const candidate = value == null || value === '' ? fallback : value;
  const timestamp = Date.parse(String(candidate));
  if (!Number.isFinite(timestamp)) throw apiError('AI_USAGE_PAYLOAD_INVALID', 'Thời điểm sử dụng AI không hợp lệ', {}, false, 400);
  return new Date(timestamp).toISOString();
}

export function normalizeAiUsagePayload(payload, receivedAt = new Date().toISOString()) {
  if (!plainObject(payload)) throw apiError('AI_USAGE_PAYLOAD_INVALID', 'Dữ liệu mức sử dụng AI không hợp lệ', {}, false, 400);
  const source = String(payload.source ?? '').trim().toLowerCase();
  const feature = String(payload.feature ?? '').trim().toLowerCase();
  const provider = String(payload.provider ?? '').trim().toLowerCase();
  const model = String(payload.model ?? '').trim();
  const serviceTier = String(payload.serviceTier ?? 'standard').trim().toLowerCase();
  const inputModality = String(payload.inputModality ?? 'text').trim().toLowerCase();
  const customerId = optionalText(payload.customerId, 64, 'Mã khách hàng');
  const providerRequestId = optionalText(payload.providerRequestId, 240, 'Mã yêu cầu từ nhà cung cấp AI');
  const conversationId = optionalText(payload.conversationId, 240, 'Mã cuộc hội thoại AI');

  if (!SOURCES.has(source) || !SAFE_SLUG.test(feature)) {
    throw apiError('AI_USAGE_PAYLOAD_INVALID', 'Nguồn hoặc tính năng AI không hợp lệ', {}, false, 400);
  }
  if (provider !== 'google' || !SAFE_MODEL.test(model) || serviceTier !== 'standard') {
    throw apiError('AI_USAGE_PAYLOAD_INVALID', 'Nhà cung cấp, model hoặc gói AI không hợp lệ', {}, false, 400);
  }
  if (inputModality !== 'text') {
    throw apiError('AI_USAGE_MODALITY_UNSUPPORTED', 'Lô A chỉ ghi nhận AI dạng văn bản', {}, false, 400);
  }
  if (source === 'admin' && customerId !== null) {
    throw apiError('AI_USAGE_CUSTOMER_INVALID', 'Mức sử dụng AI nội bộ không gắn vào hạn mức khách hàng', {}, false, 400);
  }
  if ((source === 'website' || source === 'ordering') && (!customerId || !UUID_PATTERN.test(customerId))) {
    throw apiError('AI_USAGE_CUSTOMER_REQUIRED', 'Cần xác định khách hàng sử dụng AI', {}, false, 400);
  }
  if (customerId && !UUID_PATTERN.test(customerId)) {
    throw apiError('AI_USAGE_CUSTOMER_INVALID', 'Mã khách hàng không hợp lệ', {}, false, 400);
  }

  const metadata = plainObject(payload.usageMetadata) ? payload.usageMetadata : null;
  if (!metadata) throw apiError('AI_USAGE_METADATA_REQUIRED', 'Thiếu số liệu sử dụng do nhà cung cấp AI trả về', {}, false, 400);
  const promptTokens = tokenCount(metadata.promptTokenCount, 'Token đầu vào');
  const cachedTokens = tokenCount(metadata.cachedContentTokenCount, 'Token bộ nhớ đệm');
  const outputTokens = tokenCount(metadata.candidatesTokenCount, 'Token đầu ra');
  const thinkingTokens = tokenCount(metadata.thoughtsTokenCount, 'Token suy luận');
  const toolUsePromptTokens = tokenCount(metadata.toolUsePromptTokenCount, 'Token công cụ');
  const totalTokens = tokenCount(metadata.totalTokenCount, 'Tổng token');
  const calculatedTotal = promptTokens + outputTokens + thinkingTokens + toolUsePromptTokens;
  if (cachedTokens > promptTokens || totalTokens !== calculatedTotal) {
    throw apiError('AI_USAGE_METADATA_INCONSISTENT', 'Số liệu token từ nhà cung cấp AI không khớp', {
      expectedTotalTokens: calculatedTotal,
      receivedTotalTokens: totalTokens,
    }, false, 400);
  }

  return Object.freeze({
    source,
    feature,
    provider,
    model,
    serviceTier,
    inputModality,
    customerId,
    providerRequestId,
    conversationId,
    promptTokens,
    cachedTokens,
    outputTokens,
    thinkingTokens,
    toolUsePromptTokens,
    totalTokens,
    occurredAt: normalizeIso(payload.occurredAt, receivedAt),
    providerUsageMetadata: Object.freeze({ ...metadata }),
  });
}

function roles(context) {
  return Array.isArray(context?.roles) ? context.roles : [];
}

function canManageAiUsage(context) {
  return roles(context).some((role) => MANAGER_ROLES.has(role));
}

function decimalRateToScaled(value) {
  const raw = String(value ?? '0').trim();
  if (!/^\d+(?:\.\d{1,9})?$/.test(raw)) throw new Error('invalid_ai_rate_card');
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * RATE_SCALE + BigInt((fraction + '000000000').slice(0, 9));
}

function scaledUsd(value) {
  const whole = value / RATE_SCALE;
  const fraction = String(value % RATE_SCALE).padStart(9, '0');
  return `${whole}.${fraction}`;
}

function tokenCost(tokens, rateScaled) {
  return (BigInt(tokens) * rateScaled + (TOKENS_PER_MILLION / 2n)) / TOKENS_PER_MILLION;
}

export function calculateUsageUsd(usage, rateCard) {
  const contextInputTokens = usage.promptTokens + usage.toolUsePromptTokens;
  const longContextApplied = rateCard.long_context_threshold_tokens != null
    && contextInputTokens > Number(rateCard.long_context_threshold_tokens);
  const inputRate = decimalRateToScaled(longContextApplied ? rateCard.long_input_usd_per_million : rateCard.input_usd_per_million);
  const cachedRate = decimalRateToScaled(longContextApplied ? rateCard.long_cached_input_usd_per_million : rateCard.cached_input_usd_per_million);
  const outputRate = decimalRateToScaled(longContextApplied ? rateCard.long_output_usd_per_million : rateCard.output_usd_per_million);
  const uncachedPromptTokens = usage.promptTokens - usage.cachedTokens;
  const billableOutputTokens = usage.outputTokens + usage.thinkingTokens;
  const nanoUsd = tokenCost(uncachedPromptTokens + usage.toolUsePromptTokens, inputRate)
    + tokenCost(usage.cachedTokens, cachedRate)
    + tokenCost(billableOutputTokens, outputRate);
  return Object.freeze({
    usageUsd: scaledUsd(nanoUsd),
    longContextApplied,
    appliedInputRate: scaledUsd(inputRate),
    appliedCachedInputRate: scaledUsd(cachedRate),
    appliedOutputRate: scaledUsd(outputRate),
  });
}

function publicEvent(row) {
  return Object.freeze({
    id: String(row.id),
    customerId: row.customer_id == null ? null : String(row.customer_id),
    source: String(row.source),
    feature: String(row.feature),
    provider: String(row.provider),
    model: String(row.model),
    serviceTier: String(row.service_tier),
    inputModality: String(row.input_modality),
    promptTokens: Number(row.prompt_tokens),
    cachedTokens: Number(row.cached_tokens),
    outputTokens: Number(row.output_tokens),
    thinkingTokens: Number(row.thinking_tokens),
    toolUsePromptTokens: Number(row.tool_use_prompt_tokens),
    totalTokens: Number(row.total_tokens),
    usageUsd: String(row.usage_usd),
    rateCardId: String(row.rate_card_id),
    rateCardVersion: String(row.rate_card_version),
    providerRequestId: row.provider_request_id == null ? null : String(row.provider_request_id),
    conversationId: row.conversation_id == null ? null : String(row.conversation_id),
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  });
}

async function activeRateCard(client, usage) {
  const result = await client.query(
    `SELECT * FROM shared.ai_rate_cards
      WHERE provider = $1 AND model = $2 AND service_tier = $3 AND input_modality = $4
        AND effective_from <= $5::timestamptz
        AND (effective_to IS NULL OR effective_to > $5::timestamptz)
      ORDER BY effective_from DESC
      LIMIT 1`,
    [usage.provider, usage.model, usage.serviceTier, usage.inputModality, usage.occurredAt],
  );
  if (result.rows?.length !== 1) {
    throw apiError('AI_RATE_CARD_NOT_FOUND', 'Chưa có bảng quy đổi USD cho model AI này', {
      provider: usage.provider,
      model: usage.model,
      serviceTier: usage.serviceTier,
      inputModality: usage.inputModality,
    }, false, 409);
  }
  return result.rows[0];
}

async function ensureCustomer(client, installationId, customerId) {
  if (!customerId) return;
  const result = await client.query(
    `SELECT id FROM shared.customers
      WHERE installation_id = $1 AND id = $2::uuid AND is_active = true
      LIMIT 1`,
    [installationId, customerId],
  );
  if (result.rows?.length !== 1) {
    throw apiError('AI_USAGE_CUSTOMER_NOT_FOUND', 'Khách hàng không còn hoạt động hoặc không tồn tại', {}, false, 404);
  }
}

async function customerCredit(adapter, installationId, customerId) {
  if (!customerId) return null;
  const result = await adapter.query(
    `WITH ref AS (
       SELECT $1::text AS installation_id, $2::uuid AS customer_id
     ), usage AS (
       SELECT COALESCE(SUM(event.usage_usd), 0)::numeric(18,9) AS used_usd
         FROM ref
         LEFT JOIN shared.ai_usage_events event
           ON event.installation_id = ref.installation_id
          AND event.customer_id = ref.customer_id
     )
     SELECT COALESCE(account.credit_limit_usd, 1000.00)::numeric(18,2) AS credit_limit_usd,
            usage.used_usd,
            GREATEST(COALESCE(account.credit_limit_usd, 1000.00) - usage.used_usd, 0)::numeric(18,9) AS remaining_usd,
            CASE WHEN COALESCE(account.credit_limit_usd, 1000.00) > 0
              THEN ROUND((usage.used_usd / COALESCE(account.credit_limit_usd, 1000.00)) * 100, 4)
              ELSE 100::numeric
            END AS usage_percent
       FROM ref
       CROSS JOIN usage
       LEFT JOIN shared.ai_credit_accounts account
         ON account.installation_id = ref.installation_id
        AND account.customer_id = ref.customer_id`,
    [installationId, customerId],
  );
  const row = result.rows?.[0];
  if (!row) return null;
  return Object.freeze({
    limitUsd: String(row.credit_limit_usd),
    usedUsd: String(row.used_usd),
    remainingUsd: String(row.remaining_usd),
    usagePercent: String(row.usage_percent),
  });
}

async function recordUsage(adapter, context, usage, idempotencyKey) {
  const client = await adapter.connect();
  try {
    await client.query('BEGIN');
    await ensureCustomer(client, context.installationId, usage.customerId);
    const rateCard = await activeRateCard(client, usage);
    const amount = calculateUsageUsd(usage, rateCard);
    if (usage.customerId) {
      await client.query(
        `INSERT INTO shared.ai_credit_accounts (installation_id, customer_id, credit_limit_usd)
         VALUES ($1, $2::uuid, 1000.00)
         ON CONFLICT (installation_id, customer_id) DO NOTHING`,
        [context.installationId, usage.customerId],
      );
    }
    const eventId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO shared.ai_usage_events (
        id, installation_id, customer_id, actor_id, source, feature, provider, model,
        service_tier, input_modality, prompt_tokens, cached_tokens, output_tokens,
        thinking_tokens, tool_use_prompt_tokens, total_tokens, usage_usd,
        rate_card_id, rate_card_version, applied_input_usd_per_million,
        applied_cached_input_usd_per_million, applied_output_usd_per_million,
        long_context_applied, provider_request_id, conversation_id, request_id,
        idempotency_key, provider_usage_metadata, occurred_at
      ) VALUES (
        $1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::numeric,
        $18,$19,$20::numeric,$21::numeric,$22::numeric,$23,$24,$25,$26,$27,$28::jsonb,$29::timestamptz
      ) ON CONFLICT (installation_id, actor_id, idempotency_key) DO NOTHING
        RETURNING *`,
      [eventId, context.installationId, usage.customerId, context.actorId ?? null,
        usage.source, usage.feature, usage.provider, usage.model, usage.serviceTier, usage.inputModality,
        usage.promptTokens, usage.cachedTokens, usage.outputTokens, usage.thinkingTokens,
        usage.toolUsePromptTokens, usage.totalTokens, amount.usageUsd, rateCard.id, rateCard.version,
        amount.appliedInputRate, amount.appliedCachedInputRate, amount.appliedOutputRate,
        amount.longContextApplied, usage.providerRequestId, usage.conversationId, context.requestId,
        idempotencyKey, JSON.stringify(usage.providerUsageMetadata), usage.occurredAt],
    );
    let eventRow = inserted.rows?.[0] ?? null;
    if (!eventRow) {
      const existing = await client.query(
        `SELECT * FROM shared.ai_usage_events
          WHERE installation_id = $1 AND actor_id = $2 AND idempotency_key = $3
          LIMIT 1`,
        [context.installationId, context.actorId, idempotencyKey],
      );
      eventRow = existing.rows?.[0] ?? null;
      if (!eventRow) throw new Error('ai_usage_idempotency_record_missing');
    }
    const credit = await customerCredit(client, context.installationId, usage.customerId);
    await client.query('COMMIT');
    return Object.freeze({ event: publicEvent(eventRow), credit });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') {
      throw apiError('AI_USAGE_PROVIDER_REQUEST_DUPLICATE', 'Lượt sử dụng AI này đã được ghi nhận', {}, false, 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

function parseListQuery(url) {
  const source = String(url.searchParams.get('source') ?? '').trim().toLowerCase();
  const model = String(url.searchParams.get('model') ?? '').trim();
  const customerId = String(url.searchParams.get('customerId') ?? '').trim();
  const from = String(url.searchParams.get('from') ?? '').trim();
  const to = String(url.searchParams.get('to') ?? '').trim();
  const limitRaw = Number(url.searchParams.get('limit') ?? 100);
  const offsetRaw = Number(url.searchParams.get('offset') ?? 0);
  if (source && !SOURCES.has(source)) throw apiError('AI_USAGE_FILTER_INVALID', 'Nguồn AI cần xem không hợp lệ', {}, false, 400);
  if (model && !SAFE_MODEL.test(model)) throw apiError('AI_USAGE_FILTER_INVALID', 'Model AI cần xem không hợp lệ', {}, false, 400);
  if (customerId && !UUID_PATTERN.test(customerId)) throw apiError('AI_USAGE_FILTER_INVALID', 'Mã khách hàng cần xem không hợp lệ', {}, false, 400);
  if (from && !Number.isFinite(Date.parse(from))) throw apiError('AI_USAGE_FILTER_INVALID', 'Mốc thời gian bắt đầu không hợp lệ', {}, false, 400);
  if (to && !Number.isFinite(Date.parse(to))) throw apiError('AI_USAGE_FILTER_INVALID', 'Mốc thời gian kết thúc không hợp lệ', {}, false, 400);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 500 || !Number.isInteger(offsetRaw) || offsetRaw < 0) {
    throw apiError('AI_USAGE_FILTER_INVALID', 'Phân trang mức sử dụng AI không hợp lệ', {}, false, 400);
  }
  return { source, model, customerId, from, to, limit: limitRaw, offset: offsetRaw };
}

async function listUsage(adapter, context, url) {
  const filter = parseListQuery(url);
  const result = await adapter.query(
    `SELECT * FROM shared.ai_usage_events
      WHERE installation_id = $1
        AND ($2::text = '' OR source = $2)
        AND ($3::text = '' OR model = $3)
        AND ($4::text = '' OR customer_id = NULLIF($4::text, '')::uuid)
        AND ($5::text = '' OR occurred_at >= NULLIF($5::text, '')::timestamptz)
        AND ($6::text = '' OR occurred_at < NULLIF($6::text, '')::timestamptz)
      ORDER BY occurred_at DESC, id DESC
      LIMIT $7 OFFSET $8`,
    [context.installationId, filter.source, filter.model, filter.customerId, filter.from, filter.to, filter.limit, filter.offset],
  );
  return Object.freeze({ events: Object.freeze((result.rows ?? []).map(publicEvent)), limit: filter.limit, offset: filter.offset });
}

async function usageSummary(adapter, context, url) {
  const filter = parseListQuery(url);
  const totalResult = await adapter.query(
    `SELECT COUNT(*)::bigint AS event_count,
            COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
            COALESCE(SUM(usage_usd), 0)::numeric(18,9) AS usage_usd
       FROM shared.ai_usage_events
      WHERE installation_id = $1
        AND ($2::text = '' OR source = $2)
        AND ($3::text = '' OR model = $3)
        AND ($4::text = '' OR customer_id = NULLIF($4::text, '')::uuid)
        AND ($5::text = '' OR occurred_at >= NULLIF($5::text, '')::timestamptz)
        AND ($6::text = '' OR occurred_at < NULLIF($6::text, '')::timestamptz)`,
    [context.installationId, filter.source, filter.model, filter.customerId, filter.from, filter.to],
  );
  const breakdown = await adapter.query(
    `SELECT source, model, COUNT(*)::bigint AS event_count,
            COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
            COALESCE(SUM(usage_usd), 0)::numeric(18,9) AS usage_usd
       FROM shared.ai_usage_events
      WHERE installation_id = $1
        AND ($2::text = '' OR source = $2)
        AND ($3::text = '' OR model = $3)
        AND ($4::text = '' OR customer_id = NULLIF($4::text, '')::uuid)
        AND ($5::text = '' OR occurred_at >= NULLIF($5::text, '')::timestamptz)
        AND ($6::text = '' OR occurred_at < NULLIF($6::text, '')::timestamptz)
      GROUP BY source, model
      ORDER BY usage_usd DESC, source, model`,
    [context.installationId, filter.source, filter.model, filter.customerId, filter.from, filter.to],
  );
  let credit = null;
  if (filter.customerId) {
    const exists = await adapter.query(
      `SELECT id FROM shared.customers WHERE installation_id = $1 AND id = $2::uuid LIMIT 1`,
      [context.installationId, filter.customerId],
    );
    if (exists.rows?.length !== 1) throw apiError('AI_USAGE_CUSTOMER_NOT_FOUND', 'Khách hàng không tồn tại', {}, false, 404);
    credit = await customerCredit(adapter, context.installationId, filter.customerId);
  }
  const total = totalResult.rows?.[0] ?? {};
  return Object.freeze({
    eventCount: Number(total.event_count ?? 0),
    totalTokens: Number(total.total_tokens ?? 0),
    usageUsd: String(total.usage_usd ?? '0'),
    credit,
    breakdown: Object.freeze((breakdown.rows ?? []).map((row) => Object.freeze({
      source: String(row.source),
      model: String(row.model),
      eventCount: Number(row.event_count),
      totalTokens: Number(row.total_tokens),
      usageUsd: String(row.usage_usd),
    }))),
  });
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

function sendPublicError(res, error, options, fallbackCode, fallbackMessage) {
  if (error?.publicMessage && error?.statusCode) {
    sendError(res, apiError(error.code ?? fallbackCode, error.publicMessage, error.details ?? {}, Boolean(error.retryable), error.statusCode), options.requestId, options.receivedAt);
    return;
  }
  sendError(res, apiError(fallbackCode, fallbackMessage, {}, true, 503), options.requestId, options.receivedAt);
}

export async function handleAiUsageRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== EVENTS_ROOT && url.pathname !== SUMMARY_ROOT) return false;
  const context = await authenticate(req, res, options);
  if (!context) return true;
  const method = String(req.method ?? 'GET').toUpperCase();
  const adapter = options.getPool();

  if (method === 'GET') {
    if (!canManageAiUsage(context)) {
      sendError(res, apiError('FORBIDDEN', 'Tài khoản hiện tại không có quyền xem mức sử dụng AI', {}, false, 403), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const data = url.pathname === EVENTS_ROOT
        ? await listUsage(adapter, context, url)
        : await usageSummary(adapter, context, url);
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(res, data, options.requestId, options.receivedAt);
    } catch (error) {
      sendPublicError(res, error, options, 'AI_USAGE_READ_FAILED', 'Không tải được mức sử dụng AI');
    }
    return true;
  }

  if (url.pathname !== EVENTS_ROOT || method !== 'POST') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }
  if (!canManageAiUsage(context)) {
    sendError(res, apiError('FORBIDDEN', 'Tài khoản hiện tại không có quyền ghi mức sử dụng AI', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }
  if (req.headers['idempotency-key'] === undefined) {
    sendError(res, apiError('IDEMPOTENCY_KEY_REQUIRED', 'Cần Idempotency-Key cho mỗi lượt ghi mức sử dụng AI', {}, false, 400), options.requestId, options.receivedAt);
    return true;
  }

  let idempotencyKey;
  let payload;
  let usage;
  try {
    idempotencyKey = normalizeIdempotencyKey(req.headers['idempotency-key']);
    payload = await readJsonBody(req);
    usage = normalizeAiUsagePayload(payload, options.receivedAt);
  } catch (error) {
    if (error?.code === 'IDEMPOTENCY_KEY_INVALID') {
      sendError(res, apiError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key chỉ được dùng chữ, số, dấu chấm, gạch dưới hoặc gạch ngang', {}, false, 400), options.requestId, options.receivedAt);
    } else {
      sendPublicError(res, error, options, 'AI_USAGE_PAYLOAD_INVALID', 'Dữ liệu mức sử dụng AI không hợp lệ');
    }
    return true;
  }

  try {
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore,
      req,
      requestContext: context,
      requestId: options.requestId,
      receivedAt: options.receivedAt,
      route: EVENTS_ROOT,
      payload,
      onProcess: async () => ({
        statusCode: 201,
        contentType: 'application/json',
        requestId: options.requestId,
        body: createSuccessEnvelope(
          await recordUsage(adapter, context, usage, idempotencyKey),
          options.requestId,
          options.receivedAt,
        ),
      }),
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch (error) {
    sendPublicError(res, error, options, 'AI_USAGE_WRITE_FAILED', 'Không ghi được mức sử dụng AI');
  }
  return true;
}
