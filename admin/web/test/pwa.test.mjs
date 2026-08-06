import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const manifest = read('app/manifest.ts');
const layout = read('app/layout.tsx');
const register = read('app/pwa-register.tsx');
const iconRoute = read('app/api/pwa-icon/route.ts');
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
});

test('Admin layout advertises PWA metadata without disabling zoom', () => {
  assert.match(layout, /manifest:\s*'\/manifest\.webmanifest'/);
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /mobile-web-app-capable/);
  assert.match(layout, /viewportFit:\s*'cover'/);
  assert.match(layout, /themeColor:\s*'#2b180b'/i);
  assert.match(layout, /<PwaRegister\s*\/>/);
  assert.doesNotMatch(layout, /maximumScale|userScalable/);
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
  assert.match(serviceWorker, /'\/api\/pwa-icon'/);
  assert.doesNotMatch(serviceWorker, /STATIC_PATH_PREFIXES[^;]*\/api\/(?!pwa-icon)/s);
  assert.match(offline, /Không có kết nối/);
});

test('PWA install assets stay public while Admin pages remain protected', () => {
  assert.match(middleware, /manifest\.webmanifest/);
  assert.match(middleware, /sw\.js/);
  assert.match(middleware, /offline\.html/);
  assert.match(middleware, /api\/pwa-icon/);
  assert.match(iconRoute, /SUPPORTED_SIZES = new Set\(\[192, 512\]\)/);
  assert.match(iconRoute, /maskable/);
  assert.match(iconRoute, /ImageResponse/);
});
