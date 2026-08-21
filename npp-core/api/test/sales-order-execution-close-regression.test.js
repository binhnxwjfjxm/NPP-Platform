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
  const [salesOrderService, releaseService, releaseRepository] = await Promise.all([
    read('src/services/sales-order.js'),
    read('src/services/sales-fulfillment-allocation-release.js'),
    read('src/db/repositories/sales-fulfillment-allocation-release.js'),
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
  assert.match(releaseRepository, /setExecutionCloseReleaseWriteContexts/);
  assert.match(releaseRepository, /npp\.sales_execution_close_release/);
  assert.match(releaseService, /intentName === 'execution-close'/);
  assert.match(releaseService, /allocation\.state === 'ACTIVE'/);
  assert.match(releaseService, /allocation\.state === 'COMPLETED'/);
  assert.match(releaseService, /claimed > consumed/);
  assert.match(releaseService, /reservationOnly: true/);
});

test('execution close may release post-issue remainder without weakening ordinary edit release', async () => {
  const migration = await read('../../database/migrations/sales/104_sales_order_execution_close_partial_release.sql');

  assert.match(migration, /execution_close_release boolean/);
  assert.match(migration, /demand_issued <> 0 AND NOT execution_close_release/);
  assert.match(migration, /sales_fulfillment_release_locked_after_issue/);
  assert.match(migration, /reservation\.state NOT IN \('CONSUMED', 'RELEASED'\)/);
});

test('partial reservation release subtracts only the still-reserved quantity', async () => {
  const migration = await read('../../database/migrations/sales/104_sales_order_execution_close_partial_release.sql');

  assert.match(
    migration,
    /remaining_reserved := reservation_record\.quantity\s+- COALESCE\(reservation_record\.consumed_quantity, 0\)/,
  );
  assert.match(migration, /reserved_quantity = reserved_quantity - remaining_reserved/);
  assert.doesNotMatch(
    migration,
    /reserved_quantity = reserved_quantity - reservation_record\.quantity/,
  );
});

test('a closed trip remains fail-closed when vehicle stock is not reconciled', async () => {
  const reconciliationMigration = await read('../../database/migrations/logistics/051_logistics_trip_reconciliation.sql');

  assert.match(reconciliationMigration, /logistics_trip_close_unreconciled_stock/);
  assert.match(reconciliationMigration, /unreconciled_lines > 0/);
});

test('execution close fulfillment migrations are registered', async () => {
  const migrations = await read('src/migrations/index.js');

  assert.match(migrations, /103_sales_order_execution_close_fulfillment\.sql/);
  assert.match(migrations, /id: '103_sales_order_execution_close_fulfillment'/);
  assert.match(migrations, /104_sales_order_execution_close_partial_release\.sql/);
  assert.match(migrations, /id: '104_sales_order_execution_close_partial_release'/);
});
