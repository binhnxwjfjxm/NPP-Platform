import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Retail dùng kênh hệ thống RETAIL theo sourceApp thay vì default channel', () => {
  const entry = source('../src/services/sales-order-entry.js');
  assert.match(entry, /retail-web/);
  assert.match(entry, /code: 'RETAIL'/);
  assert.match(entry, /ensureSystemSalesChannel/);
  assert.match(entry, /sourceChannelDefinition\(normalized\.payload, args\.requestContext\)/);
});

test('Retail price được resolve server-side bằng cùng kênh RETAIL', () => {
  const service = source('../src/services/retail-catalog.js');
  const route = source('../src/routes/retail-catalog.js');
  assert.match(service, /export async function resolveRetailPrice/);
  assert.match(service, /pricingService\.resolvePrice/);
  assert.match(service, /channelId: retailChannel\.channel\.id/);
  assert.match(route, /url\.pathname === '\/api\/retail\/price'/);
  assert.match(route, /corePriceRead/);
});
