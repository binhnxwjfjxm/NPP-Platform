import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');

test('Retail remembers terminal price conflicts instead of retrying them forever', () => {
  assert.match(workspace, /priceFailures/);
  assert.match(workspace, /priceRequests/);
  assert.match(workspace, /BASE_PRICE_NOT_FOUND/);
  assert.match(workspace, /VARIANT_NOT_PRICEABLE/);
  assert.match(workspace, /Chưa có giá/);
  assert.match(workspace, /priceRequests\.current\.has\(inputKey\)/);
  assert.match(workspace, /priceFailures\[row\.product\.id\]\?\.inputKey === inputKey/);
  assert.doesNotMatch(workspace, /api<PricePreview>\('\/api\/retail\/price'[\s\S]{0,600}\.catch\(\(\) => undefined\)/);
});

test('Retail waits for a system price or a permitted manual price before draft sync', () => {
  assert.match(workspace, /pricingReady/);
  assert.match(workspace, /if \(!pricingReady\)\s*return/);
});