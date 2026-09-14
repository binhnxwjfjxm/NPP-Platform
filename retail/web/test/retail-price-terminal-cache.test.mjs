import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
const gateway = await readFile(new URL('../app/api/retail/[...segments]/route.ts', import.meta.url), 'utf8');

test('Retail batches visible price previews and treats missing base price as a business state', () => {
  assert.match(workspace, /api<PriceBatchResult\[]>\('\/api\/retail\/prices'/);
  assert.match(workspace, /items: pending\.map/);
  assert.match(workspace, /MANUAL_PRICE_REQUIRED/);
  assert.match(workspace, /Chưa có giá Công Ty/);
  assert.match(workspace, /priceRequests\.current\.has\(inputKey\)/);
  assert.doesNotMatch(workspace, /api<PricePreview>\('\/api\/retail\/price'/);
  assert.match(gateway, /path\[0\] === 'prices'/);
  assert.match(gateway, /path: '\/api\/retail\/prices'/);
});

test('Retail waits for a system price or a permitted manual price before draft sync', () => {
  assert.match(workspace, /pricingReady/);
  assert.match(workspace, /if \(!pricingReady\)\s*return/);
});
