import assert from 'node:assert/strict';
import test from 'node:test';
import { loadInternalWorkforceAuthConfig } from '../src/internal-workforce-config.js';

test('production forces Owner Web/PWA challenge even when stale runtime flag is false', () => {
  const config = loadInternalWorkforceAuthConfig({
    NODE_ENV: 'production',
    INTERNAL_AUTH_ENABLED: 'true',
    INTERNAL_WEB_OWNER_CHALLENGE_REQUIRED: 'false',
  });
  assert.equal(config.webOwnerChallengeRequired, true);
});

test('non-production still honors explicit Owner challenge flag', () => {
  const config = loadInternalWorkforceAuthConfig({
    NODE_ENV: 'test',
    INTERNAL_WEB_OWNER_CHALLENGE_REQUIRED: 'false',
  });
  assert.equal(config.webOwnerChallengeRequired, false);
});
