import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('user workspace provisions employee login, role and password before activation', async () => {
  const source = await readFile(new URL('../app/access/users/user-workspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /Mật khẩu đăng nhập/);
  assert.match(source, /isActive:\s*false/);
  assert.match(source, /roleIds:\s*sortedIds\(draft\.roleIds\)/);
  assert.match(source, /\/credential/);
  assert.match(source, /passwordIsValid/);
  assert.match(source, /Tạo tài khoản/);
});

test('credential proxy uses the canonical workforce session and Core credential endpoint', async () => {
  const source = await readFile(new URL('../app/api/access/users/[id]/credential/route.ts', import.meta.url), 'utf8');
  assert.match(source, /requireNppWorkforceSessionToken/);
  assert.match(source, /\/api\/internal-auth\/users\//);
  assert.match(source, /method:\s*'PUT'/);
  assert.match(source, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.doesNotMatch(source, /console\.(log|error).*password/i);
});
