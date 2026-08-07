import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('8.5 adds Logistics reporting inside the existing delivery/logistics group', () => {
  const shell = source('../app/components/app-shell-core.tsx');
  assert.match(shell, /href: '\/logistics\/reporting'/);
  assert.match(shell, /label: 'Hiệu suất giao hàng'/);
  assert.match(shell, /testId: 'nav-logistics-reporting'/);
  assert.ok(shell.indexOf("href: '/logistics/reporting'") < shell.indexOf("href: '/logistics/trips'"));
  assert.doesNotMatch(shell, /title: 'Reporting'|sectionLabel: 'Reporting'/);
});

test('8.5 page and gateway use a real server-only reporting path without fake export', () => {
  const page = source('../app/logistics/reporting/page.tsx');
  const workspace = source('../app/components/logistics-reporting-workspace.tsx');
  const gateway = source('../lib/logistics-reporting-gateway.ts');
  assert.match(page, /LogisticsReportingWorkspace/);
  assert.match(workspace, /\/api\/reporting\/logistics/);
  assert.match(workspace, /\/logistics\/trips/);
  assert.match(workspace, /\/logistics\/delivery-attempts/);
  assert.match(workspace, /\/logistics\/trip-reconciliation/);
  assert.match(workspace, /\/inventory\/delivery-orders/);
  assert.match(gateway, /import 'server-only'/);
  assert.match(gateway, /CORE_API_SERVER_TOKEN/);
  assert.match(gateway, /cache: 'no-store'/);
  assert.doesNotMatch(workspace, /export|csv|download/i);
});