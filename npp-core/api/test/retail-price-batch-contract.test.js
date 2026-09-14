import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../src/services/retail-catalog.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/routes/retail-catalog.js', import.meta.url), 'utf8');

test('Retail price batch uses the canonical pricing contract and bounded concurrency', () => {
  assert.match(service, /RETAIL_PRICE_BATCH_LIMIT = 100/);
  assert.match(service, /RETAIL_PRICE_BATCH_CONCURRENCY = 4/);
  assert.match(service, /allowMissingBasePrice: true/);
  assert.match(service, /resolutionStatus === 'MANUAL_PRICE_REQUIRED'/);
  assert.match(service, /status: 'MANUAL_PRICE_REQUIRED'/);
  assert.match(service, /Promise\.all\(Array\.from\(\{ length: workerCount \}/);
  assert.match(service, /if \(fatalResult\) return fatalResult/);
});

test('Retail exposes one batch route whose item conflicts stay inside a 200 result envelope', () => {
  assert.match(route, /url\.pathname === '\/api\/retail\/prices'/);
  assert.match(route, /resolveRetailPrices/);
  assert.match(route, /sendSuccess\(res, result\.resolutions/);
});
