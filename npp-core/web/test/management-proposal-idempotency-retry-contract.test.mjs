import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actions = readFileSync(new URL('../app/management/proposals/actions.ts', import.meta.url), 'utf8');
const forms = readFileSync(new URL('../app/management/proposals/proposal-forms.tsx', import.meta.url), 'utf8');

test('management proposal retry reuses the submitted canonical idempotency key after uncertain failures', () => {
  assert.match(actions, /IDEMPOTENCY_KEY_PATTERN = \/\^\[A-Za-z0-9\._-\]\{1,128\}\$\//);
  assert.equal((actions.match(/return actionError\(error, submittedKey\)/g) ?? []).length, 2);
  assert.match(actions, /error\.retryable \|\| error\.statusCode >= 500/);
  assert.match(actions, /idempotencyKey: submittedKey/);
  assert.equal((forms.match(/state\.idempotencyKey \?\? idempotencyKey/g) ?? []).length, 2);
  assert.equal((forms.match(/value=\{activeIdempotencyKey\}/g) ?? []).length, 2);
});
