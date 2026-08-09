import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('NPP COD workspace exposes accounting acceptance and append-only reversal actions', () => {
  const page = read('../app/accounting/cod-reconciliation/page.tsx');
  const workspace = read('../app/accounting/cod-reconciliation/cod-reconciliation-workspace.tsx');
  assert.match(page, /title="Đối soát COD"/);
  assert.match(page, /tiền tài xế đang giữ/);
  assert.match(workspace, /cod-reconciliation-workspace/);
  assert.match(workspace, /Đối chiếu và xác nhận/);
  assert.match(workspace, /reverseAcceptance|Đảo xác nhận/);
  assert.match(workspace, /Idempotency-Key/);
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
