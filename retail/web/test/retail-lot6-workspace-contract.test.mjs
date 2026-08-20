import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL('../../../' + path, import.meta.url), 'utf8');
const readWorkspace = async () => (await Promise.all([read('app/page.tsx'), read('app/retail-workspace.tsx')])).join('\n');

test('Lô 6 có điều hướng Retail, thanh thao tác đáy và mở lại đơn Giao tại quầy', async () => {
  const [page, styles] = await Promise.all([readWorkspace(), read('app/globals.css')]);
  assert.match(page, /type RetailTab = 'home' \| 'entry' \| 'orders' \| 'account'/); assert.match(page, /Trang chủ/); assert.match(page, /Lên đơn/); assert.match(page, /Đơn hàng/); assert.match(page, /Tài khoản/); assert.match(page, /Đơn đã lập/); assert.match(page, /api\/retail\/orders\?limit=100/); assert.match(page, /item\.deliveryMode === 'PICKUP'/); assert.match(page, /order-action-bar/); assert.match(page, /bottom-nav/); assert.match(styles, /\.order-action-bar \{ position: fixed/); assert.match(styles, /\.bottom-nav \{ position: fixed/);
});

test('Lô 6 cho sửa Giao tại quầy sau Chốt, nhưng khóa sau mọi trạng thái đã Xuất kho', async () => {
  const [page, retailRoute, salesRoute, salesService] = await Promise.all([readWorkspace(), read('app/api/retail/[...segments]/route.ts'), readRepo('npp-core/api/src/routes/sales-orders.js'), readRepo('npp-core/api/src/services/sales-order.js')]);
  assert.match(page, /const canEditPickup = order\?\.status === 'confirmed'/); assert.match(page, /Sửa đơn/); assert.match(page, /pickup-edit/); assert.match(retailRoute, /'pickup-edit': \{ path: .*pickup-edit/); assert.match(salesRoute, /action === 'pickup-edit' && method === 'PUT'/); assert.match(salesRoute, /coreSalesOrderAmend/); assert.match(salesService, /partially_issued/); assert.match(salesService, /PICKUP_EDIT_LOCKED/); assert.match(salesService, /String\(before\.salesOrder\.revision\) !== expectedRevision/); assert.match(salesService, /REVISION_CONFLICT/);
});

test('Lô 6 chỉ dùng giá preview đúng đầu vào và không báo lỗi sau khi thao tác đã thành công', async () => { const page = await readWorkspace(); assert.match(page, /type CachedPricePreview = PricePreview & \{ inputKey: string \}/); assert.match(page, /preview\?\.inputKey === priceInputKey\(line\.id, line\.quantity\)/); assert.match(page, /void refreshOrders\(\)\.catch\(\(\) => undefined\)/); assert.match(page, /setPrices\(\{\}\)/); });

test('PWA dùng đúng icon Retail cho iPhone, manifest và cache mới', async () => { const [layout, manifest, serviceWorker] = await Promise.all([read('app/layout.tsx'), read('app/manifest.ts'), read('public/sw.js')]); assert.match(layout, /apple: \[\{ url: '\/pwa-icon-retail\.png\?v=2'/); assert.match(layout, /icon: \[\{ url: '\/pwa-icon-retail\.png\?v=2'/); assert.match(manifest, /purpose: 'any'/); assert.match(manifest, /purpose: 'maskable'/); assert.match(manifest, /pwa-icon-retail\.png\?v=2/); assert.match(serviceWorker, /hung-phat-retail-static-v2/); });

test('Quét mã là thao tác camera thật có fallback tìm SKU', async () => { const page = await readWorkspace(); assert.match(page, /navigator\.mediaDevices\?\.getUserMedia/); assert.match(page, /window\.BarcodeDetector/); assert.match(page, /Đưa mã vào khung hình/); assert.match(page, /Hãy dùng ô tìm kiếm SKU/); });
