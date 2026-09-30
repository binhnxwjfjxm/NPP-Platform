import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const readWorkspace = async () => (await Promise.all([read('app/page.tsx'), read('app/retail-workspace.tsx')])).join('\n');

test('sau Lô 7 giữ mã lỗi và dữ liệu conflict để đồng bộ revision đúng đơn', async () => {
  const page = await readWorkspace();
  assert.match(page, /class RetailApiError extends Error/);
  assert.match(page, /this\.code = error\?\.code/);
  assert.match(page, /this\.details = error\?\.details/);
  assert.match(page, /operationKeyFor\('issue-stock', 'current-order'\)/);
  assert.match(page, /api<Order>\(`\/api\/retail\/orders\/\$\{order\.id\}`\)/);
  assert.match(page, /Đã nạp dữ liệu mới nhất/);
});

test('retry Xuất kho giữ nguyên canonical Idempotency-Key khi chỉ đổi revision', async () => {
  const page = await readWorkspace();
  const conflict = page.slice(page.indexOf("if (kind === 'issue-stock' && isRevisionConflict"));
  assert.doesNotMatch(conflict.slice(0, conflict.indexOf('setError')), /forgetOperationKey/);
  assert.match(page, /if \(kind === 'issue-stock'\)\s*forgetOperationKey\('issue-stock', 'current-order'\)/);
  assert.match(page, /createIdempotencyKey\(`retail-\$\{action\}`\)/);
});

test('Khả dụng khi sửa đơn dùng preview theo kho và loại chính đơn hiện tại', async () => {
  const [page, gateway, route, service] = await Promise.all([
    readWorkspace(), read('app/api/retail/[...segments]/route.ts'), readRepo('npp-core/api/src/routes/retail-catalog.js'), readRepo('npp-core/api/src/services/retail-catalog.js'),
  ]);
  assert.match(page, /\/api\/retail\/availability/);
  assert.match(page, /const salesOrderId = order\?\.id && order\.warehouseId === warehouseId \? order\.id : null/);
  assert.match(page, /\.\.\.\(salesOrderId \? \{ salesOrderId \} : \{\}\), warehouseId, variantIds/);
  assert.match(page, /availabilityLoading/);
  assert.match(gateway, /path: '\/api\/retail\/availability'/);
  assert.match(route, /previewRetailAvailability/);
  assert.match(service, /excludingSalesOrderId = salesOrderId/);
  assert.match(service, /getWarehouseAvailableQuantities/);
});

test('thiếu Khả dụng được cảnh báo và chặn Chốt hoặc Xuất kho trước request chắc chắn thất bại', async () => {
  const page = await readWorkspace();
  assert.match(page, /function isShortage/);
  assert.match(page, /const shortageRows = stockRows\.filter/);
  assert.match(page, /Chưa đủ Khả dụng/);
  assert.match(page, /stockBlocked \|\| stockGatePending/);
  assert.match(page, /assertStockGate\(kind === 'confirm' \? 'Chốt đơn' : 'Xuất kho'\)/);
  assert.match(page, /quantityNumber\.format/);
  assert.doesNotMatch(page, /return row\?\.availableQuantity \?\?/);
});

test('chỉnh số lượng trên mobile không được tự xóa sản phẩm khi ô nhập rỗng tạm thời', async () => {
  const page = await readWorkspace();
  assert.match(page, /const \[quantityInputs, setQuantityInputs\] = useState<Record<string, string>>\(\{\}\)/);
  const edit = page.slice(page.indexOf('function updateCartQuantity'), page.indexOf('function setMultiSelectMode'));
  assert.match(edit, /if \(!raw\)\s*return;/);
  assert.match(edit, /if \(normalized === '0'\)\s*return;/);
  assert.doesNotMatch(edit, /removeCartLine\(id\)/);
  assert.match(page, /value=\{quantityInputs\[line\.id\] \?\? line\.quantity\}/);
  assert.match(page, /onBlur=\{\(\) => clearQuantityInput\(line\.id\)\}/);
  assert.match(page, /function stepCartQuantity/);
  assert.match(page, /aria-label={`Xóa \$\{line\.productName\} khỏi đơn`}/);
  assert.match(page, />Xóa<\/button>/);
  const addSelected = page.slice(page.indexOf('function addSelected()'), page.indexOf('function assertStockGate'));
  assert.doesNotMatch(addSelected, /cartFromOrder\(order\)/);
});

