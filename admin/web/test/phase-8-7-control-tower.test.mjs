import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Phase 8.7 Admin is aggregate control tower with NPP drill-down, not duplicate CRUD', () => {
  const page = source('../app/page.tsx');
  const gateway = source('../lib/control-tower.ts');

  assert.match(gateway, /\/api\/reporting\/control-tower/);
  assert.match(gateway, /isRecord\(data\.filters\)/);
  assert.match(gateway, /typeof data\.filters\.from !== 'string'/);
  assert.match(gateway, /typeof data\.filters\.to !== 'string'/);
  assert.match(page, /Control Tower/);
  assert.match(page, /accounting\/cod-reporting/);
  assert.match(page, /inventory\/reporting/);
  assert.match(page, /logistics\/reporting/);
  assert.match(page, /accounting\/aging/);
  assert.match(page, /access\/employees\/performance/);
  assert.match(page, /operations\/audit-history/);
  assert.match(page, /operations\/import-export-history/);
  assert.doesNotMatch(page, /requestCore|SELECT\s|INSERT\s|UPDATE\s|DELETE\s/i);
  assert.doesNotMatch(gateway, /CORE_API_SERVER_TOKEN/);
});

test('Phase 8.7 Admin keeps money as exact decimal strings', () => {
  const page = source('../app/page.tsx');
  assert.match(page, /function exactDecimal\(value: string\)/);
  assert.doesNotMatch(page, /Number\(grossMargin|parseFloat\(grossMargin|parseInt\(grossMargin/);
});
