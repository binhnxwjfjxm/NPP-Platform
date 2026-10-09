import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../app/pricing/pricing-overview-summary.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { summarizeCurrentPriceRules, decimalKey } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const at = Date.parse('2026-10-09T12:00:00.000Z');
const before = '2026-10-08T12:00:00.000Z';
const after = '2026-10-10T12:00:00.000Z';
function price(overrides = {}) {
  return {
    isActive: true,
    listIsActive: true,
    adjustmentType: 'FIXED_PRICE',
    amountMinor: '745000',
    minQuantity: '0.000000',
    maxQuantity: '',
    effectiveFrom: '',
    effectiveTo: '',
    listEffectiveFrom: '',
    listEffectiveTo: '',
    ...overrides,
  };
}
const fixed = (amountMinor) => ({ kind: 'FIXED', amountMinor });

test('shows a current direct price even when the row has effective dates', () => {
  assert.deepEqual(summarizeCurrentPriceRules([price({ effectiveFrom: before, effectiveTo: after })], at), fixed('745000'));
  assert.deepEqual(summarizeCurrentPriceRules([price({ amountMinor: '0', effectiveFrom: before })], at), fixed('0'));
  assert.equal(decimalKey('0.000000'), '0');
});

test('ignores future and expired historical prices without deleting them', () => {
  const history = [
    price({ amountMinor: '690000', effectiveTo: before }),
    price({ amountMinor: '745000', effectiveFrom: before, effectiveTo: after }),
    price({ amountMinor: '800000', effectiveFrom: after }),
  ];
  assert.deepEqual(summarizeCurrentPriceRules(history, at), fixed('745000'));
  assert.deepEqual(summarizeCurrentPriceRules([history[0], history[2]], at), { kind: 'NONE' });
  assert.deepEqual(summarizeCurrentPriceRules([price({ isActive: false })], at), { kind: 'NONE' });
});

test('uses inclusive start and exclusive end timestamps, including price list windows', () => {
  const current = price({ effectiveFrom: before, effectiveTo: after, listEffectiveFrom: before, listEffectiveTo: after });
  assert.deepEqual(summarizeCurrentPriceRules([current], Date.parse(before)), fixed('745000'));
  assert.deepEqual(summarizeCurrentPriceRules([current], Date.parse(after)), { kind: 'NONE' });
  assert.deepEqual(summarizeCurrentPriceRules([price({ listEffectiveFrom: after })], at), { kind: 'NONE' });
  assert.deepEqual(summarizeCurrentPriceRules([price({ listIsActive: false })], at), { kind: 'NONE' });
  assert.deepEqual(summarizeCurrentPriceRules([price({ effectiveFrom: 'bad timestamp' })], at), { kind: 'NONE' });
});

test('keeps genuinely competing or condition-dependent rules visible for review', () => {
  assert.deepEqual(summarizeCurrentPriceRules([price(), price({ amountMinor: '720000' })], at), { kind: 'MULTIPLE' });
  assert.deepEqual(summarizeCurrentPriceRules([price({ minQuantity: '10' })], at), { kind: 'CONDITIONAL' });
  assert.deepEqual(summarizeCurrentPriceRules([price({ maxQuantity: '20' })], at), { kind: 'CONDITIONAL' });
  assert.deepEqual(summarizeCurrentPriceRules([price({ adjustmentType: 'PERCENT_DISCOUNT' })], at), { kind: 'CONDITIONAL' });
});

test('screen and both exported summaries share the same effective-price calculation', () => {
  const overview = readFileSync(new URL('../app/pricing/pricing-overview.tsx', import.meta.url), 'utf8');
  assert.match(overview, /summarizeCurrentPriceRules\(rules, priceAt\)/);
  assert.match(overview, /function exportSummaryValue\(rules: RuleView\[\], at: number\): ExportCell \{\s*const summary = summarizeCurrentPriceRules\(rules, at\)/);
  assert.match(overview, /exportSummaryValue\(indexes\.baseBySku\.get\(sku\.sku\.toUpperCase\(\)\) \?\? \[\], priceAt\)/);
  assert.match(overview, /exportSummaryValue\(indexes\.byListSku\.get\(ruleKey\(list\.code, sku\.sku\)\) \?\? \[\], priceAt\)/);
  assert.match(overview, /summarizeRules\(ruleIndexes\.baseBySku\.get\(row\.sku\.toUpperCase\(\)\) \?\? \[\], displayPriceAt\)/);
  assert.match(overview, /listEffectiveFrom: list\.effective_from/);
  assert.match(overview, /listEffectiveFrom: list\?\.effective_from/);
  assert.match(overview, /'Theo điều kiện'/);
  assert.match(overview, /'Nhiều mức giá'/);
});