test('đơn mở lại giữ đúng quy tắc số lẻ của đơn vị tính', async () => {
  const [page, repository, salesOrderService] = await Promise.all([
    readWorkspace(),
    readRepo('npp-core/api/src/db/repositories/sales-order.js'),
    readRepo('npp-core/api/src/services/sales-order-legacy.js'),
  ]);
  assert.match(repository, /u\.allows_fractional/);
  assert.match(salesOrderService, /allowsFractional: line\.allows_fractional === null \|\| line\.allows_fractional === undefined[\s\S]*?Boolean\(line\.allows_fractional\)/);
  assert.match(page, /allowsFractional\?: boolean \| null/);
  assert.match(page, /allowsFractional: line\.allowsFractional \?\? null/);
  assert.match(page, /return fractional \? String\(Math\.min\(n, 999999\)\) : String\(Math\.max\(1, Math\.trunc\(n\)\)\)/);
});

test('giỏ đang sửa rỗng không giữ tiền cũ và không cho Thanh toán', async () => {
  const page = await readWorkspace();
  assert.match(page, /const totalLabel = editingDraft[\s\S]*?money\.format\(cart\.length \? \(syncedDraft \? total : cartTotal\) : 0\)/);
  assert.match(page, /const subtotalLabel = editingDraft[\s\S]*?money\.format\(cart\.length \? \(syncedDraft \? Number\(order\?\.subtotal \?\? total\) : cartTotal\) : 0\)/);
  assert.match(page, /const discountDisplayLabel = editingDraft && !cart\.length[\s\S]*?money\.format\(0\)/);
  assert.match(page, /\(editingDraft && !cart\.length\) \|\| stockBlocked \|\| stockGatePending/);
});

