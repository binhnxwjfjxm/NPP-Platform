import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseAdminAgentResourceName,
  parseAdminAgentRuntimeResponse,
} from '../src/services/google-admin-agent.js';

test('Admin Agent accepts only the production Agent Runtime ReasoningEngine resource shape', () => {
  const parsed = parseAdminAgentResourceName('projects/hck-agent-chat-prod/locations/us-central1/reasoningEngines/1234567890');
  assert.equal(parsed.projectId, 'hck-agent-chat-prod');
  assert.equal(parsed.location, 'us-central1');
  assert.equal(parsed.resourceId, '1234567890');
  assert.throws(
    () => parseAdminAgentResourceName('projects/hck-agent-chat-prod/locations/global/agents/e326abbf-77f7-4b16-996c-64408c4dd136'),
    (error) => error.code === 'ADMIN_AI_AGENT_RESOURCE_INVALID',
  );
});

test('Admin Agent Runtime parser keeps the final office reply and aggregates actual provider token metadata', () => {
  const body = [
    'data: {"id":"evt-1","invocation_id":"invoke-1","content":{"role":"model","parts":[{"text":"Đang tổng hợp số liệu."}]},"usage_metadata":{"prompt_token_count":100,"cached_content_token_count":10,"candidates_token_count":20,"thoughts_token_count":5,"tool_use_prompt_token_count":3,"total_token_count":128}}',
    '',
    'data: {"id":"evt-2","invocation_id":"invoke-1","content":{"role":"model","parts":[{"text":"Doanh số hôm nay đang tăng so với hôm qua."}]},"usageMetadata":{"promptTokenCount":50,"cachedContentTokenCount":0,"candidatesTokenCount":10,"thoughtsTokenCount":2,"toolUsePromptTokenCount":1,"totalTokenCount":63}}',
  ].join('\n');
  const result = parseAdminAgentRuntimeResponse(body);
  assert.equal(result.replyText, 'Doanh số hôm nay đang tăng so với hôm qua.');
  assert.equal(result.providerRequestId, 'invoke-1');
  assert.deepEqual(result.usageMetadata, {
    promptTokenCount: 150,
    cachedContentTokenCount: 10,
    candidatesTokenCount: 30,
    thoughtsTokenCount: 7,
    toolUsePromptTokenCount: 4,
    totalTokenCount: 191,
  });
});

test('Admin Agent creates the managed provider session before streaming with that exact session id', () => {
  const runtime = readFileSync(new URL('../src/services/google-admin-agent.js', import.meta.url), 'utf8');
  assert.match(runtime, /class_method: 'async_create_session'/);
  assert.match(runtime, /session_id: sessionId/);
  assert.match(runtime, /ADMIN_AI_AGENT_SESSION_UNAVAILABLE/);
  assert.match(runtime, /:streamQuery\?alt=sse/);
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
  assert.match(runtime, /reasoningEngines/);
  assert.match(runtime, /async_stream_query/);
  assert.match(runtime, /async_create_session/);
  assert.doesNotMatch(runtime, /\/agents\/|Managed Agents API/);
  assert.match(server, /handleAdminAiAssistantRoutes/);
  assert.match(migration, /google\.gemini-2\.5-pro\.standard\.2026-08-24/);
  assert.doesNotMatch(route, /UPDATE\s+shared\.|DELETE\s+FROM\s+shared\./i);
});
