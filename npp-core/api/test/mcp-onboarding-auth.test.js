import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import {
  authenticateRequest,
  createMcpOnboardingPrincipal,
  PERMISSIONS,
  requirePermission,
} from '../src/request-context.js';

function config() {
  return loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3004',
    INSTALLATION_ID: 'installation-a',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'bootstrap-token-0123456789',
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    MCP_ONBOARDING_API_TOKEN: 'mcp-onboarding-token-0123456789',
    MCP_ONBOARDING_ACTOR_ID: 'service:mcp-customer-onboarding',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
}

test('dedicated MCP onboarding token has submit/read permissions only', () => {
  const appConfig = config();
  const principal = createMcpOnboardingPrincipal(appConfig);
  assert.equal(principal.actorId, 'service:mcp-customer-onboarding');
  assert.deepEqual([...principal.permissions].sort(), [
    PERMISSIONS.coreCustomerOnboardingRead,
    PERMISSIONS.coreCustomerOnboardingSubmit,
  ].sort());
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreCustomerOnboardingSubmit).ok, true);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreCustomerOnboardingRead).ok, true);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreCustomerOnboardingReview).ok, false);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreCustomerOnboardingApprove).ok, false);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreCustomerOnboardingLinkExisting).ok, false);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreCustomerOnboardingReject).ok, false);
});

test('MCP token authenticates as the limited service principal and cannot reuse bootstrap token', () => {
  const appConfig = config();
  const result = authenticateRequest({ headers: { authorization: `Bearer ${appConfig.mcpOnboardingApiToken}` } }, appConfig);
  assert.equal(result.ok, true);
  assert.equal(result.principal.sourceApp, 'mcp-plan-backend');
  assert.equal(result.principal.permissions.includes(PERMISSIONS.coreCustomerWrite), false);
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '3004',
      INSTALLATION_ID: 'installation-a',
      DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
      DATABASE_SSL_MODE: 'disable',
      BACKEND_API_TOKEN: 'same-token-0123456789',
      CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
      MCP_ONBOARDING_API_TOKEN: 'same-token-0123456789',
      CORS_ORIGINS: 'http://127.0.0.1:3003',
    }),
    (error) => error.code === 'mcp_onboarding_token_reuse_forbidden'
  );
});
