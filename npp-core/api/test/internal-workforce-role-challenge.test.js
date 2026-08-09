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

test('role editor exposes an explicit Web/PWA owner-code toggle', async () => {
  const source = await readFile(new URL('../../web/app/access/roles/role-workspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /role-web-login-challenge-toggle/);
  assert.match(source, /webLoginChallengeRequired/);
  assert.match(source, /Đăng nhập Web\/PWA yêu cầu mã xác nhận của chủ sở hữu/);
});

test('owner credential bootstrap is runtime-secret driven and does not embed owner passwords', async () => {
  const source = await readFile(new URL('../scripts/bootstrap-workforce-owners.js', import.meta.url), 'utf8');
  assert.match(source, /OWNER_BOOTSTRAP_CREDENTIALS_JSON/);
  assert.match(source, /setInternalUserCredential/);
  assert.match(source, /allowSecurityOwnerMutation: true/);
  assert.doesNotMatch(source, /password\s*:\s*['"][^'"]+['"]/);
});
