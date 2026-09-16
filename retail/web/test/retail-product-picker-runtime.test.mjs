import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retail layout mounts the product picker runtime before workspace interactions', async () => {
  const layout = await read('app/layout.tsx');
  assert.match(layout, /import \{ RetailProductPickerRuntime \} from '\.\/retail-product-picker-runtime';/);
  assert.match(layout, /<PwaRegistration \/><RetailProductPickerRuntime \/><RetailSystemPrintPageSizer \/>/);
});

test('Retail product catalog uses IndexedDB as an acceleration layer with network fallback and refresh', async () => {
  const [runtime, cache] = await Promise.all([
    read('app/retail-product-picker-runtime.tsx'),
    read('lib/product-catalog-cache.ts'),
  ]);
  assert.match(cache, /window\.indexedDB\.open\(DB_NAME, DB_VERSION\)/);
  assert.match(cache, /export async function findCachedRetailProducts/);
  assert.match(cache, /export async function replaceRetailProductCache/);
  assert.match(runtime, /const nativeFetch = window\.fetch\.bind\(window\)/);
  assert.match(runtime, /findCachedRetailProducts\(search, limit, offset\)/);
  assert.match(runtime, /refreshRequestInBackground\(input, init\)/);
  assert.match(runtime, /retailProductCacheIsFresh\(\)/);
  assert.match(runtime, /replaceRetailProductCache\(all\)/);
  assert.match(runtime, /if \(window\.fetch === wrappedFetch\) window\.fetch = nativeFetch/);
});

test('Clicking the same Retail product card reuses existing selection controls to increment quantity', async () => {
  const runtime = await read('app/retail-product-picker-runtime.tsx');
  assert.match(runtime, /closest<HTMLElement>\('\.product-sheet \.lot7-product-row'\)/);
  assert.match(runtime, /querySelector<HTMLButtonElement>\('\.quantity-stepper button:last-of-type'\)/);
  assert.match(runtime, /querySelector<HTMLButtonElement>\('\.add-product'\)/);
  assert.match(runtime, /increment\.click\(\)/);
});
