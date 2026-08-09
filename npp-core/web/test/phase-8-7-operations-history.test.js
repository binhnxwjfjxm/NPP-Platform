import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Phase 8.7 NPP owns detailed audit and import/export history surfaces', () => {
  const audit = source('../app/operations/audit-history/page.tsx');
  const jobs = source('../app/operations/import-export-history/page.tsx');
  const gateway = source('../lib/operations-history-gateway.ts');

  assert.match(audit, /Audit & hoạt động hệ thống/);
  assert.match(audit, /action/);
  assert.match(audit, /resourceType/);
  assert.match(jobs, /Import \/ Export history/);
  assert.match(jobs, /definitionKey/);
  assert.match(gateway, /\/api\/reporting\/audit-history/);
  assert.match(gateway, /\/api\/reporting\/import-export-history/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.doesNotMatch(gateway, /process\.env\.CORE_API_SERVER_TOKEN/);
  assert.doesNotMatch(audit, /beforeData|afterData/);
});
