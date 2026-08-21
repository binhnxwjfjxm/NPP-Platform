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
  assert.match(page, /if \(kind === 'issue-stock'\) forgetOperationKey\('issue-stock', 'current-order'\)/);
  assert.match(page, /createIdempotencyKey\(`retail-\$\{action\}`\)/);
});

test('Khả dụng khi sửa đơn dùng preview theo kho và loại chính đơn hiện tại', async () => {
  const [page, gateway, route, service] = await Promise.all([
    readWorkspace(), read('app/api/retail/[...segments]/route.ts'), readRepo('npp-core/api/src/routes/retail-catalog.js'), readRepo('npp-core/api/src/services/retail-catalog.js'),
  ]);
  assert.match(page, /\/api\/retail\/availability/);
  assert.match(page, /salesOrderId: order\.id, warehouseId, variantIds/);
  assert.match(page, /availabilityLoading/);
  assert.match(gateway, /path: '\/api\/retail\/availability'/);
  assert.match(route, /previewRetailAvailability/);
  assert.match(service, /excludingSalesOrderId = salesOrderId/);
  assert.match(service, /getWarehouseAvailableQuantity/);
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

test('xóa dòng giỏ rõ ràng, số lượng về 0 xóa dòng và không seed lại từ bản nháp cũ', async () => {
  const page = await readWorkspace();
  assert.match(page, /function removeCartLine/);
  assert.match(page, /if \(normalized === '0'\) \{ removeCartLine\(id\); return; \}/);
  assert.match(page, /aria-label={`Xóa \$\{line\.productName\} khỏi đơn`}/);
  assert.match(page, />Xóa<\/button>/);
  const addSelected = page.slice(page.indexOf('function addSelected()'), page.indexOf('function assertStockGate'));
  assert.doesNotMatch(addSelected, /cartFromOrder\(order\)/);
});

test('điều hướng Retail đúng bốn mục và Trang chủ không có nút quay lại', async () => {
  const page = await readWorkspace();
  assert.match(page, /type RetailTab = 'home' \| 'entry' \| 'orders' \| 'settings'/);
  assert.match(page, />Trang chủ<\/button>/);
  assert.match(page, />Lên đơn<\/button>/);
  assert.match(page, />Đơn hàng<\/button>/);
  assert.match(page, />Cài đặt<\/button>/);
  assert.match(page, /activeTab === 'home' \? <span className="topbar-spacer"/);
  assert.doesNotMatch(page, /activeTab === 'account'/);
  assert.match(page, /action="\/api\/auth\/logout"/);
  assert.doesNotMatch(page, /window\.history\.back/);
});

test('Cài đặt dùng hàng có chevron và bottom sheet cho Tài khoản Máy in Mẫu phiếu Đăng xuất', async () => {
  const page = await readWorkspace();
  assert.match(page, /className="settings-row"[^>]*>[\s\S]*?<strong>Tài khoản<\/strong>/);
  assert.match(page, /<strong>Máy in<\/strong>/);
  assert.match(page, /<strong>Mẫu phiếu<\/strong>/);
  assert.match(page, /<strong>Đăng xuất<\/strong>/);
  assert.match(page, /className="settings-sheet sheet-enter"/);
  assert.match(page, />Hủy<\/button>/);
  assert.match(page, />Thiết lập<\/button>/);
  assert.match(page, /PRINT_PAPER_STORAGE_KEY/);
  assert.match(page, /window\.localStorage\.setItem\(PRINT_PAPER_STORAGE_KEY/);
  assert.match(page, /Máy in Wi-Fi được chọn trong hộp thoại in của thiết bị/);
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
  assert.match(sheet, />Quét mã<\/button>/);
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
  assert.match(page, /type PrintPaper = 'A4' \| 'A5' \| '80mm' \| '58mm'/);
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
