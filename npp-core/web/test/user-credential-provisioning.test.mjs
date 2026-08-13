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

test('partial user provisioning keeps the same modal draft and resumes as edit instead of creating again', async () => {
  const source = await readFile(new URL('../app/access/users/user-workspace.tsx', import.meta.url), 'utf8');
  const partialStart = source.indexOf('if (!created) throw caught;');
  const partialEnd = source.indexOf("'USER_PROVISIONING_INCOMPLETE'", partialStart);
  assert.ok(partialStart >= 0 && partialEnd > partialStart, 'partial provisioning recovery branch must exist');
  const recovery = source.slice(partialStart, partialEnd);
  assert.match(recovery, /setEditor\(\{ mode: 'edit', userId: created\.id \}\)/);
  assert.match(recovery, /mergeUser\(refreshed \?\? current, latest\)/);
  assert.doesNotMatch(recovery, /if \(refreshed\) setUsers\(refreshed\)/);
  assert.doesNotMatch(recovery, /closeEditor\(\)|setDraft\(emptyDraft\(\)\)/);
  assert.match(source, /if \(busy === 'save'\) return;/);
});

test('user editor snapshots input values before functional draft state updates', async () => {
  const source = await readFile(new URL('../app/access/users/user-workspace.tsx', import.meta.url), 'utf8');
  const editorStart = source.indexOf('{editor &&');
  const editorEnd = source.indexOf('{toggleState &&', editorStart);
  assert.ok(editorStart >= 0 && editorEnd > editorStart, 'user editor source must be present');
  const editorSource = source.slice(editorStart, editorEnd);

  assert.equal((editorSource.match(/const value = event\.currentTarget\.value;/g) ?? []).length, 3);
  assert.equal((editorSource.match(/const isActive = event\.currentTarget\.value === 'active';/g) ?? []).length, 1);
  assert.doesNotMatch(
    editorSource,
    /setDraft\(\(current\) => \(\{[^}]*event\.currentTarget\.value/s,
    'functional state updaters must not dereference React currentTarget after the handler returns',
  );
});

test('credential proxy uses the canonical workforce session and Core credential endpoint', async () => {
  const source = await readFile(new URL('../app/api/access/users/[id]/credential/route.ts', import.meta.url), 'utf8');
  assert.match(source, /requireNppWorkforceSessionToken/);
  assert.match(source, /\/api\/internal-auth\/users\//);
  assert.match(source, /method:\s*'PUT'/);
  assert.match(source, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.doesNotMatch(source, /console\.(log|error).*password/i);
});
