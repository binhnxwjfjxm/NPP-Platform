import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pricing = readFileSync(new URL('../src/services/pricing.js', import.meta.url), 'utf8');

test('SKU-keyed pricing import resolves canonical SKU and preserves existing row identity', () => {
  assert.match(pricing, /args\?\.payload\?\.matchBySku === true/);
  assert.match(pricing, /getVariantBySkuForPricing/);
  assert.match(pricing, /listPriceListItems/);
  assert.match(pricing, /matchesSkuIdentity/);
  assert.match(pricing, /legacy\.updatePriceListItem/);
  assert.match(pricing, /expectedUpdatedAt: existing\.updated_at/);
  assert.match(pricing, /legacy\.createPriceListItem/);
});

test('SKU-keyed pricing import does not require sourceKey and rejects ambiguous duplicate identities', () => {
  assert.match(pricing, /Every SKU-keyed item requires priceListCode, sku and adjustmentType/);
  assert.doesNotMatch(pricing, /Every SKU-keyed item requires[^\n]*sourceKey/);
  assert.match(pricing, /IMPORT_IDENTITY_CONFLICT/);
  assert.match(pricing, /matching\.length > 1/);
});
