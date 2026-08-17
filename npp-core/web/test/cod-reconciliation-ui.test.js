import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('COD accounting confirmation lives inside the COD reconciliation tabs and the old route redirects', () => {
  const legacyPage = read('../app/accounting/cod-reconciliation/page.tsx');
  const reportingPage = read('../app/accounting/cod-reporting/page.tsx');
  const reportingWorkspace = read('../app/components/cod-reporting-workspace.tsx');
  const workspace = read('../app/accounting/cod-reconciliation/cod-reconciliation-workspace.tsx');

  assert.match(legacyPage, /redirect\('\/accounting\/cod-reporting\?tab=accounting'\)/);
  assert.match(reportingPage, /listCodHandovers/);
  assert.match(reportingWorkspace, /\{ id: 'accounting', label: 'Kế toán xác nhận' \}/);
  assert.match(reportingWorkspace, /<CodReconciliationWorkspace initialHandovers=\{initialHandovers\}/);
  assert.match(workspace, /cod-reconciliation-workspace/);
  assert.match(workspace, /Đối chiếu và xác nhận/);
  assert.match(workspace, /reverseAcceptance|Đảo xác nhận/);
  assert.match(workspace, /Idempotency-Key/);
});

test('COD accounting mutations reuse the canonical idempotency generator and trim display-only decimal zeroes', () => {
  const workspace = read('../app/accounting/cod-reconciliation/cod-reconciliation-workspace.tsx');

  assert.match(workspace, /import \{ createIdempotencyKey \} from '@npp\/contracts'/);
  assert.match(workspace, /const key = createIdempotencyKey\(prefix\)/);
  assert.doesNotMatch(workspace, /crypto\.randomUUID\(\)/);
  assert.match(workspace, /replace\(\/0\+\$\/, ''\)/);
  assert.doesNotMatch(workspace, /padStart\(6, '0'\)\}`/);
});

test('NPP COD gateway is server-only and forwards the workforce session only on the server', () => {
  const gateway = read('../lib/cod-reconciliation-gateway.ts');
  const route = read('../app/api/cod-reconciliation/[id]/accept/route.ts');
  assert.match(gateway, /server-only/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.doesNotMatch(gateway, /process\.env\.CORE_API_SERVER_TOKEN/);
  assert.doesNotMatch(gateway, /NEXT_PUBLIC_.*TOKEN/);
  assert.match(route, /acceptCodHandover/);
});
