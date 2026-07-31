import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(new URL('../app/sales/sales-orders/page.tsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');
const formEntrySource = readFileSync(new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url), 'utf8');
const formSource = readFileSync(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url), 'utf8');
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
  assert.match(pageSource, /resolveSalesOrderRequestId/);
  assert.match(pageSource, /loadSalesOrderBootstrap/);
  assert.match(pageSource, /SalesOrderWorkspace/);
  assert.doesNotMatch(pageSource, /NEXT_PUBLIC_SUPABASE/);
  assert.doesNotMatch(pageSource, /DATABASE_URL/);
});

test('Sales Order workspace exposes lifecycle actions and commercial permissions', () => {
  assert.match(workspaceSource, /Tạo đơn bán hàng/);
  assert.match(workspaceSource, /canQuickCreateCustomer/);
  assert.match(workspaceSource, /canPriceOverride/);
  assert.match(workspaceSource, /canDiscountOverride/);
  assert.match(workspaceSource, /canConfirm=\{formMode === 'amendment' \? canAmend : canConfirm\}/);
  assert.match(workspaceSource, /\/confirm/);
  assert.match(workspaceSource, /\/amendments/);
  assert.match(workspaceSource, /\/cancel/);
  assert.match(workspaceSource, /Lưu, xác nhận và cấp số|Đã lưu, xác nhận và cấp số/);
});

test('canonical form activates product-first commercial entry with walk-in and quick customer creation', () => {
  assert.match(formEntrySource, /SalesOrderCommercialForm/);
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
  assert.match(formSource, /Kênh bán \*/);
  assert.match(formSource, /Giá nền/);
  assert.match(formSource, /Giá hệ thống/);
  assert.match(formSource, /Giá bán cuối/);
  assert.match(formSource, /Xem đầy đủ cách hình thành giá và thuế/);
  assert.match(formSource, /Dùng giá ngoại lệ/);
  assert.match(formSource, /Dùng lại giá hệ thống/);
  assert.match(formSource, /Chiết khấu bổ sung toàn đơn/);
  assert.match(formSource, /Lưu và xác nhận/);
  assert.match(formSource, /Đơn bán hàng có thay đổi chưa lưu/);
  assert.doesNotMatch(formSource, /Kiểu CK thêm/);
});

test('tax remains Core-owned and is summarized after document discount allocation', () => {
  assert.match(formSource, /\/api\/sales-orders\/entry-settings/);
  assert.match(formSource, /Thuế Core/);
  assert.match(formSource, /Thuế sau phân bổ/);
  assert.match(formSource, /Tổng thanh toán dự kiến/);
  assert.doesNotMatch(formSource, />Cách tính thuế</);
  assert.doesNotMatch(formSource, />Thuế %</);
  assert.doesNotMatch(formSource, /onChange=\{\(event\) => \{ setTaxMode/);
  assert.doesNotMatch(formSource, /onChange=\{\(event\) => \{ setTaxRate/);
});

test('Sales Order modal has one real vertical scroll owner and no desktop horizontal overflow', () => {
  assert.match(cssSource, /width:min\(1440px,calc\(100vw - 2rem\)\)/);
  assert.match(cssSource, /height:min\(94vh,980px\)/);
  assert.match(cssSource, /overflow-x:hidden/);
  assert.match(cssSource, /overflow-y:scroll/);
  assert.match(cssSource, /scrollbar-gutter:stable/);
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

test('Sales Order bootstrap reuses Core customer, organization, product and permission gateways', () => {
  assert.match(bootstrapSource, /listAllCustomers/);
  assert.match(bootstrapSource, /loadOrganizationSnapshot/);
  assert.match(bootstrapSource, /listProducts/);
  assert.match(contextSource, /SALES_ORDER_PERMISSION_KEYS/);
  assert.match(contextSource, /Object\.values\(SALES_ORDER_PERMISSION_KEYS\)/);
});

test('AppShell keeps the existing navigation contract while exposing Sales Order', () => {
  assert.match(appShellSource, /data-testid="sales-menu-toggle"/);
  assert.match(appShellSource, /testId: 'nav-sales-orders'/);
  assert.match(appShellSource, /href: '\/sales\/sales-orders'/);
});