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

test('phân trang và lọc quyền trước khi tải thông tin giao hàng/thu tiền chi tiết', async () => {
  let sql = ''; let params = [];
  const client = {async query(query, values) {sql = query; params = values; return {rows: []};}};
  await listSalesOrders(client, {...scope, search: '1992 Tân Phước', source: 'internal', lane: 'manual', stage: 'completed', limit: 50, offset: 100});
  assert.match(sql, /WITH matching_orders AS \(SELECT so\.id, so\.installation_id, so\.created_at,/);
  assert.match(sql, /selected_page AS \(\s*SELECT id, installation_id, created_at FROM staged_orders WHERE work_stage =/);
  assert.match(sql, /ORDER BY created_at DESC,id DESC LIMIT \$\d+ OFFSET \$\d+/);
  assert.match(sql, /SELECT so\.id, so\.installation_id, so\.order_number/);
  assert.match(sql, /JOIN sales\.sales_orders so\s+ON so\.installation_id = selected_page\.installation_id AND so\.id = selected_page\.id/);
  assert.match(sql, /so\.warehouse_id = ANY/);
  assert.match(sql, /so\.source_employee_id/);
  assert.ok(params.includes('%1992%'));
  assert.ok(params.includes('%Tân%'));
  assert.ok(params.includes('%Phước%'));
  assert.equal(params.at(-2), 50);
  assert.equal(params.at(-1), 100);
});

test('tháng Việt Nam và đơn tồn đọng được lọc tại SQL sau giới hạn quyền', async () => {
  const calls = [];
  const client = { async query(query, values) { calls.push({query, values}); return {rows: []}; } };
  const dateFrom = '2026-09-30T17:00:00.000Z';
  const dateTo = '2026-10-31T17:00:00.000Z';
  await listSalesOrders(client, { ...scope, scope: 'month', dateFrom, dateTo, limit: 1000, offset: 1000 });
  assert.match(calls[0].query, /so\.created_at >= \$\d+::timestamptz AND so\.created_at < \$\d+::timestamptz/);
  assert.match(calls[0].query, /so\.warehouse_id = ANY/);
  assert.match(calls[0].query, /so\.source_employee_id/);
  assert.ok(calls[0].values.includes(dateFrom));
  assert.ok(calls[0].values.includes(dateTo));
  assert.deepEqual(calls[0].values.slice(-2), [1000, 1000]);

  await listSalesOrders(client, { ...scope, scope: 'pending', beforeDate: dateFrom, limit: 1000 });
  assert.match(calls[1].query, /work_stage NOT IN \('completed','cancelled'\)/);
  assert.match(calls[1].query, /so\.created_at < \$\d+::timestamptz/);
  assert.ok(calls[1].values.includes(dateFrom));

  await listSalesOrders(client, { ...scope, scope: 'month', dateFrom, dateTo, compact: true, limit: 1000 });
  assert.match(calls[2].query, /SELECT so\.id, so\.order_number, so\.status, so\.source_type/);
  assert.match(calls[2].query, /current_version\.total AS total/);
  assert.doesNotMatch(calls[2].query, /accounting\.receivable_documents/);
  assert.match(calls[2].query, /FROM sales\.delivery_orders/);

  const cursorId = '33333333-3333-4333-8333-333333333333';
  await listSalesOrders(client, {...scope, scope:'month', dateFrom, dateTo, compact:true, cursorId, limit:1000});
  assert.match(calls[3].query, /page_cursor\.id = \$\d+::uuid/);
  assert.match(calls[3].query, /\(so\.created_at, so\.id\) < \(page_cursor\.created_at, page_cursor\.id\)/);
  assert.ok(calls[3].values.includes(cursorId));
});

test('đếm toàn bộ đơn hợp quyền, không thực hiện truy vấn chi tiết từng đơn', async () => {
  let sql = '';
  const client = {async query(query) {
    sql = query;
    return {rows: [{total: 1746, active: 25, preparing: 10, waiting_delivery: 11, completed: 1700, cancelled: 0}]};
  }};
  const summary = await summarizeSalesOrders(client, {...scope, search: '', source: 'all', lane: 'all'});
  assert.equal(summary.total, 1746);
  assert.match(sql, /count\(\*\)::int AS total/);
  assert.match(sql, /count\(\*\) FILTER \(WHERE work_stage='completed'\)/);
  assert.doesNotMatch(sql, /FROM sales\.delivery_orders/);
  assert.doesNotMatch(sql, /accounting\.receivable_documents/);
  assert.doesNotMatch(sql, /ORDER BY created_at DESC,id DESC LIMIT/);
  assert.match(sql, /so\.warehouse_id = ANY/);
  assert.match(sql, /so\.source_employee_id/);
});

test('khoảng ngày tùy chọn lọc tại SQL trước phân trang, giữ quyền nhân viên và kho', async () => {
  let sql = '';
  let values = [];
  const client = { async query(query, params) { sql = query; values = params; return { rows: [] }; } };
  const dateFrom = '2026-09-30T17:00:00.000Z';
  const dateTo = '2026-10-09T17:00:00.000Z';
  await listSalesOrders(client, {...scope, scope: 'range', dateFrom, dateTo, compact: true, limit: 1000 });
  assert.match(sql, /so\.created_at >= \$\d+::timestamptz AND so\.created_at < \$\d+::timestamptz/);
  assert.match(sql, /so\.warehouse_id = ANY/);
  assert.match(sql, /so\.source_employee_id/);
  assert.ok(values.includes(dateFrom));
  assert.ok(values.includes(dateTo));
});
