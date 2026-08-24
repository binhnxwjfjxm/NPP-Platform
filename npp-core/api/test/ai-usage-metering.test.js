import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateUsageUsd, normalizeAiUsagePayload } from '../src/routes/ai-usage.js';

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
  // (900 + 20) * $0.30/M + 100 * $0.03/M + (200 + 50) * $2.50/M
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
    () => normalizeAiUsagePayload(payload({
      usageMetadata: { ...payload().usageMetadata, totalTokenCount: 999 },
    })),
    (error) => error.code === 'AI_USAGE_METADATA_INCONSISTENT' && error.statusCode === 400,
  );
});

test('requires customer attribution for website and ordering, but forbids it for admin', () => {
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

test('Lot A fails closed for input modalities without an explicit rate card', () => {
  assert.throws(
    () => normalizeAiUsagePayload(payload({ inputModality: 'audio' })),
    (error) => error.code === 'AI_USAGE_MODALITY_UNSUPPORTED',
  );
});

test('migration locks the 1000 USD limit, immutable ledger and versioned rates without profit fields', () => {
  const sql = readFileSync(new URL('../../../database/migrations/shared/111_ai_usage_metering.sql', import.meta.url), 'utf8');
  assert.match(sql, /credit_limit_usd numeric\(18,2\) NOT NULL DEFAULT 1000\.00/);
  assert.match(sql, /ai_usage_events_append_only/);
  assert.match(sql, /ai_rate_cards_append_only/);
  assert.match(sql, /rate_card_version/);
  assert.doesNotMatch(sql, /profit|margin|revenue/i);
});

test('migration registry includes 111 after current main migration 110', () => {
  const source = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
  assert.match(source, /111_ai_usage_metering/);
});

test('route requires canonical Idempotency-Key before writing usage', () => {
  const source = readFileSync(new URL('../src/routes/ai-usage.js', import.meta.url), 'utf8');
  assert.match(source, /normalizeIdempotencyKey/);
  assert.match(source, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(source, /executeRequestWithIdempotency/);
  assert.doesNotMatch(source, /usageUsd\s*=\s*payload/);
});
