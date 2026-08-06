import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Delivery PWA declares standalone metadata and install icons', () => {
  const layout = read('app/layout.tsx');
  const manifest = read('app/manifest.ts');
  assert.match(layout, /PwaRegister/);
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /delivery-180\.png/);
  assert.match(manifest, /display:\s*'standalone'/);
  assert.match(manifest, /delivery-maskable-512\.png/);
  assert.match(manifest, /purpose:\s*'maskable'/);
  for (const icon of [
    'public/icons/delivery-180.png',
    'public/icons/delivery-192.png',
    'public/icons/delivery-512.png',
    'public/icons/delivery-maskable-512.png',
  ]) {
    assert.equal(existsSync(new URL(`../${icon}`, import.meta.url)), true, `${icon} must exist`);
  }
});

test('Delivery service worker caches only static assets and uses a safe offline page', () => {
  const worker = read('public/sw.js');
  const offline = read('public/offline.html');
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /caches\.match\(OFFLINE_URL\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/_next\/static\/'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/icons\/'\)/);
  assert.doesNotMatch(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(offline, /Dữ liệu chuyến và kết quả giao hàng không được lưu ngoại tuyến/);
});

test('PWA public assets bypass Basic Auth while application pages remain protected', () => {
  const middleware = read('middleware.ts');
  assert.match(middleware, /manifest\.webmanifest\|sw\.js\|offline\.html\|icons\//);
  assert.match(middleware, /WWW-Authenticate/);
});
