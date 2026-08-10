import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveOpeningBalanceOperatorPayload } from '../src/routes/opening-balance-operator.js';

test('opening balance operator boundary loads and rejects an invalid payload before database work', async () => {
  const result = await resolveOpeningBalanceOperatorPayload(
    { query: async () => { throw new Error('database must not be touched'); } },
    { installationId: 'test', scopes: { warehouseIds: [] }, roles: [] },
    null,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_INPUT');
});

test('opening balance operator boundary resolves business SKU/location input before calling legacy UUID service', async () => {
  const source = await readFile(new URL('../src/routes/opening-balance-operator.js', import.meta.url), 'utf8');
  assert.match(source, /upper\(pv\.sku\) = ANY\(\$2::text\[\]\)/);
  assert.match(source, /upper\(code\) = ANY\(\$3::text\[\]\)/);
  assert.match(source, /selectedWarehouseCode/);
  assert.match(source, /sourceVariantId: variant\.id/);
  assert.match(source, /locationId: location\?\.id \?\? null/);
  assert.match(source, /validateOpeningBalanceImport/);
  assert.match(source, /postOpeningBalanceImport/);
});

test('opening balance preview preserves source-row identity and service errors keep HTTP semantics', async () => {
  const source = await readFile(new URL('../src/routes/opening-balance-operator.js', import.meta.url), 'utf8');
  assert.match(source, /INVALID_LOCATION_CODE[\s\S]*displayRows\.push/);
  assert.match(source, /new Map\(serviceRows\.map\(\(row\) => \[Number\(row\.lineNumber\), row\]\)\)/);
  assert.match(source, /PERMISSION_DENIED[^\n]*return 403/);
  assert.match(source, /result\?\.retryable[^\n]*return 503/);
});
