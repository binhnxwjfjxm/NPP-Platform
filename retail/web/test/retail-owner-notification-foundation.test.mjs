import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retail dùng Web Push chuẩn trình duyệt, không còn OneSignal hoặc audio R2', async () => {
  const [layout, runtime, worker, middleware] = await Promise.all([
    read('app/layout.tsx'),
    read('app/retail-notification-runtime.tsx'),
    read('public/sw.js'),
    read('middleware.ts'),
  ]);
  assert.match(layout, /RetailNotificationRuntime/);
  assert.match(runtime, /PushManager/);
  assert.match(runtime, /Notification\.requestPermission\(\)/);
  assert.match(runtime, /pushManager\.subscribe/);
  assert.match(runtime, /applicationServerKey/);
  assert.match(runtime, /\/api\/notifications\/config/);
  assert.match(runtime, /\/api\/notifications\/subscriptions/);
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /addEventListener\('notificationclick'/);
  assert.doesNotMatch(`${runtime}\n${worker}\n${middleware}`, /OneSignal|ONESIGNAL|onesignal\.com|Audio\(|\.play\(|R2 audio/i);
});

test('Retail không tự xin quyền thông báo khi vừa mở ứng dụng', async () => {
  const runtime = await read('app/retail-notification-runtime.tsx');
  const initSlice = runtime.slice(runtime.indexOf('export function RetailNotificationRuntime'));
  assert.doesNotMatch(initSlice, /Notification\.requestPermission\(\)/);
  const permissionSlice = runtime.slice(
    runtime.indexOf('export async function requestRetailNotificationPermission'),
    runtime.indexOf('export async function unregisterRetailNotificationForLogout'),
  );
  assert.match(permissionSlice, /Notification\.requestPermission\(\)/);
  assert.match(permissionSlice, /pushManager\.subscribe/);
});

test('Retail chỉ đánh dấu Owner theo contract canonical và proxy subscription giữ Idempotency-Key', async () => {
  const [me, testRoute, subscriptionRoute, configRoute] = await Promise.all([
    read('app/api/auth/me/route.ts'),
    read('app/api/notifications/test/route.ts'),
    read('app/api/notifications/subscriptions/route.ts'),
    read('app/api/notifications/config/route.ts'),
  ]);
  assert.match(me, /system:security-owner/);
  assert.match(me, /system:implementation-owner/);
  assert.match(me, /ownerKind === 'PERMANENT'/);
  assert.match(me, /ownerKind === 'TEMPORARY'/);
  assert.match(me, /actorId\.startsWith\('user:'\)/);
  assert.match(testRoute, /idempotency-key/);
  assert.match(testRoute, /\/api\/retail\/owner-notifications\/test/);
  assert.match(subscriptionRoute, /\/api\/retail\/owner-notifications\/subscriptions/);
  assert.match(subscriptionRoute, /idempotencyKey: key/);
  assert.match(configRoute, /\/api\/retail\/owner-notifications\/config/);
});

test('đăng xuất Retail gỡ subscription thiết bị trước khi kết thúc phiên', async () => {
  const [runtime, workspace] = await Promise.all([
    read('app/retail-notification-runtime.tsx'),
    read('app/retail-workspace.tsx'),
  ]);
  assert.match(runtime, /export async function unregisterRetailNotificationForLogout/);
  assert.match(runtime, /\/api\/notifications\/subscriptions\/remove/);
  assert.match(runtime, /subscription\.unsubscribe\(\)/);
  assert.match(workspace, /await unregisterRetailNotificationForLogout\(\)/);
  assert.match(workspace, /fetch\('\/api\/auth\/logout'/);
});
