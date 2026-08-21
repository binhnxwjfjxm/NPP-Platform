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

test('điều hướng Retail đúng bốn mục Trang chủ Lên đơn Đơn hàng Cài đặt', async () => {
  const page = await readWorkspace();
  assert.match(page, /type RetailTab = 'home' \| 'entry' \| 'orders' \| 'settings'/);
  assert.match(page, />Trang chủ<\/button>/);
  assert.match(page, />Lên đơn<\/button>/);
  assert.match(page, />Đơn hàng<\/button>/);
  assert.match(page, />Cài đặt<\/button>/);
  assert.doesNotMatch(page, /activeTab === 'account'/);
  assert.match(page, /action="\/api\/auth\/logout"/);
  assert.doesNotMatch(page, /window\.history\.back/);
});

test('Cài đặt tách Tài khoản Máy in Mẫu phiếu Đăng xuất và lưu khổ in theo thiết bị', async () => {
  const page = await readWorkspace();
  assert.match(page, /<h3>Tài khoản<\/h3>/);
  assert.match(page, /<h3>Máy in<\/h3>/);
  assert.match(page, /<h3>Mẫu phiếu<\/h3>/);
  assert.match(page, /<h3>Đăng xuất<\/h3>/);
  assert.match(page, /PRINT_PAPER_STORAGE_KEY/);
  assert.match(page, /window\.localStorage\.setItem\(PRINT_PAPER_STORAGE_KEY/);
  assert.match(page, /Máy in Wi-Fi được chọn trong hộp thoại in của thiết bị/);
});

test('Mẫu phiếu dùng cấu hình Công Ty, hỗ trợ tiêu đề và field, không hard-code HƯNG PHÁT', async () => {
  const [page, gateway, service] = await Promise.all([
    readWorkspace(), read('app/api/retail/[...segments]/route.ts'), readRepo('npp-core/api/src/services/document-print-templates.js'),
  ]);
  assert.match(page, /\/api\/retail\/print-templates/);
  assert.match(page, /heading: templateHeading\.trim\(\) \|\| null/);
  assert.match(page, /visibleFieldKeys: printTemplate\.visibleFieldKeys/);
  assert.match(gateway, /\/api\/document-print-templates\/\$\{documentType\}\/\$\{templateCode\}/);
  assert.match(service, /heading: setting\?\.heading \?\? null/);
  assert.match(service, /title: setting\?\.title \?\? catalog\.name/);
  assert.doesNotMatch(page, /HƯNG PHÁT/);
  const printSlice = page.slice(page.indexOf('className="print-document"'));
  assert.doesNotMatch(printSlice, /productPicture|product-photo/);
});

test('Trang chủ và thẻ Retail có lớp compact riêng sau Issue 675', async () => {
  const [page, css, layout] = await Promise.all([readWorkspace(), read('app/retail-issue675.css'), read('app/layout.tsx')]);
  assert.match(page, /compact-home-actions/);
  assert.doesNotMatch(page, /className="home-hero"/);
  assert.match(css, /\.compact-home-actions button \{ min-height: 104px/);
  assert.match(css, /\.compact-product-card \{ grid-template-columns: 78px/);
  assert.match(layout, /import '\.\/retail-issue675\.css'/);
});

test('topbar bỏ nút quét thô, quét mã nằm trong Chọn sản phẩm', async () => {
  const page = await readWorkspace();
  const topbar = page.slice(page.indexOf('className="retail-header retail-topbar"'), page.indexOf('{error ?'));
  assert.doesNotMatch(topbar, /scanner-button|Quét mã|⌗/);
  const sheet = page.slice(page.indexOf('className="product-sheet'));
  assert.match(sheet, />Quét mã<\/button>/);
});

test('in phiếu hỗ trợ A4 A5 80mm 58mm và không đưa ảnh vào chứng từ', async () => {
  const page = await readWorkspace();
  assert.match(page, /type PrintPaper = 'A4' \| 'A5' \| '80mm' \| '58mm'/);
  assert.match(page, /visiblePrintFields\.has\('line_item'\)/);
  const printSlice = page.slice(page.indexOf('className="print-document"'));
  assert.doesNotMatch(printSlice, /productPicture|product-photo/);
});

test('ảnh sản phẩm có fallback thật khi R2 lỗi', async () => {
  const page = await readWorkspace();
  assert.match(page, /className="product-visual"/);
  assert.match(page, /event\.currentTarget\.hidden = true/);
  assert.match(page, /product-fallback/);
});

test('lưu sửa thành công không bị báo thất bại chỉ vì bước GET đồng bộ sau đó lỗi', async () => {
  const page = await readWorkspace();
  assert.match(page, /setNotice\('Đã lưu thay đổi đơn và giữ nguyên trạng thái Đã chốt\.'\)/);
  assert.match(page, /api<Order>\(`\/api\/retail\/orders\/\$\{next\.id\}`\)\.then\(setOrder\)\.catch\(\(\) => undefined\)/);
});
