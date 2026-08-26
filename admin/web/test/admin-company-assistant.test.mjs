import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relative) {
  return readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
}

test('Trợ lý Công Ty stays inside Báo cáo and does not create a fifth top-level Admin section', () => {
  const reports = source('app/reports/page.tsx');
  const shell = source('app/admin-shell.tsx');
  const page = source('app/reports/company-assistant/page.tsx');
  assert.match(reports, /href: '\/reports\/company-assistant'/);
  assert.match(reports, /label: 'Trợ lý Công Ty'/);
  assert.match(page, /activeSection="reports"/);
  assert.match(page, /chỉ mở quyền đọc/);
  assert.deepEqual([...shell.matchAll(/section: '(overview|approvals|alerts|reports)'/g)].map((match) => match[1]), [
    'overview', 'approvals', 'alerts', 'reports',
  ]);
});

test('Admin assistant caller reuses the shared canonical Idempotency-Key on retry', () => {
  const client = source('app/reports/company-assistant/company-assistant-chat.tsx');
  const api = source('app/api/assistant/chat/route.ts');
  assert.match(client, /createIdempotencyKey\('admin-assistant'\)/);
  assert.match(client, /sendAttempt\(failedAttempt\)/);
  assert.match(client, /'Idempotency-Key': attempt\.idempotencyKey/);
  assert.match(api, /isValidIdempotencyKey/);
  assert.match(api, /idempotencyKey,/);
  assert.doesNotMatch(client, /replace\(\/\[\^A-Za-z0-9/);
});

test('Admin browser never calls Google or PostgreSQL directly', () => {
  const client = source('app/reports/company-assistant/company-assistant-chat.tsx');
  const api = source('app/api/assistant/chat/route.ts');
  assert.match(client, /fetch\('\/api\/assistant\/chat'/);
  assert.match(api, /requestCore<AssistantResponse>\('\/api\/ai\/admin-assistant'/);
  assert.doesNotMatch(client, /googleapis\.com|reasoningEngines|postgres|DATABASE_URL/i);
  assert.doesNotMatch(api, /googleapis\.com|reasoningEngines|postgres|DATABASE_URL/i);
});

test('Admin assistant uses office language and exposes metering status without developer jargon', () => {
  const client = source('app/reports/company-assistant/company-assistant-chat.tsx');
  assert.match(client, /Dành cho Chủ Công Ty/);
  assert.match(client, /chưa cho phép hành động/);
  assert.match(client, /token ·/);
  assert.doesNotMatch(client, /stack trace|SQLSTATE|raw field|database column/i);
});
