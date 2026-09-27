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
    usageMetadata: { requestCount: 1, billingUnit: 'text-request', requestClass: 'flow' },
  });
  assert.equal(usage.promptTokens, 0);
  assert.equal(usage.outputTokens, 0);
  assert.equal(usage.totalTokens, 0);
  assert.deepEqual(usage.providerUsageMetadata, { requestCount: 1, billingUnit: 'text-request', requestClass: 'flow' });
});

test('Dialogflow CX migration prices Flow and Playbook requests without rewriting token rate cards', () => {
  assert.match(migration, /dialogflow-cx-flow-text/);
  assert.match(migration, /'request', 0\.007/);
  assert.match(migration, /dialogflow-cx-playbook-text/);
  assert.match(migration, /'request', 0\.012/);
  assert.match(migration, /Request-priced AI usage must not invent token counts/);
  assert.doesNotMatch(migration, /UPDATE\s+shared\.ai_rate_cards/i);
});

test('Website production config reads Công Ty runtime from VPS and pins exact CX identity', () => {
  assert.match(configWorkflow, /VPS_COMPANY_HOST:/);
  assert.match(configWorkflow, /VPS_COMPANY_SSH_KEY/);
  assert.match(configWorkflow, /\/etc\/npp\/company\.env/);
  assert.match(configWorkflow, /WEBSITE_AI_API_TOKEN/);
  assert.match(configWorkflow, /WEBSITE_AI_ACTOR_ID: service:website-ai/);
  assert.match(configWorkflow, /^\s*DIALOGFLOW_CX_PROJECT_ID: hck-agent-chat-prod$/m);
  assert.match(configWorkflow, /DIALOGFLOW_CX_LOCATION: global/);
  assert.match(configWorkflow, /DIALOGFLOW_CX_AGENT_ID: e326abbf-77f7-4b16-996c-64408c4dd136/);
  assert.match(configWorkflow, /DIALOGFLOW_CX_AGENT_DISPLAY_NAME: Hưng Phát/);
  assert.match(configWorkflow, /DIALOGFLOW_CX_LANGUAGE_CODE: vi/);
  assert.match(configWorkflow, /probeDialogflowAgent/);
  assert.match(configWorkflow, /body\?\.displayName !== DIALOGFLOW_CX_AGENT_DISPLAY_NAME/);
  assert.match(configWorkflow, /let credentialMode = 'runtime'/);
  assert.match(configWorkflow, /let dialogflowIdentity = 'runtime_unverified'/);
  assert.match(configWorkflow, /dialogflowIdentity = 'success'/);
  const cxCredential = configWorkflow.indexOf("'DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON'");
  const dialogflowCredential = configWorkflow.indexOf("'DIALOGFLOW_SERVICE_ACCOUNT_JSON'");
  const genericCredential = configWorkflow.indexOf("'GOOGLE_SERVICE_ACCOUNT_JSON'");
  assert.ok(cxCredential >= 0 && dialogflowCredential > cxCredential && genericCredential > dialogflowCredential);
  assert.match(configWorkflow, /const presentCredentialKeys = credentialKeys\.filter/);
  assert.match(configWorkflow, /for \(const key of presentCredentialKeys\) assertSecretMetadata\(vercelEnv, key\)/);
  assert.match(configWorkflow, /const selectedCredentialKey = presentCredentialKeys\[0\]/);
  assert.match(configWorkflow, /const selectedCredentialDecrypted = selectedCredentialEntry\?\.decrypted === true/);
  assert.match(configWorkflow, /if \(selectedCredentialDecrypted && !serviceAccount\)/);
  assert.match(configWorkflow, /const finalCredentialKeys = credentialKeys\.filter/);
  assert.match(configWorkflow, /finalCredentialKeys\[0\] !== selectedCredentialKey/);
  assert.match(configWorkflow, /COMPANY_WEBSITE_AI_API_TOKEN/);
  assert.match(configWorkflow, /\/health\/live/);
  assert.match(configWorkflow, /\/health\/ready/);
});
