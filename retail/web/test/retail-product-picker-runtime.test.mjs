import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retail layout mounts the product picker runtime before workspace interactions', async () => {
  const layout = await read('app/layout.tsx');
  assert.match(layout, /import \{ RetailProductPickerRuntime \} from '\.\/retail-product-picker-runtime';/);
  assert.match(layout, /<PwaRegistration \/><RetailProductPickerRuntime \/><RetailSystemPrintPageSizer \/>/);
});

test('Retail product catalog uses session-scoped IndexedDB with network fallback and refresh', async () => {
  const [runtime, cache, scopeRoute] = await Promise.all([
    read('app/retail-product-picker-runtime.tsx'),
    read('lib/product-catalog-cache.ts'),
    read('app/api/auth/cache-scope/route.ts'),
  ]);
  assert.match(cache, /DB_NAME_PREFIX = 'npp-retail-catalog-v2-'/);
  assert.match(cache, /function databaseName\(scope: string\)/);
  assert.match(cache, /export async function findCachedRetailProducts\(scope: string/);
  assert.match(cache, /export async function replaceRetailProductCache\(scope: string/);
  assert.match(cache, /export async function removeLegacyRetailProductCache/);
  assert.match(runtime, /const nativeFetch = window\.fetch\.bind\(window\)/);
  assert.match(runtime, /CACHE_SCOPE_PATH = '\/api\/auth\/cache-scope'/);
  assert.match(runtime, /findCachedRetailProducts\(scope, search, limit, offset\)/);
  assert.match(runtime, /retailProductCacheIsFresh\(scope\)/);
  assert.match(runtime, /replaceRetailProductCache\(scope, all\)/);
  assert.match(runtime, /if \(window\.fetch === wrappedFetch\) window\.fetch = nativeFetch/);
  assert.match(scopeRoute, /RETAIL_SESSION_COOKIE/);
  assert.match(scopeRoute, /createHash\('sha256'\)/);
  assert.doesNotMatch(scopeRoute, /data:\s*\{\s*token/);
});

test('Retail cached search honors cancellation and evicts stale matches after authoritative empty responses', async () => {
  const [runtime, cache] = await Promise.all([
    read('app/retail-product-picker-runtime.tsx'),
    read('lib/product-catalog-cache.ts'),
  ]);
  assert.match(runtime, /function requestSignal/);
  assert.match(runtime, /throwIfAborted\(signal\)/);
  assert.match(runtime, /DOMException\('The operation was aborted\.', 'AbortError'\)/);
  assert.match(runtime, /removeCachedRetailSearchMatches\(scope, search\)/);
  assert.match(cache, /export async function removeCachedRetailSearchMatches/);
});

test('Clicking the same Retail product card reuses existing selection controls to increment quantity', async () => {
  const runtime = await read('app/retail-product-picker-runtime.tsx');
  assert.match(runtime, /closest<HTMLElement>\('\.product-sheet \.lot7-product-row'\)/);
  assert.match(runtime, /querySelector<HTMLButtonElement>\('\.quantity-stepper button:last-of-type'\)/);
  assert.match(runtime, /querySelector<HTMLButtonElement>\('\.add-product'\)/);
  assert.match(runtime, /increment\.click\(\)/);
});

test('Retail product cards are keyboard operable through the same selection control', async () => {
  const runtime = await read('app/retail-product-picker-runtime.tsx');
  assert.match(runtime, /row\.tabIndex = 0/);
  assert.match(runtime, /row\.setAttribute\('role', 'button'\)/);
  assert.match(runtime, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(runtime, /document\.addEventListener\('keydown', handlePickerKeyDown, true\)/);
});


test('Retail có điểm cài PWA Android rõ ràng trong Cài đặt và vẫn dùng browser install prompt', async () => {
  const [pwa, workspace] = await Promise.all([
    read('app/pwa-registration.tsx'),
    read('app/retail-workspace.tsx'),
  ]);
  assert.match(pwa, /beforeinstallprompt/);
  assert.match(pwa, /RETAIL_PWA_INSTALL_EVENT = 'retail:pwa-install'/);
  assert.match(pwa, /requestRetailPwaInstall/);
  assert.match(pwa, /Cài ứng dụng hoặc Thêm vào màn hình chính/);
  assert.match(workspace, /import \{ requestRetailPwaInstall \} from '\.\/pwa-registration';/);
  assert.match(workspace, /onClick=\{requestRetailPwaInstall\}/);
  assert.match(workspace, /Cài ứng dụng Android/);
});
