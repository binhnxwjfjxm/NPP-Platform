import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { internalWebChallengeRequired } from '../src/internal-workforce-auth.js';

test('Web/PWA challenge policy is forced for permanent owners and OR-ed across role policy', () => {
  assert.equal(internalWebChallengeRequired({ ownerKind: 'PERMANENT', webLoginChallengeRequired: false }, { webOwnerChallengeRequired: false }), true);
  assert.equal(internalWebChallengeRequired({ ownerKind: 'TEMPORARY', webLoginChallengeRequired: false }, { webOwnerChallengeRequired: true }), true);
  assert.equal(internalWebChallengeRequired({ ownerKind: null, webLoginChallengeRequired: true }, { webOwnerChallengeRequired: false }), true);
  assert.equal(internalWebChallengeRequired({ ownerKind: null, webLoginChallengeRequired: false }, { webOwnerChallengeRequired: true }), false);
});

test('role editor exposes an explicit Web/PWA login challenge toggle', async () => {
  const source = await readFile(new URL('../../web/app/access/roles/role-workspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /role-web-login-challenge-toggle/);
  assert.match(source, /webLoginChallengeRequired/);
});

test('production challenge uses one bounded Cloudflare request to the authenticating employee email after DB transaction', async () => {
  const source = await readFile(new URL('../src/internal-workforce-auth.js', import.meta.url), 'utf8');
  assert.match(source, /AbortSignal\.timeout\(CHALLENGE_EMAIL_TIMEOUT_MS\)/);
  assert.match(source, /identity\.employee_email/);
  assert.match(source, /to:\s*\[recipientEmail\]/);
  assert.match(source, /from:\s*\{\s*address:\s*runtime\.from,\s*name:\s*'Hưng Phát Security'\s*\}/s);
  assert.match(source, /recipientCount:\s*1/);
  assert.match(source, /không dùng cho ngân hàng/i);
  assert.match(source, /INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED/);
  const transactionStart = source.indexOf('const transactionResult = await withAuditOutboxTransaction');
  const deliveryStart = source.indexOf('if (transactionResult.challengeDelivery)');
  assert.ok(transactionStart >= 0 && deliveryStart > transactionStart);
  const transactionSection = source.slice(transactionStart, deliveryStart);
  assert.doesNotMatch(transactionSection, /await sendLoginChallengeEmail/);
  assert.match(transactionSection, /expectedAuditCount: 2/);
});

test('owner credential bootstrap is runtime-secret driven and follows canonical DB SSL config', async () => {
  const source = await readFile(new URL('../scripts/bootstrap-workforce-owners.js', import.meta.url), 'utf8');
  assert.match(source, /OWNER_BOOTSTRAP_CREDENTIALS_JSON/);
  assert.match(source, /setInternalUserCredential/);
  assert.match(source, /allowSecurityOwnerMutation: true/);
  assert.match(source, /buildSslConfig\(sslMode\)/);
  assert.match(source, /securityOwnerEmails\.length !== 2 \|\| config\.implementationOwnerEmails\.length !== 1/);
  assert.doesNotMatch(source, /password\s*:\s*['"][^'"]+['"]/);
});
