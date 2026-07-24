import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthContext, extractBearerToken, tokenMatches } from '../index.js';

test('builds an auth context without inventing an installation', () => {
  const context = buildAuthContext();
  assert.equal(context.actorId, 'system:anonymous');
  assert.equal(context.installationId, null);
  assert.ok(context.requestId.startsWith('req_'));
});

test('preserves the server-owned installation identifier', () => {
  const context = buildAuthContext({ installationId: 'npp-hung-phat' });
  assert.equal(context.installationId, 'npp-hung-phat');
});

test('extracts and compares bearer tokens without truncation', () => {
  const expected = '0123456789abcdef0123456789abcdef';
  assert.equal(extractBearerToken(`Bearer ${expected}`), expected);
  assert.equal(extractBearerToken('Basic abc'), null);
  assert.equal(tokenMatches(expected, expected), true);
  assert.equal(tokenMatches(`${expected}x`, expected), false);
  assert.equal(tokenMatches('wrong', expected), false);
});
