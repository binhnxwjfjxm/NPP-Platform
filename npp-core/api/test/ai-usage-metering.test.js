import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAiUsageSummary,
  calculateUsageUsd,
  canWriteAiUsage,
  normalizeAiUsagePayload,
} from '../src/routes/ai-usage.js';
import { loadConfig } from '../src/config.js';
import { authenticateRequest } from '../src/request-context-base.js';

const customerId = '11111111-1111-4111-8111-111111111111';

function payload(overrides = {}) {
  return {
    source: 'ordering',
    feature: 'ordering-assistant',
    provider: 'google',
    model: 'gemini-2.5-flash',
    serviceTier: 'standard',
    inputModality: 'text',
    customerId,
    providerRequestId: 'provider-request-1',
    conversationId: 'conversation-1',
    occurredAt: '2026-08-24T10:00:00.000Z',
    usageMetadata: {
      promptTokenCount: 1000,
      cachedContentTokenCount: 100,
      candidatesTokenCount: 200,
      thoughtsTokenCount: 50,
      toolUsePromptTokenCount: 20,
      totalTokenCount: 1270,
    },
    ...overrides,
  };
}

test('normalizes provider usage metadata without double counting cached tokens', () => {
  const usage = normalizeAiUsagePayload(payload());
  assert.equal(usage.promptTokens, 1000);
  assert.equal(usage.cachedTokens, 100);
  assert.equal(usage.totalTokens, 1270);
  const amount = calculateUsageUsd(usage, {
    input_usd_per_million: '0.300000000',
    cached_input_usd_per_million: '0.030000000',
    output_usd_per_million: '2.500000000',
    long_context_threshold_tokens: null,
  });
  assert.equal(amount.usageUsd, '0.000904000');
  assert.equal(amount.longContextApplied, false);
});

test('applies the long-context Pro rate only above the configured threshold', () => {
  const usage = normalizeAiUsagePayload(payload({
    model: 'gemini-2.5-pro',
    usageMetadata: {
      promptTokenCount: 200000,
      cachedContentTokenCount: 0,
      candidatesTokenCount: 10,
      thoughtsTokenCount: 0,
      toolUsePromptTokenCount: 1,
      totalTokenCount: 200011,
    },
  }));
  const amount = calculateUsageUsd(usage, {
    input_usd_per_million: '1.250000000',
    cached_input_usd_per_million: '0.125000000',
    output_usd_per_million: '10.000000000',
    long_context_threshold_tokens: '200000',
    long_input_usd_per_million: '2.500000000',
    long_cached_input_usd_per_million: '0.250000000',
    long_output_usd_per_million: '15.000000000',
  });
  assert.equal(amount.longContextApplied, true);
  assert.equal(amount.appliedInputRate, '2.500000000');
});

test('rejects inconsistent provider total token metadata', () => {
  assert.throws(
    () => normalizeAiUsagePayload(payload({ usageMetadata: { ...payload().usageMetadata, totalTokenCount: 999 } })),
    (error) => error.code === 'AI_USAGE_METADATA_INCONSISTENT' && error.statusCode === 400,
  );
});

test('rejects overlong provider request IDs instead of dropping duplicate protection', () => {
  assert.throws(
    () => normalizeAiUsagePayload(payload({ providerRequestId: 'x'.repeat(241) })),
    (error) => error.code === 'AI_USAGE_PAYLOAD_INVALID' && error.statusCode === 400,
  );
  assert.equal(normalizeAiUsagePayload(payload({ providerRequestId: null })).providerRequestId, null);
});

test('Website may be anonymous, Ordering requires a customer, and Admin forbids customer attribution', () => {
  assert.equal(normalizeAiUsagePayload(payload({ source: 'website', customerId: null })).customerId, null);
  assert.equal(normalizeAiUsagePayload(payload({ source: 'website' })).customerId, customerId);
  assert.throws(
    () => normalizeAiUsagePayload(payload({ customerId: null })),
    (error) => error.code === 'AI_USAGE_CUSTOMER_REQUIRED',
  );
  assert.throws(
    () => normalizeAiUsagePayload(payload({ source: 'admin' })),
    (error) => error.code === 'AI_USAGE_CUSTOMER_INVALID',
  );
  assert.equal(normalizeAiUsagePayload(payload({ source: 'admin', customerId: null })).customerId, null);
});

