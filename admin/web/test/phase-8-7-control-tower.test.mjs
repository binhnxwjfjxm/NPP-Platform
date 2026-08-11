import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Admin overview keeps aggregate reporting but routes management work inside Admin', () => {
  const page = source('../app/page.tsx');
  const gateway = source('../lib/control-tower.ts');

  assert.match(gateway, /\/api\/reporting\/control-tower/);
  assert.match(gateway, /isRecord\(data\.filters\)/);
  assert.match(page, /Tổng quan quản trị/);
  assert.match(page, /href="\/approvals"/);
  assert.match(page, /href="\/alerts"/);
  assert.match(page, /href="\/reports"/);
  assert.doesNotMatch(page, /NPP_OPERATIONS_URL|accounting\/cod-reporting|inventory\/reporting|logistics\/reporting/);
  assert.doesNotMatch(page, /requestCore|SELECT\s|INSERT\s|UPDATE\s|DELETE\s/i);
  assert.doesNotMatch(gateway, /CORE_API_SERVER_TOKEN/);
});

test('Admin overview keeps money as exact decimal strings', () => {
  const page = source('../app/page.tsx');
  assert.match(page, /function exactDecimal\(value: string\)/);
  assert.doesNotMatch(page, /Number\(grossMargin|parseFloat\(grossMargin|parseInt\(grossMargin/);
});
