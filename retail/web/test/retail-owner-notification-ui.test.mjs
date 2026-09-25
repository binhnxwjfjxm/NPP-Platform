import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('Lô 2 chỉ Owner thấy thiết lập thông báo và Trang chủ cảnh báo khi chưa hoạt động', async () => {
  const workspace = await read('app/retail-workspace.tsx');
  assert.match(workspace, /notificationState\.ready && notificationState\.isOwner/);
  assert.match(workspace, /openSettings\('notifications'\)/);
  assert.match(workspace, /<strong>Thông báo<\/strong>/);
  assert.match(workspace, /Thông báo đơn hàng chưa hoạt động/);
  assert.match(workspace, /retailNotificationStatusLabel\(notificationState\)/);
  assert.match(workspace, /Chỉ Owner nhận thông báo đơn cần kiểm tra/);
});

test('Lô 2 xin quyền chỉ từ thao tác Bật thông báo và theo dõi trạng thái subscription', async () => {
  const runtime = await read('app/retail-notification-runtime.tsx');
  assert.match(runtime, /export async function requestRetailNotificationPermission/);
  assert.match(runtime, /await activeSdk\.Notifications\.requestPermission\(\)/);
  assert.match(runtime, /await activeSdk\.User\.PushSubscription\.optIn\(\)/);
  assert.match(runtime, /permissionNative/);
  assert.match(runtime, /PushSubscription\.optedIn/);
  assert.match(runtime, /PushSubscription\.id/);
  assert.match(runtime, /addEventListener\('permissionChange'/);
  assert.match(runtime, /PushSubscription\.addEventListener\('change'/);
  const init = runtime.slice(runtime.indexOf('export function RetailNotificationRuntime'));
  assert.doesNotMatch(init, /Notifications\.requestPermission\(\)/);
});

test('Lô 2 có banner trong app và mở đúng đơn từ push/deep link', async () => {
  const [runtime, workspace, backend] = await Promise.all([
    read('app/retail-notification-runtime.tsx'),
    read('app/retail-workspace.tsx'),
    readRepo('npp-core/api/src/services/retail-owner-notification.js'),
  ]);
  assert.match(runtime, /foregroundWillDisplay/);
  assert.match(runtime, /RETAIL_NOTIFICATION_FOREGROUND_EVENT/);
  assert.match(runtime, /RETAIL_NOTIFICATION_OPEN_EVENT/);
  assert.match(workspace, /className="retail-notification-banner"/);
  assert.match(workspace, />Xem đơn<\/button>/);
  assert.match(workspace, /new URLSearchParams\(window\.location\.search\)\.get\('order'\)/);
  assert.match(backend, /url\.searchParams\.set\('order', orderId\)/);
  assert.match(backend, /notificationUrl\(runtime\.retailUrl, test \? null : orderId\)/);
});

test('Gửi thử dùng canonical Idempotency-Key và retry giữ nguyên key đến khi thành công', async () => {
  const workspace = await read('app/retail-workspace.tsx');
  const slice = workspace.slice(workspace.indexOf('async function sendNotificationTest'), workspace.indexOf('function openSettings'));
  assert.match(slice, /notificationTestKey\.current \?\? createIdempotencyKey\('retail-notification-test'\)/);
  assert.match(slice, /notificationTestKey\.current = key/);
  assert.match(slice, /await sendRetailNotificationTest\(key\)/);
  assert.match(slice, /notificationTestKey\.current = null/);
  const catchSlice = slice.slice(slice.indexOf('catch'));
  assert.doesNotMatch(catchSlice, /notificationTestKey\.current = null/);
});

test('iPhone có hướng dẫn cài Home Screen trước Web Push và không thêm âm thanh R2', async () => {
  const [pwa, runtime, workspace] = await Promise.all([
    read('app/pwa-registration.tsx'),
    read('app/retail-notification-runtime.tsx'),
    read('app/retail-workspace.tsx'),
  ]);
  assert.match(pwa, /iPad\|iPhone\|iPod/);
  assert.match(pwa, /Safari → bấm Chia sẻ → chọn Thêm vào Màn hình chính/);
  assert.match(runtime, /status: 'needs-install'/);
  assert.match(workspace, /Cách cài ứng dụng/);
  assert.match(workspace, /âm thanh do thiết bị quản lý/);
  assert.doesNotMatch(`${runtime}\n${workspace}`, /Audio\(|\.play\(|R2 audio|âm R2/i);
});
