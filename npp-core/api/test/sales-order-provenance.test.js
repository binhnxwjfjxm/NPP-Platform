import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copySourceEmployeeSnapshotToDraft,
  getActiveSourceEmployee,
  loadSourceEmployeeFacts,
  setInitialSourceEmployeeSnapshot,
} from '../src/db/repositories/sales-order-provenance.js';

const INSTALLATION_ID = 'installation-a';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';

function clientWith(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      const response = responses.shift();
      if (!response) throw new Error('unexpected_query');
      return response;
    },
  };
}

test('MCP provenance validates active canonical employee before persistence', async () => {
  const client = clientWith([{ rows: [{ id: EMPLOYEE_ID }] }]);
  const employee = await getActiveSourceEmployee(client, {
    installationId: INSTALLATION_ID,
    employeeId: EMPLOYEE_ID,
  });
  assert.equal(employee.id, EMPLOYEE_ID);
  assert.match(client.calls[0].sql, /FROM shared\.employees/);
  assert.match(client.calls[0].sql, /is_active = true/);
  assert.deepEqual(client.calls[0].params, [INSTALLATION_ID, EMPLOYEE_ID]);
});

test('initial MCP provenance writes the order and version snapshot with the same employee', async () => {
  const client = clientWith([
    { rows: [{ id: ORDER_ID, source_employee_id: EMPLOYEE_ID }] },
    { rows: [{ id: 'version-1' }] },
  ]);
  const applied = await setInitialSourceEmployeeSnapshot(client, {
    installationId: INSTALLATION_ID,
    salesOrderId: ORDER_ID,
    versionNumber: 1,
    employeeId: EMPLOYEE_ID,
  });
  assert.equal(applied, true);
  assert.match(client.calls[0].sql, /UPDATE sales\.sales_orders/);
  assert.match(client.calls[0].sql, /source_type = 'MCP'/);
  assert.match(client.calls[1].sql, /UPDATE sales\.sales_order_versions/);
  assert.match(client.calls[1].sql, /version_number = \$4/);
  assert.deepEqual(client.calls[1].params, [EMPLOYEE_ID, INSTALLATION_ID, ORDER_ID, 1]);
});

test('amendment provenance copies the prior version snapshot instead of current actor context', async () => {
  const client = clientWith([{ rows: [{ id: 'version-2' }] }]);
  const copied = await copySourceEmployeeSnapshotToDraft(client, {
    installationId: INSTALLATION_ID,
    salesOrderId: ORDER_ID,
    fromVersionNumber: 1,
    toVersionNumber: 2,
  });
  assert.equal(copied, true);
  assert.match(client.calls[0].sql, /SET source_employee_id = source\.source_employee_id/);
  assert.match(client.calls[0].sql, /target\.source_id IS NOT DISTINCT FROM source\.source_id/);
  assert.match(client.calls[0].sql, /target\.source_outlet_id IS NOT DISTINCT FROM source\.source_outlet_id/);
  assert.deepEqual(client.calls[0].params, [INSTALLATION_ID, ORDER_ID, 1, 2]);
});

test('detail provenance reads order fact and every version snapshot', async () => {
  const client = clientWith([
    { rows: [{ source_employee_id: EMPLOYEE_ID }] },
    { rows: [
      { version_number: '1', source_employee_id: EMPLOYEE_ID },
      { version_number: '2', source_employee_id: EMPLOYEE_ID },
    ] },
  ]);
  const facts = await loadSourceEmployeeFacts(client, {
    installationId: INSTALLATION_ID,
    salesOrderId: ORDER_ID,
  });
  assert.equal(facts.order.source_employee_id, EMPLOYEE_ID);
  assert.equal(facts.versions.length, 2);
  assert.equal(facts.versions[1].source_employee_id, EMPLOYEE_ID);
});