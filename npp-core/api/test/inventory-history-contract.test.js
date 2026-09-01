import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const repository = await readFile(new URL('../src/db/repositories/inventory-balance.js', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/services/inventory-balance.js', import.meta.url), 'utf8');
const route = await readFile(new URL('../src/routes/inventory-core.js', import.meta.url), 'utf8');

test('inventory history follows the immutable ledger and groups physical lines into one business movement row', () => {
  assert.match(repository, /export async function listInventoryMovementHistory/);
  assert.match(repository, /sum\(line\.base_quantity_delta\)::numeric\(30,12\) AS base_quantity_delta/);
  assert.match(repository, /GROUP BY movement\.id/);
  assert.match(repository, /sum\(history\.base_quantity_delta\) OVER/);
  assert.match(repository, /AS stock_after/);
  assert.match(repository, /\$6::text = 'warehouse'/);
  assert.match(repository, /LEFT JOIN shared\.users actor_user/);
  assert.match(repository, /LEFT JOIN shared\.employees actor_employee/);
  assert.match(repository, /max\(actor_employee\.full_name\) AS posted_by_name/);
  assert.match(repository, /string_agg\([\s\S]*location\.code/);
  assert.match(repository, /string_agg\([\s\S]*line\.lot_code/);
});

test('inventory history keeps authorization, explicit scope and bounded pagination in the service and route', () => {
  assert.match(service, /HISTORY_SCOPE_MODES = new Set\(\['exact', 'warehouse'\]\)/);
  assert.match(service, /validateReadScope\(requestContext/);
  assert.match(service, /scopeMode === 'warehouse' \? null : \(locationId \|\| null\)/);
  assert.match(service, /scopeMode === 'warehouse' \? null : \(lotId \|\| null\)/);
  assert.match(route, /pathname\.endsWith\('\/history'\)/);
  assert.match(route, /scopeMode: url\.searchParams\.get\('scope'\) \|\| 'exact'/);
  assert.match(route, /parseInteger\(url\.searchParams\.get\('limit'\), 51, 1000\)/);
  assert.match(route, /parseInteger\(url\.searchParams\.get\('offset'\), 0, 100000\)/);
});
