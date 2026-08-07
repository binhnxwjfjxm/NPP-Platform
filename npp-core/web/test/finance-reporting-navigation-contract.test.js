import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const exists = (path) => existsSync(new URL(path, import.meta.url));

test('8.3 places gross margin in Sales and aging in Accounting with real pages', () => {
  const shell = source('../app/components/app-shell-core.tsx');
  for (const marker of ['const salesItems', 'const purchasingItems', 'const accountingItems', 'function Icon']) {
    assert.ok(shell.includes(marker), `Thiếu mốc ${marker} trong app-shell-core.tsx`);
  }
  const salesGroup = shell.slice(shell.indexOf('const salesItems'), shell.indexOf('const purchasingItems'));
  const accountingGroup = shell.slice(shell.indexOf('const accountingItems'), shell.indexOf('function Icon'));
  assert.match(salesGroup, /href: '\/sales\/gross-margin'.*label: 'Lãi gộp'.*testId: 'nav-gross-margin-reporting'/);
  assert.match(accountingGroup, /href: '\/accounting\/aging'.*label: 'Tuổi nợ'.*testId: 'nav-aging-reporting'/);
  assert.equal(exists('../app/sales/gross-margin/page.tsx'), true);
  assert.equal(exists('../app/accounting/aging/page.tsx'), true);
  assert.equal(exists('../app/components/gross-margin-reporting-workspace.tsx'), true);
  assert.equal(exists('../app/components/aging-reporting-workspace.tsx'), true);
  assert.doesNotMatch(shell, /href: '\/reporting'/);
});

test('8.3 browser routes proxy only through server-only Core gateway', () => {
  assert.equal(exists('../app/api/reporting/aging/route.ts'), true);
  assert.equal(exists('../app/api/reporting/gross-margin/route.ts'), true);
  const gateway = source('../lib/finance-reporting-gateway.ts');
  const aging = source('../app/components/aging-reporting-workspace.tsx');
  const margin = source('../app/components/gross-margin-reporting-workspace.tsx');
  assert.match(gateway, /import 'server-only'/);
  assert.match(gateway, /CORE_API_INTERNAL_URL/);
  assert.match(gateway, /CORE_API_SERVER_TOKEN/);
  assert.match(gateway, /cache: 'no-store'/);
  assert.match(gateway, /payload\.data === null/);
  assert.doesNotMatch(aging + margin, /CORE_API_SERVER_TOKEN|CORE_API_INTERNAL_URL|NEXT_PUBLIC_.*TOKEN/);
});

test('8.3 reporting screens and proxy APIs remain behind the existing Core Basic gate', () => {
  const middleware = source('../middleware.ts');
  assert.match(middleware, /'\/sales\/:path\*'/);
  assert.match(middleware, /'\/purchasing\/:path\*'/);
  assert.match(middleware, /'\/accounting\/:path\*'/);
  assert.match(middleware, /'\/api\/reporting\/:path\*'/);
});

test('8.3 aging warehouse filter uses full scope and money display rounds as strings', () => {
  const aging = source('../app/components/aging-reporting-workspace.tsx');
  assert.match(aging, /next\.scopeWarehouses\.map/);
  assert.doesNotMatch(aging, /deriveWarehouses/);
  assert.match(aging, /function incrementDigits/);
  assert.match(aging, /fraction\[precision\] >= '5'/);
  assert.match(aging, /currency === 'VND' \? 0 : 6/);
  assert.doesNotMatch(aging, /parseFloat\(|parseInt\(|Number\(value\)/);
});

test('8.3 only links existing owner screens and does not invent export or global reporting', () => {
  const aging = source('../app/components/aging-reporting-workspace.tsx');
  const margin = source('../app/components/gross-margin-reporting-workspace.tsx');
  for (const route of ['receivables', 'payables']) assert.equal(exists(`../app/accounting/${route}/page.tsx`), true);
  assert.equal(exists('../app/sales/sales-orders/page.tsx'), true);
  assert.equal(exists('../app/inventory/costing/page.tsx'), true);
  assert.match(aging, /href="\/accounting\/receivables"/);
  assert.match(aging, /href="\/accounting\/payables"/);
  assert.match(margin, /href="\/sales\/sales-orders"/);
  assert.match(margin, /href="\/inventory\/costing"/);
  assert.doesNotMatch(aging + margin, /Xuất CSV|exportCsv|Tải CSV|\/inventory\/movements/);
});

test('8.3 UI states AR/AP semantic boundary and excludes uncomparable margin lines', () => {
  const aging = source('../app/components/aging-reporting-workspace.tsx');
  const margin = source('../app/components/gross-margin-reporting-workspace.tsx');
  assert.match(aging, /AR chưa có due date canonical/);
  assert.match(aging, /AP dùng due date thật/);
  assert.match(margin, /không tự suy đoán giá vốn|Không tự suy đoán giá vốn/i);
  assert.match(margin, /NON_VND_REVENUE/);
  assert.doesNotMatch(aging + margin, /parseFloat\(|parseInt\(|Number\(value\)/);
});
