import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../src/', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Lô 4: Báo cáo tồn xuất server-side đầy đủ, giữ scope/quyền và không dùng LIMIT 100 preview', async () => {
  const [wrapper, route, service, baseService] = await Promise.all([
    read('routes/inventory.js'),
    read('routes/inventory-reporting-export.js'),
    read('services/reporting-inventory-export.js'),
    read('services/reporting-inventory-export-base.js'),
  ]);
  assert.match(wrapper, /inventory-reporting-export/);
  assert.match(route, /coreReportingInventoryRead/);
  assert.match(route, /coreReportingExport/);
  assert.match(route, /coreInventoryRead/);
  assert.match(route, /authorizeMovement/);
  assert.match(route, /WAREHOUSE_SCOPE_DENIED/);
  assert.match(service, /listWarehouseBusinessHoldSummary/);
  assert.match(service, /heldBaseQuantity/);
  assert.match(service, /availableBaseQuantity/);
  assert.match(baseService, /MAX_EXPORT_ROWS = 100_000/);
  assert.match(baseService, /MAX_EXPORT_ROWS \+ 1/);
  assert.match(baseService, /compactReportingQueryBindings/);
  assert.match(baseService, /overview/);
  assert.match(baseService, /positions/);
  assert.match(baseService, /movement/);
  assert.match(baseService, /slow-moving/);
  assert.match(baseService, /lots/);
  assert.match(baseService, /exceptions/);
  assert.doesNotMatch(baseService, /LIMIT 100`/);
  assert.match(baseService, /\^\[=\+@\]/);
});
