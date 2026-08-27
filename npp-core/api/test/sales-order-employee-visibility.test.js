import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, PERMISSION_REGISTRY } from '../src/access/permissions.js';
import { createBootstrapPrincipal } from '../src/request-context-base.js';
import { getSalesOrderById, listSalesOrders } from '../src/db/repositories/sales-order.js';

const installationId = 'test-installation';
const warehouseId = '11111111-1111-4111-8111-111111111111';
const employeeId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';

function clientWithRows(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows };
    },
  };
}

test('sales order read-all is a registered permission and bootstrap keeps installation-wide visibility', () => {
  assert.equal(PERMISSIONS.coreSalesOrderReadAll, 'core.sales-order.read-all');
  assert.equal(PERMISSION_REGISTRY.has(PERMISSIONS.coreSalesOrderReadAll), true);
  const principal = createBootstrapPrincipal({
    coreBootstrapActorId: 'system:test',
  });
  assert.equal(principal.permissions.includes(PERMISSIONS.coreSalesOrderReadAll), true);
});

test('ordinary employee list is constrained by warehouse and trusted employee identity', async () => {
  const client = clientWithRows([]);
  await listSalesOrders(client, {
    installationId,
    warehouseIds: [warehouseId],
    employeeId,
    allowAllEmployees: false,
    limit: 10,
    offset: 0,
  });
  const call = client.calls.at(-1);
  assert.match(call.sql, /so\.warehouse_id = ANY\(/);
  assert.match(call.sql, /so\.source_employee_id = \$\d+::uuid/);
  assert.match(call.sql, /FROM shared\.users creator_user/);
  assert.match(call.sql, /so\.created_by = 'user:' \|\| creator_user\.id::text/);
  assert.equal(call.params.includes(employeeId), true);
});

test('read-all removes only employee ownership filter and preserves warehouse scope', async () => {
  const client = clientWithRows([]);
  await getSalesOrderById(client, {
    installationId,
    id: orderId,
    warehouseIds: [warehouseId],
    employeeId,
    allowAllEmployees: true,
  });
  const call = client.calls.at(-1);
  assert.match(call.sql, /so\.warehouse_id = ANY\(/);
  assert.doesNotMatch(call.sql, /FROM shared\.users creator_user/);
  assert.doesNotMatch(call.sql, /so\.source_employee_id =/);
});

test('missing employee identity fails closed without read-all', async () => {
  const client = clientWithRows([]);
  await listSalesOrders(client, {
    installationId,
    warehouseIds: [warehouseId],
    employeeId: null,
    allowAllEmployees: false,
    limit: 10,
    offset: 0,
  });
  assert.match(client.calls.at(-1).sql, /AND false/);
});
