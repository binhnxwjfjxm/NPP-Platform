import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(new URL('../app/sales/sales-orders/page.tsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');
const formSource = readFileSync(new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../app/sales/sales-orders/SalesOrderDetail.tsx', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../app/sales/sales-orders/sales-order-ui.ts', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../app/sales/sales-orders/sales-orders.module.css', import.meta.url), 'utf8');
const gatewaySource = readFileSync(new URL('../lib/sales-order-gateway.ts', import.meta.url), 'utf8');
const bootstrapSource = readFileSync(new URL('../lib/sales-order-bootstrap.ts', import.meta.url), 'utf8');
const contextSource = readFileSync(new URL('../lib/sales-order-context.ts', import.meta.url), 'utf8');
const appShellSource = readFileSync(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');
const skuRouteSource = readFileSync(new URL('../app/api/sales-orders/sku-search/route.ts', import.meta.url), 'utf8');
const settingsRouteSource = readFileSync(new URL('../app/api/sales-orders/entry-settings/route.ts', import.meta.url), 'utf8');

test('Sales Order page stays on the authenticated NPP server boundary', () => {
  assert.match(pageSource, /resolveSalesOrderAccess/);
  assert.match(pageSource, /buildSalesOrderBootstrap/);
  assert.match(pageSource, /SalesOrderWorkspace/);
  assert.doesNotMatch(pageSource, /NEXT_PUBLIC_SUPABASE/);
  assert.doesNotMatch(pageSource, /DATABASE_URL/);
});

test('Sales Order workspace exposes lifecycle actions and operational editor permissions', () => {
  assert.match(workspaceSource, /Tạo đơn bán hàng/);
  assert.match(workspaceSource, /canQuickCreateCustomer/);
  assert.match(workspaceSource, /canConfirm=\{formMode === 'amendment' \? canAmend : canConfirm\}/);
  assert.match(workspaceSource, /\/confirm/);
  assert.match(workspaceSource, /\/amendments/);
  assert.match(workspaceSource, /\/cancel/);
  assert.match(workspaceSource, /Lưu, xác nhận và cấp số|Đã lưu, xác nhận và cấp số/);
});

test('Sales Order editor is product-first and supports walk-in plus quick customer creation', () => {
  assert.match(formSource, /Khách vãng lai/);
  assert.match(formSource, /walkInDisplayName/);
  assert.match(formSource, /walkInPhone/);
  assert.match(formSource, /Cần giao hàng\? Tạo khách chính thức/);
  assert.match(formSource, /\/api\/customers\?\$\{query\}/);
  assert.match(formSource, /Số điện thoại đã thuộc khách/);
  assert.match(formSource, /\/api\/customers\/\$\{created\.id\}\/addresses/);
  assert.match(formSource, /Tìm hàng nhanh/);
  assert.match(formSource, /Tên sản phẩm, mã hàng, SKU hoặc barcode/);
  assert.match(formSource, /ArrowDown/);
  assert.match(formSource, /ArrowUp/);
  assert.match(formSource, /event\.key === 'Enter'/);
  assert.match(formSource, /\/api\/sales-orders\/sku-search/);
  assert.match(formSource, /\/api\/pricing\/resolve/);
  assert.match(formSource, /Giá nền/);
  assert.match(formSource, /Giá bán cuối/);
  assert.match(formSource, /Xem cách tính giá, chiết khấu và thuế dòng/);
  assert.match(formSource, /Lưu và xác nhận/);
  assert.match(formSource, /Đơn bán hàng có thay đổi chưa lưu/);
});

test('tax is resolved by Core and summarized at document footer instead of entered per line', () => {
  assert.match(formSource, /\/api\/sales-orders\/entry-settings/);
  assert.match(formSource, /Chính sách thuế Core/);
  assert.match(formSource, /Tiền thuế dự kiến/);
  assert.match(formSource, /Tổng thanh toán dự kiến/);
  assert.doesNotMatch(formSource, />Cách tính thuế</);
  assert.doesNotMatch(formSource, />Thuế %</);
  assert.doesNotMatch(formSource, /onChange=\{\(event\) => \{ setTaxMode/);
  assert.doesNotMatch(formSource, /onChange=\{\(event\) => \{ setTaxRate/);
});

test('Sales Order modal has a no-horizontal-overflow desktop and responsive card contract', () => {
  assert.match(cssSource, /width:min\(1440px,calc\(100vw - 2rem\)\)/);
  assert.match(cssSource, /height:min\(94vh,980px\)/);
  assert.match(cssSource, /overflow-x:hidden/);
  assert.match(cssSource, /grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(cssSource, /@media\(max-width:780px\)/);
  assert.match(cssSource, /orderLineCard\{grid-template-columns:1fr 1fr/);
  assert.doesNotMatch(cssSource, /lineEntryGrid\{display:grid;grid-template-columns:1\.2fr 1\.2fr/);
});

test('Sales Order detail preserves independent business projections and immutable versions', () => {
  assert.match(detailSource, /Trạng thái đơn/);
  assert.match(detailSource, /Chuẩn bị hàng/);
  assert.match(detailSource, /Giao hàng/);
  assert.match(detailSource, /Thanh toán/);
  assert.match(detailSource, /Lịch sử phiên bản/);
  assert.match(uiSource, /currentVersionNumber/);
});

test('same-origin Sales gateways proxy entry settings, SKU search and lifecycle mutations', () => {
  assert.match(gatewaySource, /CORE_API_INTERNAL_URL/);
  assert.match(gatewaySource, /CORE_API_SERVER_TOKEN/);
  assert.match(gatewaySource, /getSalesOrderEntrySettings/);
  assert.match(gatewaySource, /searchSalesOrderSkus/);
  assert.match(skuRouteSource, /searchSalesOrderSkus/);
  assert.match(settingsRouteSource, /getSalesOrderEntrySettings/);
  assert.match(gatewaySource, /Idempotency-Key/);
  assert.match(gatewaySource, /cache: 'no-store'/);
  assert.doesNotMatch(gatewaySource, /NEXT_PUBLIC_/);
});

test('Sales Order bootstrap reuses Core customers, warehouses and permission filtering', () => {
  assert.match(bootstrapSource, /listCustomers/);
  assert.match(bootstrapSource, /listWarehouses/);
  assert.match(contextSource, /SALES_ORDER_PERMISSION_KEYS/);
  assert.match(contextSource, /Object\.values\(SALES_ORDER_PERMISSION_KEYS\)/);
});

test('AppShell keeps the existing navigation contract while exposing Sales Order', () => {
  assert.match(appShellSource, /data-testid="sales-menu-toggle"/);
  assert.match(appShellSource, /testId: 'nav-sales-orders'/);
  assert.match(appShellSource, /href: '\/sales\/sales-orders'/);
});
