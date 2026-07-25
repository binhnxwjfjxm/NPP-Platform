import test from 'node:test';
import assert from 'node:assert/strict';
import { getSanitizedConfig, loadConfig } from '../src/config.js';

function env(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3004',
    INSTALLATION_ID: 'install-a',
    DATABASE_URL: 'postgresql://user:password@localhost:5432/test',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-1234567890',
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

test('R2 is disabled and the contract route is hidden by default', () => {
  const config = loadConfig(env());
  assert.equal(config.r2Enabled, false);
  assert.equal(config.r2ContractRouteEnabled, false);
});

test('enabled R2 configuration fails closed when any required server value is missing', () => {
  const complete = {
    R2_ENABLED: 'true',
    R2_ENDPOINT: 'https://example.invalid',
    R2_REGION: 'auto',
    R2_BUCKET: 'test-bucket',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
  };

  for (const name of ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    assert.throws(() => loadConfig(env({ ...complete, [name]: '' })), new RegExp(`missing_${name.toLowerCase()}`));
  }
});

test('R2 limits and booleans are validated', () => {
  assert.throws(() => loadConfig(env({ R2_MAX_OBJECT_BYTES: '0' })), /invalid_r2_max_object_bytes/);
  assert.throws(() => loadConfig(env({ R2_PRESIGNED_URL_MAX_SECONDS: '0' })), /invalid_r2_presigned_url_max_seconds/);
  assert.throws(() => loadConfig(env({ R2_ENABLED: 'maybe' })), /invalid_boolean/);
});

test('sanitized config never exposes endpoint, bucket name, access key, secret, or public URL', () => {
  const config = loadConfig(env({
    R2_ENABLED: 'true',
    R2_ENDPOINT: 'https://account.example.invalid',
    R2_REGION: 'auto',
    R2_BUCKET: 'sensitive-bucket-name',
    R2_ACCESS_KEY_ID: 'sensitive-access-key',
    R2_SECRET_ACCESS_KEY: 'sensitive-secret-key',
    R2_PUBLIC_BASE_URL: 'https://public.example.invalid',
    R2_CONTRACT_ROUTE_ENABLED: 'true',
  }));
  const serialized = JSON.stringify(getSanitizedConfig(config));
  assert.doesNotMatch(serialized, /account\.example|sensitive-bucket|sensitive-access|sensitive-secret|public\.example/);
  assert.equal(getSanitizedConfig(config).storage.enabled, true);
  assert.equal(getSanitizedConfig(config).storage.contractRouteEnabled, true);
});
