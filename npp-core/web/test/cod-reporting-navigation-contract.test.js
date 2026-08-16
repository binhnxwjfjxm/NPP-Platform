import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Phase 8.6 exposes COD reporting in Accounting without a global Reporting menu', () => {
  const shell = source('../app/components/app-shell-core.tsx');
  const page = source('../app/accounting/cod-reporting/page.tsx');
  const workspace = source('../app/components/cod-reporting-workspace.tsx');
  assert.match(shell, /\/accounting\/cod-reporting/);
  assert.match(shell, /COD và đối soát/);
  assert.match(page, /CodReportingWorkspace/);
  assert.match(workspace, /cod-reporting-workspace/);
  assert.doesNotMatch(shell, /title:\s*'Reporting'/);
});

test('Phase 8.6 gateway is server-only GET and reporting workspace stays read-only', () => {
  const gateway = source('../lib/cod-reporting-gateway.ts');
  const route = source('../app/api/reporting/cod/route.ts');
  const workspace = source('../app/components/cod-reporting-workspace.tsx');
  assert.match(gateway, /server-only/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.doesNotMatch(gateway, /process\.env\.CORE_API_SERVER_TOKEN/);
  assert.match(gateway, /\/api\/reporting\/cod/);
  assert.match(gateway, /method:\s*'GET'/);
  assert.doesNotMatch(gateway, /NEXT_PUBLIC_.*TOKEN/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(workspace, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(workspace, /Number\(/);
});

test('Phase 8.6 renders period collection, handover and acceptance activity without cross-currency totals', () => {
  const workspace = source('../app/components/cod-reporting-workspace.tsx');
  assert.match(workspace, /report\?\.activity\.collections/);
  assert.match(workspace, /report\?\.activity\.handovers/);
  assert.match(workspace, /report\?\.activity\.acceptances/);
  assert.match(workspace, /Bàn giao trong kỳ/);
  assert.match(workspace, /Kế toán tiếp nhận trong kỳ/);
  assert.doesNotMatch(workspace, /reduce\([^\n]*activity\.(handovers|acceptances)/);
});

test('Phase 8.6 keeps real operational drill-down and snapshot-period warning', () => {
  const workspace = source('../app/components/cod-reporting-workspace.tsx');
  assert.match(workspace, /\/accounting\/cod-reconciliation/);
  assert.match(workspace, /\/accounting\/reconciliation/);
  assert.match(workspace, /snapshot hiện tại/);
  assert.match(workspace, /không bị che bởi kỳ báo cáo/);
  assert.doesNotMatch(workspace, /Xuất CSV|exportCsv|download=/);
});
