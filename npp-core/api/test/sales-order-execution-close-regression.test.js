import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('execution close keeps completed fulfillment history and blocks unresolved stock', async () => {
  const migration = await read('../../database/migrations/sales/103_sales_order_execution_close_fulfillment.sql');

  assert.match(migration, /NEW\.state = 'CANCELLED'/);
  assert.match(migration, /allocation\.state = 'ACTIVE'/);
  assert.match(migration, /allocation\.state = 'COMPLETED'/);
  assert.match(migration, /reservation\.state IS DISTINCT FROM 'CONSUMED'/);
  assert.match(migration, /allocation\.state <> 'RELEASED'/);
  assert.match(migration, /sales_fulfillment_transition_blocked_by_allocation/);
});

test('execution close releases only the unexecuted remainder before terminalizing demand', async () => {
  const [salesOrderService, releaseService] = await Promise.all([
    read('src/services/sales-order.js'),
    read('src/services/sales-fulfillment-allocation-release.js'),
  ]);

  const closeStart = salesOrderService.indexOf('export async function closeSalesOrderAfterExecution');
  const closeFlow = salesOrderService.slice(closeStart);
  const releasePosition = closeFlow.indexOf('releaseUnexecutedAllocations');
  const closeOrderPosition = closeFlow.indexOf('salesOrderRepository.closeSalesOrderAfterExecution');
  const cancelDemandPosition = closeFlow.indexOf('cancelSalesOrderFulfillmentDemand');

  assert.ok(closeStart >= 0);
  assert.ok(releasePosition >= 0);
  assert.ok(closeOrderPosition > releasePosition);
  assert.ok(cancelDemandPosition > closeOrderPosition);
  assert.match(releaseService, /allocations\.filter\(\(allocation\) => allocation\.state === 'ACTIVE'\)/);
  assert.doesNotMatch(releaseService, /allocation\.state === 'COMPLETED'[\s\S]{0,200}releaseAllocation/);
});

test('a closed trip remains fail-closed when vehicle stock is not reconciled', async () => {
  const reconciliationMigration = await read('../../database/migrations/logistics/051_logistics_trip_reconciliation.sql');

  assert.match(reconciliationMigration, /logistics_trip_close_unreconciled_stock/);
  assert.match(reconciliationMigration, /unreconciled_lines > 0/);
});

test('execution close fulfillment migration is registered', async () => {
  const migrations = await read('src/migrations/index.js');

  assert.match(migrations, /103_sales_order_execution_close_fulfillment\.sql/);
  assert.match(migrations, /id: '103_sales_order_execution_close_fulfillment'/);
});
