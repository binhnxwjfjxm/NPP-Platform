import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthContext, sanitizeToken } from '../index.js';

test('builds an auth context with defaults', () => {
  const context = buildAuthContext();
  assert.equal(context.actorId, 'system:anonymous');
  assert.equal(context.installationId, 'default');
  assert.ok(context.requestId.startsWith('req_'));
});

test('sanitizes bearer token input', () => {
  assert.equal(sanitizeToken('  replace-with-local-token   '), 'replace-with-local-token');
  assert.equal(sanitizeToken(''), null);
});
