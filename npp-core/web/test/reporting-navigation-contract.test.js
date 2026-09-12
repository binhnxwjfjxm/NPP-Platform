import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const exists = (path) => existsSync(new URL(path, import.meta.url));

test('8.1 navigation only exposes reporting routes that have real UI pages', () => {
  const shell = source('../app/components/app-shell-core.tsx');
  assert.match(shell, /href: '\/sales\/reporting'.*label: 'Báo cáo bán hàng'/);
  assert.match(shell, /href: '\/purchasing\/reporting'.*label: 'Báo cáo mua hàng'/);
  assert.equal(exists('../app/sales/reporting/page.tsx'), true);
  assert.equal(exists('../app/purchasing/reporting/page.tsx'), true);

  const salesPage = source('../app/sales/reporting/page.tsx');
  const purchasingPage = source('../app/purchasing/reporting/page.tsx');
  assert.match(salesPage, /SalesReportingWorkspace/);
  assert.doesNotMatch(salesPage, /ReportingDashboardWorkspace/);
  assert.match(purchasingPage, /ReportingDashboardWorkspace family="purchasing"/);
});

test('8.1 reporting stays inside Sales and Purchasing app structure', () => {
  const shell = source('../app/components/app-shell-core.tsx');
  const salesWorkspace = source('../app/components/sales-reporting-workspace.tsx');
  const purchasingWorkspace = source('../app/components/reporting-dashboard-workspace.tsx');
  const salesGroup = shell.slice(shell.indexOf('const salesItems'), shell.indexOf('const purchasingItems'));
  const purchasingGroup = shell.slice(shell.indexOf('const purchasingItems'), shell.indexOf('const accountingItems'));

  assert.match(salesGroup, /\/sales\/reporting/);
  assert.doesNotMatch(salesGroup, /\/purchasing\/reporting/);
  assert.match(purchasingGroup, /\/purchasing\/reporting/);
  assert.doesNotMatch(purchasingGroup, /\/sales\/reporting/);
  assert.match(salesWorkspace, /href="\/sales\/sales-orders"/);
  assert.match(salesWorkspace, /href="\/sales\/gross-margin"/);
  assert.match(purchasingWorkspace, /href="\/purchasing\/purchase-orders"/);
  assert.match(purchasingWorkspace, /href="\/purchasing\/goods-receipts"/);
  assert.doesNotMatch(salesWorkspace + purchasingWorkspace, /href="\/reporting/);
});

test('8.1 report actions only target existing Công Ty operational routes', () => {
  assert.equal(exists('../app/sales/sales-orders/page.tsx'), true);
  assert.equal(exists('../app/sales/gross-margin/page.tsx'), true);
  assert.equal(exists('../app/purchasing/purchase-orders/page.tsx'), true);
  assert.equal(exists('../app/purchasing/goods-receipts/page.tsx'), true);

  const salesWorkspace = source('../app/components/sales-reporting-workspace.tsx');
  const purchasingWorkspace = source('../app/components/reporting-dashboard-workspace.tsx');
  assert.match(salesWorkspace, /href="\/sales\/sales-orders"/);
  assert.match(salesWorkspace, /href="\/sales\/gross-margin"/);
  assert.match(purchasingWorkspace, /detailRoute\(family/);
  assert.match(purchasingWorkspace, /sampleDocumentNumber/);
  assert.match(purchasingWorkspace, /entityCode/);
});

test('8.1 browser routes proxy through server-only Công Ty gateway with validated payloads', () => {
  assert.equal(exists('../app/api/reporting/sales/route.ts'), true);
  assert.equal(exists('../app/api/reporting/purchasing/route.ts'), true);
  const gateway = source('../lib/reporting-dashboard-gateway.ts');
  const salesApi = source('../app/api/reporting/sales/route.ts');
  const purchasingApi = source('../app/api/reporting/purchasing/route.ts');
  const salesWorkspace = source('../app/components/sales-reporting-workspace.tsx');
  const purchasingWorkspace = source('../app/components/reporting-dashboard-workspace.tsx');

  assert.match(gateway, /import 'server-only'/);
  assert.match(gateway, /CORE_API_INTERNAL_URL/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.doesNotMatch(gateway, /process\.env\.CORE_API_SERVER_TOKEN/);
  assert.match(gateway, /cache:\s*'no-store'/);
  assert.match(gateway, /\.data\s*===\s*null/);
  assert.match(gateway, /new URLSearchParams/);
  assert.match(gateway, /\/api\/reporting\/\$\{family\}/);
  assert.match(salesWorkspace, /toString\(\)/);
  assert.match(purchasingWorkspace, /toString\(\)/);
  assert.doesNotMatch(gateway + salesWorkspace + purchasingWorkspace, /query\.size/);
  assert.match(salesApi, /getReportingDashboard\(\s*'sales'/s);
  assert.match(purchasingApi, /getReportingDashboard\(\s*'purchasing'/s);
  assert.doesNotMatch(salesWorkspace + purchasingWorkspace, /CORE_API_SERVER_TOKEN|CORE_API_INTERNAL_URL/);
});

test('8.1 Sales summary uses office wording while canonical date basis stays backend-owned', () => {
  const workspace = source('../app/components/sales-reporting-workspace.tsx');
  assert.match(workspace, /Đơn đã chốt/);
  assert.match(workspace, /effectiveOrderCount/);
  assert.match(workspace, /Khách mua/);
  assert.match(workspace, /buyerCount/);
  assert.doesNotMatch(workspace, /sales\.sales_orders\.confirmed_at/);
});

test('8.1 web formatting does not perform business arithmetic with JavaScript Number', () => {
  const salesWorkspace = source('../app/components/sales-reporting-workspace.tsx');
  const purchasingWorkspace = source('../app/components/reporting-dashboard-workspace.tsx');
  assert.match(salesWorkspace, /function formatDecimal/);
  assert.match(purchasingWorkspace, /function formatDecimal/);
  assert.doesNotMatch(salesWorkspace + purchasingWorkspace, /parseFloat\(|parseInt\(|Number\(/);
  assert.doesNotMatch(salesWorkspace, /Xuất CSV|exportCsv/);
});
