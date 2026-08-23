import assert from 'node:assert/strict';
import test from 'node:test';
import { loadInternalWorkforceAuthConfig } from '../src/internal-workforce-config.js';

const PERSISTENT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 36_525;

function runtime(overrides = {}) {
  return loadInternalWorkforceAuthConfig({
    NODE_ENV: 'test',
    INTERNAL_AUTH_ENABLED: 'true',
    INTERNAL_SESSION_TTL_SECONDS: '3600',
    INTERNAL_WEB_OWNER_CHALLENGE_REQUIRED: 'false',
    ALLOW_FIXED_OWNER_CODE: 'false',
    ...overrides,
  });
}

test('internal workforce login is not limited by the legacy short session TTL', () => {
  const config = runtime();
  assert.equal(config.sessionTtlSeconds, PERSISTENT_SESSION_TTL_SECONDS);
});

test('legacy session TTL input validation remains fail closed', () => {
  assert.throws(
    () => runtime({ INTERNAL_SESSION_TTL_SECONDS: 'not-a-number' }),
    /INTERNAL_SESSION_TTL_INVALID/,
  );
});

test('persistent login does not relax the production owner verification gate', () => {
  const config = loadInternalWorkforceAuthConfig({
    NODE_ENV: 'production',
    INTERNAL_AUTH_ENABLED: 'true',
    INTERNAL_SESSION_TTL_SECONDS: '28800',
    INTERNAL_WEB_OWNER_CHALLENGE_REQUIRED: 'false',
    ALLOW_FIXED_OWNER_CODE: 'false',
  });
  assert.equal(config.sessionTtlSeconds, PERSISTENT_SESSION_TTL_SECONDS);
  assert.equal(config.webOwnerChallengeRequired, true);
});
