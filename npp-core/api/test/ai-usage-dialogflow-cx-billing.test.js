import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeAiUsagePayload } from '../src/routes/ai-usage.js';

const migration = readFileSync(
  new URL('../../../database/migrations/shared/113_ai_dialogflow_cx_request_billing.sql', import.meta.url),
  'utf8',
);
const configWorkflow = readFileSync(
  new URL('../../../.github/workflows/website-ai-production-config-manual.yml', import.meta.url),
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

test('Website production config gate pins the exact Dialogflow CX identity and credential priority', () => {
  assert.match(configWorkflow, /DIALOGFLOW_CX_PROJECT_ID: hck-agent-chat-prod/);
  assert.match(configWorkflow, /DIALOGFLOW_CX_LOCATION: global/);
  assert.match(configWorkflow, /DIALOGFLOW_CX_AGENT_ID: e326abbf-77f7-4b16-996c-64408c4dd136/);
  assert.match(configWorkflow, /DIALOGFLOW_CX_AGENT_DISPLAY_NAME: Hưng Phát/);
  assert.match(configWorkflow, /DIALOGFLOW_CX_LANGUAGE_CODE: vi/);
  assert.match(configWorkflow, /probeDialogflowAgent/);
  assert.match(configWorkflow, /DIALOGFLOW_CX_IDENTITY=success/);
  const cxCredential = configWorkflow.indexOf("'DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON'");
  const dialogflowCredential = configWorkflow.indexOf("'DIALOGFLOW_SERVICE_ACCOUNT_JSON'");
  const genericCredential = configWorkflow.indexOf("'GOOGLE_SERVICE_ACCOUNT_JSON'");
  assert.ok(cxCredential >= 0 && dialogflowCredential > cxCredential && genericCredential > dialogflowCredential);
  assert.doesNotMatch(configWorkflow, /Hưng Phát - Dialog CX/);
});
