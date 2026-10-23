import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Báo cáo dùng chính danh sách kho đã trả về, API kho riêng chỉ chạy dự phòng khi báo cáo lỗi', () => {
  const ui = source('app/components/sales-reporting-workspace.tsx');
  const route = source('app/api/reporting/sales/warehouses/route.ts');
  assert.match(ui, /setScopeWarehouses\(next\.scopeWarehouses\)/);
  assert.match(ui, /setReport\(next\)/);
  assert.match(ui, /if \(initialize\) \{\s*void requestScopeWarehouses\(\)/);
  assert.equal((ui.match(/requestScopeWarehouses\(\)/g) ?? []).length, 2, 'Chỉ khai báo và gọi fallback, không tải kho độc lập đồng thời');
  assert.match(ui, /scopeWarehouses \?\? report\?\.scopeWarehouses/);
  assert.match(ui, /Chưa tải được danh sách kho/);
  assert.match(route, /getSalesScopeWarehouses/);
});

test('Báo cáo phân biệt quá thời hạn chờ với lỗi đối soát nghiệp vụ', () => {
  const gateway = source('lib/reporting-dashboard-gateway.ts');
  const ui = source('app/components/sales-reporting-workspace.tsx');
  assert.match(gateway, /REPORTING_GATEWAY_TIMEOUT/);
  assert.match(ui, /SALES_REPORT_RECONCILIATION_FAILED/);
  assert.match(ui, /tổng đơn/);
  assert.match(ui, /cộng dòng/);
});

test('Báo cáo không gọi kho song song với báo cáo nặng, giữ nguyên thời gian chờ đang áp dụng', () => {
  const ui = source('app/components/sales-reporting-workspace.tsx');
  const gateway = source('lib/reporting-dashboard-gateway.ts');
  assert.match(ui, /useEffect\(\(\) => \{\s*void load\(EMPTY_FILTERS, true\)/);
  assert.doesNotMatch(ui, /useEffect\(\(\) => \{\s*let active = true;\s*void requestScopeWarehouses\(\)/);
  assert.match(gateway, /SALES_REQUEST_TIMEOUT_MS=25_000/);
  assert.match(gateway, /family==='sales'\?SALES_REQUEST_TIMEOUT_MS:REQUEST_TIMEOUT_MS/);
});

// Lock the exact backend route; a synthetic family identifier is not a URL path.
test('Danh sách kho gọi đúng API Công Ty, không dùng đường dẫn sales-warehouses không tồn tại', () => {
  const gateway = source('lib/reporting-dashboard-gateway.ts');
  const backend = source('../api/src/routes/reporting-sales-purchasing.js');
  assert.match(gateway, /family==='sales-warehouses'\?'\/api\/reporting\/sales\/warehouses'/);
  assert.match(backend, /pathname === '\/api\/reporting\/sales\/warehouses'/);
  assert.doesNotMatch(gateway, /fetch\(\x60\$\{baseUrl\(\)\}\/api\/reporting\/\$\{family\}/);
});

test('Liên kết báo cáo không tự tải các trang nặng khi chưa được mở', () => {
  for (const path of [
    'app/components/sales-reporting-workspace.tsx',
    'app/components/gross-margin-reporting-workspace.tsx',
  ]) {
    const ui = source(path);
    const links = [...ui.matchAll(/<Link\b[^>]*>/g)].map((match) => match[0]);
    assert.ok(links.length >= 2);
    for (const link of links) {
      assert.match(link, /\bprefetch=\{false\}/, 'Không tải trước trang chưa chọn: ' + link);
    }
  }
});
