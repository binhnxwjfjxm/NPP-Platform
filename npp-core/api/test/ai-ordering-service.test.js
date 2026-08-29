import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig, getSanitizedConfig } from '../src/config.js';
import { authenticateRequest } from '../src/request-context-base.js';
import { canWriteAiUsage } from '../src/routes/ai-usage.js';

function env(overrides = {}) {
  return {
    NODE_ENV: 'test',
    INSTALLATION_ID: 'test-installation',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/test',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'b'.repeat(32),
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    ORDERING_AI_API_TOKEN: 'o'.repeat(32),
    ORDERING_AI_ACTOR_ID: 'service:ordering-ai',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

test('Customer Ordering AI token resolves to a dedicated least-privilege principal', () => {
  const config = loadConfig(env());
  const auth = authenticateRequest({ headers: { authorization: `Bearer ${config.orderingAiApiToken}` } }, config);
  assert.equal(auth.ok, true);
  assert.equal(auth.principal.actorId, 'service:ordering-ai');
  assert.deepEqual(auth.principal.roles, ['ordering-ai-service']);
  assert.deepEqual(auth.principal.permissions, []);
  assert.equal(auth.principal.sourceApp, 'customer-ordering');
  assert.equal(getSanitizedConfig(config).orderingAiConfigured, true);
});

test('Customer Ordering AI token cannot be reused from another server capability', () => {
  const shared = 's'.repeat(32);
  assert.throws(
    () => loadConfig(env({ WEBSITE_AI_API_TOKEN: shared, ORDERING_AI_API_TOKEN: shared })),
    (error) => error.code === 'ordering_ai_token_reuse_forbidden',
  );
});

test('Customer Ordering AI service is write-only for source=ordering', () => {
  const context = { roles: ['ordering-ai-service'] };
  assert.equal(canWriteAiUsage(context, { source: 'ordering' }), true);
  assert.equal(canWriteAiUsage(context, { source: 'website' }), false);
  assert.equal(canWriteAiUsage(context, { source: 'admin' }), false);
});

test('Customer Ordering context resolves only active canonical customers and exposes credit, not business data', () => {
  const source = readFileSync(new URL('../src/routes/ai-usage.js', import.meta.url), 'utf8');
  assert.match(source, /ORDERING_CONTEXT_ROOT = '\/api\/ai\/ordering-context'/);
  assert.match(source, /roles\(context\)\.includes\(ORDERING_AI_ROLE\)/);
  assert.match(source, /WHERE installation_id = \$1\s+AND code = \$2\s+AND is_active = true/);
  assert.match(source, /credit: await customerCredit/);
  assert.doesNotMatch(source, /ORDERING_CONTEXT_ROOT[\s\S]{0,1200}(?:orders|sales_orders|inventory|addresses)/i);
});
