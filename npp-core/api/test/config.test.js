import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, getSanitizedConfig, parseCorsOrigins } from '../src/config.js';

function validEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '3004',
    INSTALLATION_ID: 'npp-hung-phat',
    DATABASE_URL: 'postgresql://user:password@db.example.com:5432/npp_platform',
    DATABASE_SSL_MODE: 'require',
    BACKEND_API_TOKEN: '0123456789abcdef0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    CORS_ORIGINS: 'https://npp.example.com',
    ...overrides,
  };
}

test('production config is fail-fast', () => {
  assert.throws(() => loadConfig(validEnv({ DATABASE_URL: '' })), /missing_database_url/);
  assert.throws(() => loadConfig(validEnv({ BACKEND_API_TOKEN: '' })), /missing_backend_api_token/);
  assert.throws(() => loadConfig(validEnv({ INSTALLATION_ID: '' })), /missing_installation_id/);
  assert.throws(() => loadConfig(validEnv({ CORS_ORIGINS: '' })), /missing_cors_origins/);
  assert.throws(() => loadConfig(validEnv({ DATABASE_URL: 'https://db.example.com' })), /invalid_database_url/);
  assert.throws(() => loadConfig(validEnv({ DATABASE_SSL_MODE: 'loose' })), /invalid_database_ssl_mode/);
  assert.throws(() => loadConfig(validEnv({ BACKEND_API_TOKEN: 'replace-with-local-token' })), /backend_api_token/);
  assert.throws(() => loadConfig(validEnv({ CORE_BOOTSTRAP_ACTOR_ID: '' })), /missing_core_bootstrap_actor_id/);
});

test('loadConfig returns validated server-owned values', () => {
  const config = loadConfig(validEnv());
  assert.equal(config.port, 3004);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.installationId, 'npp-hung-phat');
  assert.equal(config.databaseSslMode, 'require');
  assert.deepEqual(config.corsOrigins, ['https://npp.example.com']);
  assert.equal(config.coreBootstrapActorId, 'bootstrap:core-api');
  assert.equal(config.mcpOnboardingApiToken, '');
  assert.equal(config.mcpOnboardingActorId, '');
});

test('getSanitizedConfig omits secrets', () => {
  const sanitized = getSanitizedConfig(loadConfig(validEnv()));
  assert.equal(sanitized.installationId, 'npp-hung-phat');
  assert.ok(!('databaseUrl' in sanitized));
  assert.ok(!('backendApiToken' in sanitized));
  assert.ok(!('mcpOnboardingApiToken' in sanitized));
  assert.equal(sanitized.mcpOnboardingConfigured, false);
});

test('development CORS default is the Core web origin', () => {
  assert.deepEqual(parseCorsOrigins('', { nodeEnv: 'development' }), ['http://127.0.0.1:3003']);
});
