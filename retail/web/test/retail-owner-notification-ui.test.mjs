import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('chỉ Owner thấy thiết lập thông báo và Trang chủ cảnh báo khi chưa hoạt động', async () => {
  const workspace = await read('app/retail-workspace.tsx');
  assert.match(workspace, /notificationState\.ready && notificationState\.isOwner/);
  assert.match(workspace, /openSettings\('notifications'\)/);
  assert.match(workspace, /<strong>Thông báo<\/strong>/);
  assert.match(workspace, /Thông báo đơn hàng chưa hoạt động/);
  assert.match(workspace, /retailNotificationStatusLabel\(notificationState\)/);
  assert.match(workspace, /Chỉ Owner nhận thông báo đơn cần kiểm tra/);
});

test('Bật thông báo dùng Notification + PushManager và đăng ký thiết bị bằng key canonical', async () => {
  const runtime = await read('app/retail-notification-runtime.tsx');
  const permissionSlice = runtime.slice(
    runtime.indexOf('export async function requestRetailNotificationPermission'),
    runtime.indexOf('export async function unregisterRetailNotificationForLogout'),
  );
  assert.match(permissionSlice, /Notification\.requestPermission\(\)/);
  assert.match(permissionSlice, /pushManager\.getSubscription\(\)/);
  assert.match(permissionSlice, /pushManager\.subscribe/);
  assert.match(permissionSlice, /applicationServerKey/);
  assert.match(runtime, /createIdempotencyKey\('retail-web-push-subscribe'\)/);
  assert.match(runtime, /pendingRegisterKey = key/);
  assert.match(runtime, /pendingRegisterKey = null/);
});

test('Service Worker hiện notification hệ thống, banner trong app và mở đúng đơn', async () => {
  const [runtime, worker, workspace, backend] = await Promise.all([
    read('app/retail-notification-runtime.tsx'),
    read('public/sw.js'),
    read('app/retail-workspace.tsx'),
    readRepo('npp-core/api/src/services/retail-owner-notification.js'),
  ]);
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /showNotification\(payload\.title/);
  assert.match(worker, /retail:notification-foreground/);
  assert.match(worker, /notificationclick/);
  assert.match(worker, /retail:notification-open/);
  assert.match(worker, /existing\.postMessage\(\{ type: 'retail:notification-open'/);
  assert.match(worker, /await existing\.focus\(\)/);
  assert.doesNotMatch(worker, /existing\.navigate\(target\)/);
  assert.match(worker, /await self\.clients\.openWindow\(target\)/);
  assert.match(runtime, /RETAIL_NOTIFICATION_FOREGROUND_EVENT/);
  assert.match(runtime, /RETAIL_NOTIFICATION_OPEN_EVENT/);
  assert.match(workspace, /className="retail-notification-banner"/);
  assert.match(workspace, />Xem đơn<\/button>/);
  assert.match(workspace, /new URLSearchParams\(window\.location\.search\)\.get\('order'\)/);
  assert.match(backend, /\?order=/);
  assert.doesNotMatch(`${runtime}\n${worker}\n${backend}`, /OneSignal|ONESIGNAL|onesignal\.com/);
});

test('Gửi thử dùng canonical Idempotency-Key và retry giữ nguyên key đến khi thành công', async () => {
  const workspace = await read('app/retail-workspace.tsx');
  const slice = workspace.slice(workspace.indexOf('async function sendNotificationTest'), workspace.indexOf('async function logoutRetail'));
  assert.match(slice, /notificationTestKey\.current \?\? createIdempotencyKey\('retail-notification-test'\)/);
  assert.match(slice, /notificationTestKey\.current = key/);
  assert.match(slice, /await sendRetailNotificationTest\(key\)/);
  assert.match(slice, /notificationTestKey\.current = null/);
  const catchSlice = slice.slice(slice.indexOf('catch'));
  assert.doesNotMatch(catchSlice, /notificationTestKey\.current = null/);
});

test('iPhone yêu cầu Home Screen trước Web Push và không phát âm riêng', async () => {
  const [pwa, runtime, workspace, worker] = await Promise.all([
    read('app/pwa-registration.tsx'),
    read('app/retail-notification-runtime.tsx'),
    read('app/retail-workspace.tsx'),
    read('public/sw.js'),
  ]);
  assert.match(pwa, /iPad\|iPhone\|iPod/);
  assert.match(pwa, /Safari → bấm Chia sẻ → chọn Thêm vào Màn hình chính/);
  assert.match(runtime, /status: 'needs-install'/);
  assert.match(workspace, /Cách cài ứng dụng/);
  assert.match(workspace, /âm thanh do thiết bị quản lý/);
  assert.doesNotMatch(`${runtime}\n${workspace}\n${worker}`, /Audio\(|\.play\(|sound:|silent:|R2 audio|âm R2/i);
});