test('card sản phẩm mobile giữ kích thước gọn và ô số lượng không kích hoạt zoom iPhone', async () => {
  const css = await read('app/retail-issue675.css');
  assert.match(css, /\.retail-issue675 \.compact-product-card \{[\s\S]*?min-height: 0;[\s\S]*?align-items: start;/);
  assert.match(css, /\.compact-product-card \.quantity-stepper input \{ width: 42px; font-size: 16px; \}/);
  assert.match(css, /\.compact-product-card\.editable dl \{[\s\S]*?grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
});

test('điều hướng Retail đưa Tồn kho xuống bottom nav và bỏ thanh chuyển chế độ phía trên', async () => {
  const [page, root, inventoryStyles] = await Promise.all([
    readWorkspace(),
    read('app/retail-root.tsx'),
    read('app/retail-inventory.module.css'),
  ]);
  assert.match(page, /type RetailTab = 'home' \| 'entry' \| 'orders' \| 'settings'/);
  assert.match(root, />Trang chủ<\/button>/);
  assert.match(root, />Lên đơn<\/button>/);
  assert.match(root, />Đơn hàng<\/button>/);
  assert.match(root, />Tồn kho<\/button>/);
  assert.match(root, />Cài đặt<\/button>/);
  assert.match(root, /<RetailInventoryPanel warehouses=\{inventoryAccess\.warehouses\} \/>/);
  assert.match(root, /className="retail-bottom-nav" aria-label="Điều hướng Retail"/);
  assert.doesNotMatch(root, /modeTabs|Chức năng Retail/);
  assert.doesNotMatch(inventoryStyles, /\.modeTabs/);
  assert.match(page, /activeTab === 'home' \? <span className="topbar-spacer"/);
  assert.doesNotMatch(page, /activeTab === 'account'/);
  assert.match(page, /action="\/api\/auth\/logout"/);
  assert.doesNotMatch(page, /window\.history\.back/);
});
test('Cài đặt dùng hàng có chevron và bottom sheet cho Tài khoản Thiết lập in Mẫu phiếu Đăng xuất', async () => {
  const [page, panel, bridge] = await Promise.all([
    readWorkspace(), read('app/printer-settings-panel.tsx'), read('lib/printer-bridge.ts'),
  ]);
  assert.match(page, /className="settings-row"[^>]*>[\s\S]*?<strong>Tài khoản<\/strong>/);
  assert.match(page, /<strong>Thiết lập in<\/strong>/);
  assert.match(page, /<strong>Mẫu phiếu<\/strong>/);
  assert.match(page, /<strong>Đăng xuất<\/strong>/);
  assert.match(page, /className="settings-sheet sheet-enter"/);
  assert.match(page, /PrinterSettingsPanel/);
  assert.match(page, /printerSettingsSummary\(printerSettings\)/);
  assert.match(panel, /In thử/);
  assert.match(panel, />Lưu thiết lập<\/button>/);
  assert.match(panel, /In Wi‑Fi trực tiếp/);
  assert.match(panel, /Tìm máy in/);
  assert.match(panel, /Cài đặt nâng cao/);
  assert.match(bridge, /PRINTER_SETTINGS_STORAGE_KEY/);
  assert.match(bridge, /window\.localStorage\.setItem/);
  assert.doesNotMatch(bridge, /fetch\(/);
});

test('Mẫu phiếu PATCH xong GET lại cấu hình Công Ty rồi mới áp dụng', async () => {
  const [page, gateway, service] = await Promise.all([
    readWorkspace(), read('app/api/retail/[...segments]/route.ts'), readRepo('npp-core/api/src/services/document-print-templates.js'),
  ]);
  assert.match(page, /method: 'PATCH'/);
  const save = page.slice(page.indexOf('async function savePrintTemplate'), page.indexOf('function togglePrintField'));
  assert.match(save, /const refreshedTemplates = await loadPrintTemplates\(\)/);
  assert.match(save, /applyTemplate\(persisted\)/);
  assert.match(page, /heading: templateHeading\.trim\(\) \|\| null/);
  assert.match(page, /visibleFieldKeys: printTemplate\.visibleFieldKeys/);
  assert.match(gateway, /\/api\/document-print-templates\/\$\{documentType\}\/\$\{templateCode\}/);
  assert.match(service, /heading: setting\?\.heading \?\? null/);
  assert.match(service, /title: setting\?\.title \?\? catalog\.name/);
  assert.doesNotMatch(page, /HƯNG PHÁT/);
});

test('Trang chủ hardening có hero chuẩn, tổng quan và đơn gần đây', async () => {
  const [page, css] = await Promise.all([readWorkspace(), read('app/retail-issue675.css')]);
  assert.match(page, /01-hero-nganh-hang\.webp/);
  assert.match(page, /Tổng quan quầy bán/);
  assert.match(page, /Doanh số hoàn thành/);
  assert.match(page, /Đơn cần theo dõi/);
  assert.match(css, /\.home-feature/);
  assert.match(css, /\.home-metrics/);
  assert.match(css, /retail-page-in/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('topbar bỏ nút quét thô, quét mã nằm trong Chọn sản phẩm', async () => {
  const page = await readWorkspace();
  const topbar = page.slice(page.indexOf('className="retail-header retail-topbar"'), page.indexOf('{error ?'));
  assert.doesNotMatch(topbar, /scanner-button|Quét mã|⌗/);
  const sheet = page.slice(page.indexOf('className="product-sheet'));
  assert.match(sheet, /aria-label="Quét mã"[\s\S]*?setScannerOpen\(true\)/);
});

test('tiền VND không để phần thập phân rác ở ô thu tiền', async () => {
  const page = await readWorkspace();
  assert.match(page, /function normalizeVndInput/);
  assert.match(page, /setPaid\(normalizeVndInput\(order\.receivableRemainingAmount \?\? order\.total\)\)/);
  assert.match(page, /setPaid\(normalizeVndInput\(event\.target\.value\)\)/);
  assert.match(page, /currency: 'VND', maximumFractionDigits: 0/);
});

test('in phiếu hỗ trợ A4 A5 80mm 58mm và không đưa ảnh vào chứng từ', async () => {
  const page = await readWorkspace();
  assert.match(page, /type PrintPaper = PrinterPaper/);
  assert.match(page, /visiblePrintFields\.has\('line_item'\)/);
  const printSlice = page.slice(page.indexOf('className="print-document"'));
  assert.doesNotMatch(printSlice, /productPicture|product-photo/);
});

test('ảnh sản phẩm khóa vùng ảnh, fallback nằm dưới ảnh thật và không chồng chữ', async () => {
  const [page, css] = await Promise.all([readWorkspace(), read('app/retail-issue675.css')]);
  assert.match(page, /className="product-visual"/);
  assert.match(page, /event\.currentTarget\.hidden = true/);
  assert.match(page, /product-fallback/);
  assert.match(css, /\.product-photo,\n\.retail-issue675 \.product-fallback \{[\s\S]*position: absolute/);
  assert.match(css, /\.product-photo \{ z-index: 2; object-fit: contain/);
  assert.match(css, /\.product-fallback \{ z-index: 1/);
});

test('viewport Retail khóa zoom và giữ safe-area cho PWA', async () => {
  const [layout, css] = await Promise.all([read('app/layout.tsx'), read('app/retail-issue675.css')]);
  assert.match(layout, /export const viewport: Viewport/);
  assert.match(layout, /maximumScale: 1/);
  assert.match(layout, /userScalable: false/);
  assert.match(layout, /viewportFit: 'cover'/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('bottom nav có một owner duy nhất, fixed trực tiếp và không còn wrapper 100dvh', async () => {
  const [page, root, css, lot7] = await Promise.all([
    readWorkspace(),
    read('app/retail-root.tsx'),
    read('app/retail-issue675.css'),
    read('app/retail-lot7.css'),
  ]);
  const start = css.indexOf('/* Bottom navigation');
  const end = css.indexOf('/* Interaction */', start);
  const nav = css.slice(start, end);

  assert.match(nav, /\.retail-bottom-nav \{[\s\S]*?position: fixed;/);
  assert.match(css, /--retail-dock-bottom: max\(8px, env\(safe-area-inset-bottom\)\);/);
  assert.match(nav, /bottom: var\(--retail-dock-bottom\);/);
  assert.match(nav, /max-width: min\(620px, calc\(100% - 16px\)\);/);
  assert.match(css, /--retail-bottom-nav-height: 56px;/);
  assert.match(nav, /height: var\(--retail-bottom-nav-height\);/);
  assert.match(nav, /\.retail-bottom-nav button \{[\s\S]*?flex: 1 1 0;/);

  assert.doesNotMatch(page, /RETAIL_BOTTOM_NAV_SCOPE_STYLE|RETAIL_BOTTOM_NAV_STYLE|retail-bottom-nav-scope|className="bottom-nav"/);
  assert.match(page, /activeTab === 'entry' \? ' retail-entry-active' : ''/);
  assert.match(root, /function RetailBottomNav/);
  assert.match(root, /<nav className="retail-bottom-nav" aria-label="Điều hướng Retail">/);
  assert.equal((root.match(/<nav className="retail-bottom-nav"/g) ?? []).length, 1);
  assert.match(lot7, /\.retail-lot7 \.retail-topbar \{ position: sticky; z-index: 4; top: 0;/);
});

test('dock cố định có một owner và Lên đơn chừa đủ chỗ cho cả thao tác lẫn điều hướng', async () => {
  const [page, canonicalCss, globalsCss, lot7Css, mobileCss] = await Promise.all([
    readWorkspace(),
    read('app/retail-issue675.css'),
    read('app/globals.css'),
    read('app/retail-lot7.css'),
    read('app/retail-mobile-polish.css'),
  ]);
  assert.match(page, /activeTab === 'entry' \? ' retail-entry-active' : ''/);
  assert.match(canonicalCss, /--retail-bottom-nav-height: 56px;/);
  assert.match(canonicalCss, /--retail-order-action-height: 52px;/);
  assert.match(canonicalCss, /\.retail-issue675\.retail-entry-active \{[\s\S]*?padding-bottom: calc\(var\(--retail-dock-bottom\) \+ var\(--retail-bottom-nav-height\) \+ var\(--retail-dock-gap\) \+ var\(--retail-order-action-height\) \+ 18px\);/);
  assert.match(canonicalCss, /\.retail-issue675 \.order-action-bar \{[\s\S]*?bottom: calc\(var\(--retail-dock-bottom\) \+ var\(--retail-bottom-nav-height\) \+ var\(--retail-dock-gap\)\);/);
  assert.match(canonicalCss, /\.retail-bottom-nav \{[\s\S]*?bottom: var\(--retail-dock-bottom\);[\s\S]*?height: var\(--retail-bottom-nav-height\);/);
  assert.doesNotMatch(globalsCss, /\.order-action-bar \{|\.bottom-nav \{/);
  assert.doesNotMatch(lot7Css, /\.retail-lot7 \.order-action-bar|\.retail-lot7 \.bottom-nav|padding-bottom: calc\(190px/);
  assert.doesNotMatch(mobileCss, /\.retail-issue675 \.order-action-bar/);
});

test('trạng thái đơn có tone riêng và interaction có focus pressed disabled', async () => {
  const [page, css] = await Promise.all([readWorkspace(), read('app/retail-issue675.css')]);
  assert.match(page, /statusTone\(item\)/);
  for (const tone of ['draft', 'confirmed', 'issued', 'paid', 'debt', 'cancelled']) assert.match(css, new RegExp(`\\.status-${tone}`));
  assert.match(css, /button:not\(:disabled\):active/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /button:disabled/);
});

test('lưu sửa thành công không bị báo thất bại chỉ vì bước GET đồng bộ sau đó lỗi', async () => {
  const page = await readWorkspace();
  assert.match(page, /setNotice\('Đã lưu thay đổi đơn và giữ nguyên trạng thái Đã chốt\.'\)/);
  assert.match(page, /api<Order>\(`\/api\/retail\/orders\/\$\{next\.id\}`\)\.then\(setOrder\)\.catch\(\(\) => undefined\)/);
});


test('Retail có nút Hủy đơn nhỏ, popup lý do và gọi đúng contract Công Ty', async () => {
  const [page, css, gateway, entryService] = await Promise.all([
    readWorkspace(),
    read('app/retail-issue675.css'),
    read('app/api/retail/[...segments]/route.ts'),
    readRepo('npp-core/api/src/services/sales-order-entry.js'),
  ]);
  assert.match(entryService, /canCancel: hasPermission\(requestContext, 'core\.sales-order\.cancel'\)/);
  assert.match(page, /canCancel\?: boolean/);
  assert.match(page, /const canCancel = Boolean\(boot\?\.settings\.permissions\?\.canCancel\)/);
  assert.match(page, /const canCancelCurrentOrder = Boolean\([\s\S]*?\['draft', 'confirmed'\]\.includes\(order\.status\)[\s\S]*?!STOCK_ISSUED_FULFILLMENT_STATUSES\.has\(order\.fulfillmentStatus\)/);
  assert.match(page, /className="retail-cancel-action"[\s\S]*?>Hủy đơn<\/button>/);
  assert.match(page, /className="cancel-dialog sheet-enter"/);
  assert.match(page, /placeholder="Nhập lý do hủy đơn"/);
  assert.match(page, /operationKeyFor\('cancel', intent\)/);
  assert.match(page, /\/api\/retail\/orders\/\$\{order\.id\}\/cancel/);
  assert.match(page, /JSON\.stringify\(\{ reason \}\)/);
  assert.match(gateway, /cancel: \{ path: `\/api\/sales-orders\/\$\{orderId\}\/cancel`, body: payload \}/);
  assert.match(css, /\.retail-issue675 \.retail-cancel-action \{[\s\S]*?color: #b42318/);
  assert.match(css, /\.cancel-dialog \{[\s\S]*?width: min\(360px, 100%\)/);
  assert.match(css, /\.cancel-confirm-action \{[\s\S]*?background: #b42318/);
});
