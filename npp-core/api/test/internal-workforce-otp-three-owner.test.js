import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('login challenge is delivered only to the authenticating employee canonical email', async () => {
  const source = await readFile(new URL('../src/internal-workforce-auth.js', import.meta.url), 'utf8');
  assert.match(source, /identity\.employee_email/);
  assert.match(source, /recipientEmail/);
  assert.match(source, /to:\s*\[recipientEmail\]/);
  assert.match(source, /recipientCount:\s*1/);
  assert.match(source, /không dùng cho ngân hàng/i);
  assert.doesNotMatch(source, /to:\s*challengeRecipients/);
});

test('temporary and permanent Owners both remain subject to Web PWA challenge policy', async () => {
  const source = await readFile(new URL('../src/internal-workforce-auth.js', import.meta.url), 'utf8');
  assert.match(source, /ownerKind === 'PERMANENT'/);
  assert.match(source, /ownerKind === 'TEMPORARY'/);
});
