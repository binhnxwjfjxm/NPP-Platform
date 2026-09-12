import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const exists = (path) => existsSync(new URL(path, import.meta.url));

test('Báo cáo bán hàng dùng workspace riêng, Báo cáo mua hàng giữ workspace hiện tại', () => {
  const shell = source('../app/components/app-shell-core.tsx');
  assert.match(shell, /href: '\/sales\/reporting'.*label: 'Báo cáo bán hàng'/);
  assert.match(shell, /href: '\/purchasing\/reporting'.*label: 'Báo cáo mua hàng'/);
  assert.equal(exists('../app/sales/reporting/page.tsx'), true);
  assert.equal(exists('../app/purchasing/reporting/page.tsx'), true);
  assert.equal(exists('../app/components/sales-reporting-workspace.tsx'), true);

  const salesPage = source('../app/sales/reporting/page.tsx');
  const purchasingPage = source('../app/purchasing/reporting/page.tsx');
  assert.match(salesPage, /SalesReportingWorkspace/);
  assert.doesNotMatch(salesPage, /ReportingDashboardWorkspace/);
  assert.match(purchasingPage, /ReportingDashboardWorkspace family="purchasing"/);
});

test('Báo cáo bán hàng và mua hàng vẫn nằm đúng nhóm nghiệp vụ', () => {
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

test('Các liên kết từ báo cáo chỉ trỏ tới màn nghiệp vụ có thật', () => {
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

test('Các route báo cáo trên trình duyệt tiếp tục đi qua gateway máy chủ và payload đã kiểm tra', () => {
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

test('Báo cáo bán hàng dùng ngôn ngữ văn phòng, còn nguồn ngày xác nhận được giữ ở contract backend', () => {
  const workspace = source('../app/components/sales-reporting-workspace.tsx');
  const salesBackend = source('../../api/src/routes/reporting-sales.js');

  assert.match(workspace, /Đơn đã chốt/);
  assert.match(workspace, /Đơn đã xác nhận hoặc đã đóng trong kỳ/);
  assert.doesNotMatch(workspace, /sales\.sales_orders\.confirmed_at/);
  assert.match(salesBackend, /sales\.sales_orders\.confirmed_at/);
  assert.match(salesBackend, /effectiveStates: Object\.freeze\(\['confirmed', 'closed'\]\)/);
});

test('Định dạng số trên web không thực hiện phép tính nghiệp vụ bằng JavaScript Number', () => {
  const salesWorkspace = source('../app/components/sales-reporting-workspace.tsx');
  const purchasingWorkspace = source('../app/components/reporting-dashboard-workspace.tsx');
  const workspaces = salesWorkspace + purchasingWorkspace;

  assert.match(salesWorkspace, /function formatDecimal/);
  assert.match(purchasingWorkspace, /function formatDecimal/);
  assert.doesNotMatch(workspaces, /parseFloat\(|parseInt\(|Number\(/);
  assert.doesNotMatch(workspaces, /Xuất CSV|exportCsv/);
});
