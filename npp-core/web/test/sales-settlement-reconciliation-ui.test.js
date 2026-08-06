import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('Phase 6F.5 workspace keeps filters and actions in the standard page layout', () => {
  const workspace = read('../app/accounting/reconciliation/sales-settlement-reconciliation-workspace.tsx');
  const css = read('../app/accounting/reconciliation/sales-settlement-reconciliation-workspace.module.css');
  assert.match(workspace, /sales-settlement-reconciliation-workspace/);
  assert.match(workspace, /aria-label="Bộ lọc đối soát"/);
  const reset = workspace.indexOf('Đặt lại');
  const exportCsv = workspace.indexOf('Xuất CSV');
  const apply = workspace.indexOf('Áp dụng');
  assert.ok(reset > 0 && exportCsv > reset && apply > exportCsv, 'filter actions must be Reset, Export, Apply');
  assert.match(css, /\.filterActions\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.match(workspace, /Công nợ phải thu/);
  assert.match(workspace, /Đối soát COD/);
});

test('Phase 6F.5 web gateway is server-only and read-only', () => {
  const gateway = read('../lib/sales-settlement-reconciliation-gateway.ts');
  const route = read('../app/api/accounting/reconciliation/route.ts');
  const workspace = read('../app/accounting/reconciliation/sales-settlement-reconciliation-workspace.tsx');
  assert.match(gateway, /server-only/);
  assert.match(gateway, /CORE_API_SERVER_TOKEN/);
  assert.match(gateway, /method: 'GET'/);
  assert.doesNotMatch(gateway, /NEXT_PUBLIC_.*TOKEN/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  assert.doesNotMatch(workspace, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
});

test('Phase 6F.5 keeps drill-down links inside source columns and not as scattered mutations', () => {
  const workspace = read('../app/accounting/reconciliation/sales-settlement-reconciliation-workspace.tsx');
  assert.match(workspace, /\/accounting\/receivables\?search=/);
  assert.match(workspace, /\/sales\/sales-orders\?search=/);
  assert.match(workspace, /\/accounting\/cod-reconciliation/);
  assert.match(workspace, /\/logistics\/trip-reconciliation\?search=/);
  assert.doesNotMatch(workspace, /Đảo|Xác nhận|Phân bổ|Ghi nhận tiền/);
});
