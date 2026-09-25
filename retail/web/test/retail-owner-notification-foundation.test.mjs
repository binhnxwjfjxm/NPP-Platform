import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retail Lô 1 đăng ký OneSignal riêng, không xin quyền tự động và không phát audio R2', async () => {
  const [layout, runtime, worker, middleware] = await Promise.all([
    read('app/layout.tsx'),
    read('app/retail-notification-runtime.tsx'),
    read('public/onesignal/OneSignalSDKWorker.js'),
    read('middleware.ts'),
  ]);
  assert.match(layout, /RetailNotificationRuntime/);
  assert.match(runtime, /NEXT_PUBLIC_RETAIL_ONESIGNAL_APP_ID/);
  assert.match(runtime, /serviceWorkerPath: '\/onesignal\/OneSignalSDKWorker\.js'/);
  assert.match(runtime, /serviceWorkerParam: \{ scope: '\/onesignal\/' \}/);
  assert.match(runtime, /OneSignal\.login\(identity\.userId\)/);
  assert.match(runtime, /OneSignal\.logout\(\)/);
  assert.doesNotMatch(runtime, /Audio\(|\.play\(|R2/i);
  const initSlice = runtime.slice(runtime.indexOf('export function RetailNotificationRuntime'));
  assert.doesNotMatch(initSlice.slice(0, initSlice.indexOf('return null;')), /requestRetailNotificationPermission\(/);
  assert.match(worker, /OneSignalSDK\.sw\.js/);
  assert.match(middleware, /onesignal\//);
});

test('Retail chỉ đánh dấu Owner từ role canonical và có proxy test idempotent', async () => {
  const [me, testRoute] = await Promise.all([
    read('app/api/auth/me/route.ts'),
    read('app/api/notifications/test/route.ts'),
  ]);
  assert.match(me, /system:security-owner/);
  assert.match(me, /actorId\.startsWith\('user:'\)/);
  assert.match(testRoute, /idempotency-key/);
  assert.match(testRoute, /\/api\/retail\/owner-notifications\/test/);
  assert.match(testRoute, /idempotencyKey: key/);
});
