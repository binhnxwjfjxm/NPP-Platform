import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const manifest = read('app/manifest.ts');
const layout = read('app/layout.tsx');
const register = read('app/pwa-register.tsx');
const serviceWorker = read('public/sw.js');
const offline = read('public/offline.html');
const middleware = read('middleware.ts');

test('Admin exposes an installable standalone manifest with required icons', () => {
  assert.match(manifest, /display:\s*'standalone'/);
  assert.match(manifest, /start_url:\s*'\/'/);
  assert.match(manifest, /scope:\s*'\/'/);
  assert.match(manifest, /192x192/);
  assert.match(manifest, /512x512/);
  assert.match(manifest, /purpose:\s*'maskable'/);
  assert.match(manifest, /theme_color:\s*'#2b180b'/i);
  assert.match(manifest, /\/icons\/admin-192\.png/);
  assert.match(manifest, /\/icons\/admin-512\.png/);
  assert.match(manifest, /\/icons\/admin-maskable-512\.png/);
  assert.doesNotMatch(manifest, /api\/pwa-icon/);
});

test('Admin layout advertises PWA metadata without disabling zoom', () => {
  assert.match(layout, /manifest:\s*'\/manifest\.webmanifest'/);
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /mobile-web-app-capable/);
  assert.match(layout, /viewportFit:\s*'cover'/);
  assert.match(layout, /themeColor:\s*'#2b180b'/i);
  assert.match(layout, /<PwaRegister\s*\/>/);
  assert.match(layout, /\/icons\/admin-180\.png/);
  assert.match(layout, /\/icons\/admin-192\.png/);
  assert.match(layout, /\/icons\/admin-512\.png/);
  assert.doesNotMatch(layout, /api\/pwa-icon|maximumScale|userScalable/);
});

test('Admin approved source and derived PWA icons have exact dimensions', () => {
  const files = [
    ['../../../pwa-icon-admin.png', 512],
    ['../public/icons/admin-180.png', 180],
    ['../public/icons/admin-192.png', 192],
    ['../public/icons/admin-512.png', 512],
    ['../public/icons/admin-maskable-512.png', 512],
  ];
  for (const [path, size] of files) {
    const bytes = readFileSync(new URL(path, import.meta.url));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), size, `${path} width`);
    assert.equal(bytes.readUInt32BE(20), size, `${path} height`);
  }
});

test('Admin registers a root-scoped service worker', () => {
  assert.match(register, /serviceWorker\.register\('\/sw\.js'/);
  assert.match(register, /scope:\s*'\/'/);
  assert.match(register, /updateViaCache:\s*'none'/);
});

test('Admin service worker keeps private pages and APIs out of runtime cache', () => {
  assert.match(serviceWorker, /request\.mode === 'navigate'/);
  assert.match(serviceWorker, /fetch\(request\)\.catch\(\(\) => caches\.match\(OFFLINE_URL\)\)/);
  assert.match(serviceWorker, /if \(!isStaticAsset\(url\)\) return/);
  assert.match(serviceWorker, /'\/_next\/static\/'/);
  assert.match(serviceWorker, /'\/icons\/'/);
  assert.match(serviceWorker, /admin-mcp-npp-static-v2/);
  assert.doesNotMatch(serviceWorker, /api\/pwa-icon|admin-mcp-npp-static-v1/);
  assert.doesNotMatch(serviceWorker, /STATIC_PATH_PREFIXES[^;]*\/api\/(?!pwa-icon)/s);
  assert.match(offline, /Không có kết nối/);
});

test('PWA install assets stay public while Admin pages remain protected', () => {
  assert.match(middleware, /manifest\.webmanifest/);
  assert.match(middleware, /sw\.js/);
  assert.match(middleware, /offline\.html/);
  assert.match(middleware, /icons\//);
  assert.doesNotMatch(middleware, /api\/pwa-icon/);
});
