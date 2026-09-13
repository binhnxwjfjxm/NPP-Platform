import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const loginPage = read('app/login/page.tsx');
const loginRoute = read('app/api/auth/login/route.ts');
const loginStyles = read('app/login/login.module.css');

test('login UI switches to a dedicated verification screen only from explicit verification state', () => {
  assert.match(loginPage, /type VerificationState = 'owner_code_required' \| 'machine_code_required'/);
  assert.match(loginPage, /parseVerificationState/);
  assert.match(loginPage, /Xác minh thiết bị/);
  assert.match(loginPage, /Đổi tài khoản/);
  assert.doesNotMatch(loginPage, /localStorage|sessionStorage/);
  assert.match(loginRoute, /search\.set\('state', state\)/);
  assert.match(loginRoute, /INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED[\s\S]*owner_code_required/);
  assert.match(loginRoute, /INTERNAL_AUTH_OWNER_CODE_INVALID[\s\S]*owner_code_required/);
  assert.doesNotMatch(loginRoute, /status\s*===\s*403/);
});

test('verification keeps credentials in memory, posts only the visible code step, and gives motion feedback', () => {
  assert.match(loginPage, /useState\(''\)/);
  assert.match(loginPage, /credentials: 'same-origin'/);
  assert.match(loginPage, /formData\.set\('ownerCode', code\.trim\(\)\)/);
  assert.match(loginPage, /submitState === 'loading'/);
  assert.match(loginPage, /submitState === 'success'/);
  assert.match(loginStyles, /@keyframes formOut/);
  assert.match(loginStyles, /@keyframes verifyIn/);
  assert.match(loginStyles, /@keyframes codeShake/);
  assert.match(loginStyles, /@keyframes shieldPulse/);
  assert.match(loginStyles, /prefers-reduced-motion/);
});

test('successful verification sets the session before navigating to a protected page', () => {
  assert.match(loginPage, /headers: \{ Accept: 'application\/json' \}/);
  assert.doesNotMatch(loginPage, /response\.redirected/);
  assert.match(loginPage, /!response\.ok \|\| payload\.ok !== true/);
  assert.match(loginPage, /window\.location\.assign\(target\)/);
  assert.match(loginRoute, /wantsJson\(request\)/);
  assert.match(loginRoute, /requestNppInternalAuth<unknown>\('\/api\/internal-auth\/me'/);
  assert.match(loginRoute, /jsonReply\(\{ ok: true, returnTo \}, 200\)/);
  assert.match(loginRoute, /response\.cookies\.set\(NPP_SESSION_COOKIE, token, nppSessionCookieOptions\(expiresAt\)\)/);
});
