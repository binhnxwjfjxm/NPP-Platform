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


test('SKU-keyed price adjustment preserves history and supports now or scheduled replacement', () => {
  assert.match(pricing, /payload\.replaceFrom === true/);
  assert.match(pricing, /replacementApplyAt/);
  assert.match(pricing, /matchesSkuScope/);
  assert.match(pricing, /effectiveTo: applyAt/);
  assert.match(pricing, /effectiveFrom: applyAt/);
  assert.match(pricing, /replacesPriceItemId/);
  assert.match(pricing, /itemsReplaced/);
});

test('direct price collision examines exact-start and overlapping rows before writes, then validates every revision', () => {
  const guard = pricing.indexOf('const conflicts =');
  const update = pricing.indexOf('if (exactStart.length === 1)');
  assert.ok(guard > -1 && guard < update, 'collision check must precede exact-start updates');
  assert.match(pricing, /\.\.\.exactStart, \.\.\.overlapping/);
  assert.match(pricing, /selections\.length !== conflicts\.length/);
  assert.match(pricing, /selected\.size !== conflicts\.length/);
  assert.match(pricing, /selected\.get\(item\.id\) === dateKey\(item\.updated_at\)/);
  assert.match(pricing, /isActive: !startsAt/);
  assert.match(pricing, /replacesPriceItemIds: conflicts\.map/);
  assert.match(pricing, /priceConflictDetails\(sku, priceListCode, conflicts\)/);
});
