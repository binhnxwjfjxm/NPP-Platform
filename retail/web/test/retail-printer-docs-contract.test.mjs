import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('Retail printer device checklist khóa direct thermal và rollout tách biệt', async () => {
  const [checklist, handoff, addendum] = await Promise.all([
    readRepo('docs/operations/retail-printer-device-verification.md'),
    readRepo('docs/operations/issue-810-retail-printer-handoff.md'),
    readRepo('docs/operations/master-plan-frontend-runtime-addendum.md'),
  ]);
  assert.match(checklist, /iPhone thật \+ máy in thật/);
  assert.match(checklist, /không tự in lại|không tự fallback gây in trùng/);
  assert.match(handoff, /PWA thuần không giả kết nối raw TCP/);
  assert.match(handoff, /K80\/K58/);
  assert.match(addendum, /device shell/);
  assert.match(addendum, /not an eighth Vercel project|không phải.*Vercel/i);
  assert.match(addendum, /TestFlight\/App Store rollout/);
});