test('Website AI service is write-only for source=website', () => {
  const context = { roles: ['website-ai-service'] };
  assert.equal(canWriteAiUsage(context, { source: 'website' }), true);
  assert.equal(canWriteAiUsage(context, { source: 'ordering' }), false);
  assert.equal(canWriteAiUsage(context, { source: 'admin' }), false);
  assert.equal(canWriteAiUsage({ roles: ['bootstrap'] }, { source: 'ordering' }), true);
});

test('Website AI token resolves to a dedicated principal and cannot reuse a backend token', () => {
  const websiteToken = 'w'.repeat(32);
  const config = loadConfig({
    NODE_ENV: 'test',
    INSTALLATION_ID: 'test-installation',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/test',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'b'.repeat(32),
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    WEBSITE_AI_API_TOKEN: websiteToken,
    WEBSITE_AI_ACTOR_ID: 'service:website-ai',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
  const auth = authenticateRequest({ headers: { authorization: `Bearer ${websiteToken}` } }, config);
  assert.equal(auth.ok, true);
  assert.equal(auth.principal.actorId, 'service:website-ai');
  assert.deepEqual(auth.principal.roles, ['website-ai-service']);
  assert.deepEqual(auth.principal.permissions, []);
  assert.equal(auth.principal.sourceApp, 'website');

  assert.throws(
    () => loadConfig({
      NODE_ENV: 'test',
      INSTALLATION_ID: 'test-installation',
      DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/test',
      DATABASE_SSL_MODE: 'disable',
      BACKEND_API_TOKEN: 'b'.repeat(32),
      CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
      WEBSITE_AI_API_TOKEN: 'b'.repeat(32),
      CORS_ORIGINS: 'http://127.0.0.1:3003',
    }),
    (error) => error.code === 'website_ai_token_reuse_forbidden',
  );
});

test('Lot A fails closed for input modalities without an explicit rate card', () => {
  assert.throws(
    () => normalizeAiUsagePayload(payload({ inputModality: 'audio' })),
    (error) => error.code === 'AI_USAGE_MODALITY_UNSUPPORTED',
  );
});

test('Lot B summary keeps filtered usage separate from lifetime 1000 USD customer credit', async () => {
  const adapter = {
    async query(sql) {
      if (sql.includes('WITH filtered AS')) {
        return { rows: [{
          customer_id: customerId,
          customer_code: 'KH001',
          customer_name: 'Khách A',
          event_count: '2',
          prompt_tokens: '1200',
          cached_tokens: '100',
          output_tokens: '300',
          thinking_tokens: '50',
          tool_use_prompt_tokens: '20',
          total_tokens: '1570',
          period_usage_usd: '12.500000000',
          credit_limit_usd: '1000.00',
          used_usd: '250.000000000',
          remaining_usd: '750.000000000',
          usage_percent: '25.0000',
        }] };
      }
      if (sql.includes('GROUP BY source, model')) {
        return { rows: [{ source: 'ordering', model: 'gemini-2.5-flash', event_count: '2', prompt_tokens: '1200', cached_tokens: '100', output_tokens: '300', thinking_tokens: '50', tool_use_prompt_tokens: '20', total_tokens: '1570', usage_usd: '12.500000000' }] };
      }
      if (sql.includes('GROUP BY source')) {
        return { rows: [{ source: 'ordering', event_count: '2', prompt_tokens: '1200', cached_tokens: '100', output_tokens: '300', thinking_tokens: '50', tool_use_prompt_tokens: '20', total_tokens: '1570', usage_usd: '12.500000000' }] };
      }
      if (sql.includes('GROUP BY model')) {
        return { rows: [{ model: 'gemini-2.5-flash', event_count: '2', prompt_tokens: '1200', cached_tokens: '100', output_tokens: '300', thinking_tokens: '50', tool_use_prompt_tokens: '20', total_tokens: '1570', usage_usd: '12.500000000' }] };
      }
      return { rows: [{ event_count: '2', prompt_tokens: '1200', cached_tokens: '100', output_tokens: '300', thinking_tokens: '50', tool_use_prompt_tokens: '20', total_tokens: '1570', usage_usd: '12.500000000' }] };
    },
  };
  const summary = await buildAiUsageSummary(
    adapter,
    { installationId: 'default' },
    new URL('http://127.0.0.1/api/ai/usage-summary?source=ordering'),
  );
  assert.equal(summary.usageUsd, '12.500000000');
  assert.equal(summary.promptTokens, 1200);
  assert.equal(summary.outputTokens, 300);
  assert.equal(summary.sourceBreakdown[0].source, 'ordering');
  assert.equal(summary.modelBreakdown[0].model, 'gemini-2.5-flash');
  assert.equal(summary.breakdown[0].usageUsd, '12.500000000');
  assert.deepEqual(summary.customerBreakdown[0], {
    customerId,
    customerCode: 'KH001',
    customerName: 'Khách A',
    eventCount: 2,
    promptTokens: 1200,
    cachedTokens: 100,
    outputTokens: 300,
    thinkingTokens: 50,
    toolUsePromptTokens: 20,
    totalTokens: 1570,
    periodUsageUsd: '12.500000000',
    limitUsd: '1000.00',
    usedUsd: '250.000000000',
    remainingUsd: '750.000000000',
    usagePercent: '25.0000',
  });
});

test('Lot B rejects inverted time ranges before querying the ledger', async () => {
  let queried = false;
  const adapter = { async query() { queried = true; return { rows: [] }; } };
  await assert.rejects(
    () => buildAiUsageSummary(
      adapter,
      { installationId: 'default' },
      new URL('http://127.0.0.1/api/ai/usage-summary?from=2026-08-25T00:00:00Z&to=2026-08-24T00:00:00Z'),
    ),
    (error) => error.code === 'AI_USAGE_FILTER_INVALID' && error.statusCode === 400,
  );
  assert.equal(queried, false);
});

test('migration locks the 1000 USD limit, immutable ledger and versioned rates without profit fields', () => {
  const sql = readFileSync(new URL('../../../database/migrations/shared/111_ai_usage_metering.sql', import.meta.url), 'utf8');
  assert.match(sql, /credit_limit_usd numeric\(18,2\) NOT NULL DEFAULT 1000\.00/);
  assert.match(sql, /ai_usage_events_append_only/);
  assert.match(sql, /ai_rate_cards_append_only/);
  assert.match(sql, /rate_card_version/);
  assert.doesNotMatch(sql, /profit|margin|revenue/i);
});

test('migration 112 allows anonymous Website usage without weakening Ordering attribution', () => {
  const sql = readFileSync(new URL('../../../database/migrations/shared/112_ai_website_anonymous_usage.sql', import.meta.url), 'utf8');
  assert.match(sql, /OR source = 'website'/);
  assert.match(sql, /source = 'ordering' AND customer_id IS NOT NULL/);
  assert.match(sql, /source = 'admin' AND customer_id IS NULL/);
});

test('migration registry includes 111 and 112 in order', () => {
  const source = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
  const index111 = source.indexOf('111_ai_usage_metering');
  const index112 = source.indexOf('112_ai_website_anonymous_usage');
  assert.ok(index111 >= 0);
  assert.ok(index112 > index111);
});

test('route requires canonical Idempotency-Key before writing usage', () => {
  const source = readFileSync(new URL('../src/routes/ai-usage.js', import.meta.url), 'utf8');
  assert.match(source, /normalizeIdempotencyKey/);
  assert.match(source, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(source, /executeRequestWithIdempotency/);
  assert.match(source, /website-ai-service/);
  assert.doesNotMatch(source, /usageUsd\s*=\s*payload/);
});

test('Lot B summary is backend-owned and exposes source, model and customer drill-down facts', () => {
  const source = readFileSync(new URL('../src/routes/ai-usage.js', import.meta.url), 'utf8');
  assert.match(source, /sourceBreakdown/);
  assert.match(source, /modelBreakdown/);
  assert.match(source, /customerBreakdown/);
  assert.match(source, /periodUsageUsd/);
  assert.match(source, /credit_limit_usd/);
  assert.doesNotMatch(source, /profit|margin|revenue/i);
});
