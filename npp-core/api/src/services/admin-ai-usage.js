import { randomUUID } from 'node:crypto';
import { calculateUsageUsd, normalizeAiUsagePayload } from '../routes/ai-usage.js';

function meterError(code, message, statusCode = 503, retryable = true, details = {}) {
  return Object.assign(new Error(code), { code, publicMessage: message, statusCode, retryable, details });
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
    throw meterError('AI_RATE_CARD_NOT_FOUND', 'Chưa có bảng quy đổi USD cho model Trợ lý Công Ty', 409, false, {
      provider: usage.provider,
      model: usage.model,
    });
  }
  return result.rows[0];
}

function publicMetering(row) {
  return Object.freeze({
    eventId: String(row.id),
    model: String(row.model),
    totalTokens: Number(row.total_tokens),
    usageUsd: String(row.usage_usd),
    rateCardVersion: String(row.rate_card_version),
  });
}

export async function recordAdminAgentUsage(adapter, requestContext, providerResult, idempotencyKey, requestId, receivedAt) {
  if (!adapter || typeof adapter.connect !== 'function') throw new Error('admin_ai_usage_adapter_invalid');
  const usage = normalizeAiUsagePayload({
    source: 'admin',
    feature: 'company-assistant',
    provider: 'google',
    model: providerResult.model,
    serviceTier: 'standard',
    inputModality: 'text',
    customerId: null,
    providerRequestId: providerResult.providerRequestId,
    conversationId: providerResult.conversationId,
    occurredAt: providerResult.occurredAt,
    usageMetadata: providerResult.usageMetadata,
  }, receivedAt);

  const client = await adapter.connect();
  try {
    await client.query('BEGIN');
    const rateCard = await activeRateCard(client, usage);
    const amount = calculateUsageUsd(usage, rateCard);
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
        $1::uuid,$2,NULL,$3,'admin','company-assistant','google',$4,$5,'text',$6,$7,$8,$9,$10,$11,$12::numeric,
        $13,$14,$15::numeric,$16::numeric,$17::numeric,$18,$19,$20,$21,$22,$23::jsonb,$24::timestamptz
      ) ON CONFLICT (installation_id, actor_id, idempotency_key) DO NOTHING
      RETURNING *`,
      [
        eventId,
        requestContext.installationId,
        requestContext.actorId,
        usage.model,
        usage.serviceTier,
        usage.promptTokens,
        usage.cachedTokens,
        usage.outputTokens,
        usage.thinkingTokens,
        usage.toolUsePromptTokens,
        usage.totalTokens,
        amount.usageUsd,
        rateCard.id,
        rateCard.version,
        amount.appliedInputRate,
        amount.appliedCachedInputRate,
        amount.appliedOutputRate,
        amount.longContextApplied,
        usage.providerRequestId,
        usage.conversationId,
        requestId,
        idempotencyKey,
        JSON.stringify(usage.providerUsageMetadata),
        usage.occurredAt,
      ],
    );

    let row = inserted.rows?.[0] ?? null;
    if (!row) {
      const existing = await client.query(
        `SELECT * FROM shared.ai_usage_events
          WHERE installation_id = $1 AND actor_id = $2 AND idempotency_key = $3
          LIMIT 1`,
        [requestContext.installationId, requestContext.actorId, idempotencyKey],
      );
      row = existing.rows?.[0] ?? null;
    }
    if (!row) throw new Error('admin_ai_usage_record_missing');
    await client.query('COMMIT');
    return publicMetering(row);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') {
      throw meterError('AI_USAGE_PROVIDER_REQUEST_DUPLICATE', 'Lượt dùng Trợ lý Công Ty này đã được ghi nhận', 409, false);
    }
    throw error;
  } finally {
    client.release();
  }
}
