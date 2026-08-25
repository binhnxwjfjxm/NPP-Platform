import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeAiUsagePayload } from '../src/routes/ai-usage.js';

const migration = readFileSync(
  new URL('../../../database/migrations/shared/113_ai_dialogflow_cx_request_billing.sql', import.meta.url),
  'utf8',
);

test('Dialogflow CX request metadata stays request-based with zero invented tokens', () => {
  const usage = normalizeAiUsagePayload({
    source: 'website',
    feature: 'assistant',
    provider: 'google',
    model: 'dialogflow-cx-flow-text',
    serviceTier: 'standard',
    inputModality: 'text',
    customerId: null,
    providerRequestId: 'cx-response-1',
    conversationId: 'cx-session-1',
    occurredAt: '2026-08-25T00:00:00.000Z',
    usageMetadata: {
      requestCount: 1,
      billingUnit: 'text-request',
      requestClass: 'flow',
    },
  });

  assert.equal(usage.promptTokens, 0);
  assert.equal(usage.outputTokens, 0);
  assert.equal(usage.totalTokens, 0);
  assert.deepEqual(usage.providerUsageMetadata, {
    requestCount: 1,
    billingUnit: 'text-request',
    requestClass: 'flow',
  });
});

test('Dialogflow CX migration prices Flow and Playbook requests without rewriting token rate cards', () => {
  assert.match(migration, /dialogflow-cx-flow-text/);
  assert.match(migration, /'request', 0\.007/);
  assert.match(migration, /dialogflow-cx-playbook-text/);
  assert.match(migration, /'request', 0\.012/);
  assert.match(migration, /requestCount/);
  assert.match(migration, /billingUnit/);
  assert.match(migration, /requestClass/);
  assert.match(migration, /Request-priced AI usage must not invent token counts/);
  assert.match(migration, /BEFORE INSERT ON shared\.ai_usage_events/);
  assert.doesNotMatch(migration, /UPDATE\s+shared\.ai_rate_cards/i);
});