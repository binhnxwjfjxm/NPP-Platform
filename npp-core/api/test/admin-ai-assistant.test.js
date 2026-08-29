import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseAdminAgentGatewayResponse,
  readAdminAgentRuntimeConfig,
} from '../src/services/google-admin-agent.js';

test('Admin Agent runtime uses the existing Website AI server channel and Gemini 2.5 Pro', () => {
  const config = readAdminAgentRuntimeConfig({
    ADMIN_AI_GATEWAY_BASE_URL: 'https://www.nguyenlieuhungphat.com',
    WEBSITE_AI_API_TOKEN: 'server-only-token',
    ADMIN_AI_AGENT_MODEL: 'gemini-2.5-pro',
  });
  assert.equal(config.gatewayBaseUrl, 'https://www.nguyenlieuhungphat.com');
  assert.equal(config.model, 'gemini-2.5-pro');
  assert.throws(
    () => readAdminAgentRuntimeConfig({ ADMIN_AI_GATEWAY_BASE_URL: 'http://example.com', WEBSITE_AI_API_TOKEN: 'x' }),
    (error) => error.code === 'ADMIN_AI_GATEWAY_URL_INVALID',
  );
});

test('Admin Agent gateway response keeps provider usage metadata for canonical metering', () => {
  const result = parseAdminAgentGatewayResponse({
    ok: true,
    capability: 'company-admin-ai',
    readOnly: true,
    replyText: 'Doanh số hôm nay đang tăng so với hôm qua.',
    conversationId: 'admin-conversation-1',
    providerRequestId: 'invoke-1',
    model: 'gemini-2.5-pro',
    occurredAt: '2026-08-29T08:00:00.000Z',
    usageMetadata: {
      promptTokenCount: 150,
      cachedContentTokenCount: 10,
      candidatesTokenCount: 30,
      thoughtsTokenCount: 7,
      toolUsePromptTokenCount: 4,
      totalTokenCount: 191,
    },
  }, 'admin-conversation-1');
  assert.equal(result.replyText, 'Doanh số hôm nay đang tăng so với hôm qua.');
  assert.equal(result.providerRequestId, 'invoke-1');
  assert.equal(result.usageMetadata.totalTokenCount, 191);
});

test('Admin Agent source is read-only, backend-owned and writes source=admin through the canonical USD calculator', () => {
  const route = readFileSync(new URL('../src/routes/admin-ai-assistant.js', import.meta.url), 'utf8');
  const meter = readFileSync(new URL('../src/services/admin-ai-usage.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../src/services/google-admin-agent.js', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../src/customer-portal-server.js', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../../../database/migrations/shared/111_ai_usage_metering.sql', import.meta.url), 'utf8');

  assert.match(route, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(route, /readOnly: true/);
  assert.match(route, /system:security-owner/);
  assert.match(route, /system:implementation-owner/);
  assert.match(meter, /normalizeAiUsagePayload/);
  assert.match(meter, /calculateUsageUsd/);
  assert.match(meter, /source: 'admin'/);
  assert.match(meter, /feature: 'company-assistant'/);
  assert.match(runtime, /ADMIN_AI_GATEWAY_BASE_URL/);
  assert.match(runtime, /WEBSITE_AI_API_TOKEN/);
  assert.match(runtime, /x-company-admin-ai-gateway/);
  assert.match(runtime, /redirect: 'error'/);
  assert.doesNotMatch(runtime, /SERVICE_ACCOUNT_JSON|private_key|oauth2\.googleapis\.com|reasoningEngines/);
  assert.match(server, /handleAdminAiAssistantRoutes/);
  assert.match(migration, /google\.gemini-2\.5-pro\.standard\.2026-08-24/);
  assert.doesNotMatch(route, /UPDATE\s+shared\.|DELETE\s+FROM\s+shared\./i);
});
