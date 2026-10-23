import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Báo cáo bán hàng có nguồn danh sách kho độc lập và hiện lỗi khi kho không tải', () => {
  const ui = source('app/components/sales-reporting-workspace.tsx');
  const route = source('app/api/reporting/sales/warehouses/route.ts');
  assert.match(ui, /requestScopeWarehouses\(\)/);
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

test('Báo cáo bán hàng ưu tiên tải kho và giới hạn thời gian chờ chỉ cho báo cáo nặng', () => {
  const ui = source('app/components/sales-reporting-workspace.tsx');
  const gateway = source('lib/reporting-dashboard-gateway.ts');
  assert.ok(ui.indexOf('void requestScopeWarehouses()') < ui.indexOf('void load(EMPTY_FILTERS, true)'));
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
