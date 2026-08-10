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

test('Delivery approved source and derived PWA icons have exact dimensions', () => {
  const files = [
    ['../../../pwa-icon-deliveri.png', 512],
    ['../public/icons/delivery-180.png', 180],
    ['../public/icons/delivery-192.png', 192],
    ['../public/icons/delivery-512.png', 512],
    ['../public/icons/delivery-maskable-512.png', 512],
  ];
  for (const [path, size] of files) {
    const bytes = readFileSync(new URL(path, import.meta.url));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), size, `${path} width`);
    assert.equal(bytes.readUInt32BE(20), size, `${path} height`);
  }
});

test('Delivery maskable icon uses separately padded artwork', () => {
  const regular = readFileSync(new URL('../public/icons/delivery-512.png', import.meta.url));
  const maskable = readFileSync(new URL('../public/icons/delivery-maskable-512.png', import.meta.url));
  assert.equal(maskable.equals(regular), false);
});

test('Delivery bottom navigation is compact while preserving iPhone safe area', () => {
  const styles = read('app/delivery-mobile-app.css');
  assert.match(styles, /grid-template-rows:\s*auto minmax\(0, 1fr\) calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(styles, /\.deliveryAppDock[\s\S]*?min-height:\s*calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(styles, /\.deliveryAppDock[\s\S]*?padding:\s*5px 7px calc\(5px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(styles, /\.deliveryDockItem[\s\S]*?min-height:\s*48px/);
});

test('Delivery service worker caches only static assets and uses a safe offline page', () => {
  const worker = read('public/sw.js');
  const offline = read('public/offline.html');
  assert.match(worker, /hung-phat-delivery-static-v2/);
  assert.doesNotMatch(worker, /hung-phat-delivery-static-v1/);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /caches\.match\(OFFLINE_URL\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/_next\/static\/'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/icons\/'\)/);
  assert.doesNotMatch(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(offline, /Dữ liệu chuyến và kết quả giao hàng không được lưu ngoại tuyến/);
});

test('PWA public assets bypass workforce session gate while application pages remain protected', () => {
  const middleware = read('middleware.ts');
  assert.match(middleware, /manifest\.webmanifest\|sw\.js\|offline\.html\|icons\//);
  assert.match(middleware, /DELIVERY_SESSION_COOKIE/);
  assert.match(middleware, /\/api\/internal-auth\/me/);
  assert.match(middleware, /UNAUTHORIZED/);
  assert.doesNotMatch(middleware, /WWW-Authenticate|Basic realm/);
});
