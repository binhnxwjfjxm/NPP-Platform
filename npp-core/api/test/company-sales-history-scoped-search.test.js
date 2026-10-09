import test from 'node:test';
import assert from 'node:assert/strict';
import { listSalesOrders, summarizeSalesOrders } from '../src/db/repositories/sales-order.js';

const scope = {
  installationId: 'install-test',
  warehouseIds: ['11111111-1111-4111-8111-111111111111'],
  employeeId: '22222222-2222-4222-8222-222222222222',
  actorId: 'user:test',
  allowAllEmployees: false,
};

test('searches full history by customer words while retaining employee and warehouse scope', async () => {
  const queries = [];
  const client = { async query(sql, params) { queries.push({ sql, params }); return { rows: [{ total: 2, active: 1 }] }; } };
  await listSalesOrders(client, { ...scope, search: '1992 Tân Phước', source: 'mcp', lane: 'manual', stage: 'active', limit: 50, offset: 0 });
  await summarizeSalesOrders(client, { ...scope, search: '1992 Tân Phước', source: 'mcp', lane: 'manual' });
  assert.equal(queries.length, 2);
  for (const { sql, params } of queries) {
    assert.match(sql, /sales\.sales_orders/);
    assert.match(sql, /so\.warehouse_id = ANY/);
    assert.match(sql, /so\.source_employee_id/);
    assert.match(sql, /so\.source_type = 'MCP'/);
    assert.match(sql, /delivery_execution_mode = 'MANUAL'/);
    assert.match(sql, /c\.code ILIKE/);
    assert.match(sql, /c\.name ILIKE/);
    assert.ok(params.includes('%1992%'));
    assert.ok(params.includes('%Tân%'));
    assert.ok(params.includes('%Phước%'));
  }
  assert.match(queries[0].sql, /ORDER BY created_at DESC,id DESC LIMIT/);
  assert.match(queries[1].sql, /count\(\*\) FILTER \(WHERE work_stage='completed'\)/);
});

test('searches SO000071 across all years and paginates without updated-date reorder', async () => {
  const queries = [];
  const client = { async query(sql, params) { queries.push({ sql, params }); return { rows: [] }; } };
  await listSalesOrders(client, { ...scope, search: 'SO000071', limit: 50, offset: 150000 });
  const [{ sql, params }] = queries;
  assert.match(sql, /right\(coalesce\(so\.order_number, ''\), 6\)/);
  assert.ok(params.includes('000071'));
  assert.ok(params.includes('%SO000071%'));
  assert.ok(params.includes(150000));
  assert.doesNotMatch(sql, /updated_at DESC/);
});
