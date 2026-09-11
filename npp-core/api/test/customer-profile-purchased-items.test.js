import test from 'node:test';
import assert from 'node:assert/strict';
import { getCustomerPurchasedItems } from '../src/db/repositories/customer-profile.js';
import { normalizeCustomerPurchasedItemsQuery } from '../src/services/customer-profile.js';

const installationId = 'test-installation';
const customerId = '11111111-1111-4111-8111-111111111111';
const warehouseId = '22222222-2222-4222-8222-222222222222';
const employeeId = '33333333-3333-4333-8333-333333333333';

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

test('Hàng đã mua khóa query theo đúng customerId, kho và current version để chống lẫn khách', async () => {
  const client = clientWithRows([]);
  await getCustomerPurchasedItems(client, {
    installationId,
    customerId,
    warehouseIds: [warehouseId],
    allowAllEmployees: true,
    sinceInstant: '2026-06-01T00:00:00.000Z',
    search: 'tra',
    limit: 50,
    offset: 0,
  });

  const call = client.calls.at(-1);
  assert.match(call.sql, /so\.customer_id = \$2::uuid/);
  assert.match(call.sql, /so\.warehouse_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(call.sql, /version\.version_number = so\.current_version_number/);
  assert.match(call.sql, /version\.version_status = 'confirmed'/);
  assert.match(call.sql, /so\.status IN \('confirmed', 'closed'\)/);
  assert.match(call.sql, /row_number\(\) OVER/);
  assert.match(call.sql, /count\(\*\) OVER\(\)::text AS total_count/);
  assert.equal(call.params[0], installationId);
  assert.equal(call.params[1], customerId);
  assert.deepEqual(call.params[2], [warehouseId]);
  assert.equal(call.params[4], 'tra');
});

test('Số lần mua đếm theo số đơn, không đếm số dòng khi một SKU bị tách nhiều dòng', async () => {
  const client = clientWithRows([]);
  await getCustomerPurchasedItems(client, {
    installationId,
    customerId,
    warehouseIds: [warehouseId],
    allowAllEmployees: true,
    limit: 50,
    offset: 0,
  });

  const call = client.calls.at(-1);
  assert.match(call.sql, /count\(DISTINCT sales_order_id\)::text AS purchase_count/);
  assert.match(call.sql, /sum\(ordered_quantity\)::numeric\(20,6\)::text AS total_quantity/);
  assert.match(call.sql, /sum\(line_total\)::numeric\(20,6\)::text AS revenue/);
});

test('Hàng đã mua giữ scope nhân viên như danh sách đơn bán', async () => {
  const client = clientWithRows([]);
  await getCustomerPurchasedItems(client, {
    installationId,
    customerId,
    warehouseIds: [warehouseId],
    employeeId,
    allowAllEmployees: false,
    limit: 25,
    offset: 0,
  });

  const call = client.calls.at(-1);
  assert.match(call.sql, /so\.source_employee_id = \$\d+::uuid/);
  assert.match(call.sql, /FROM shared\.users creator_user/);
  assert.equal(call.params.includes(employeeId), true);
});

test('Hàng đã mua chặn limit, offset và tìm kiếm bất thường trước khi query DB', () => {
  assert.equal(normalizeCustomerPurchasedItemsQuery({ period: '90d', limit: '101' }).ok, false);
  assert.equal(normalizeCustomerPurchasedItemsQuery({ period: '90d', offset: '-1' }).ok, false);
  assert.equal(normalizeCustomerPurchasedItemsQuery({ period: '90d', search: 'x'.repeat(121) }).ok, false);
  assert.deepEqual(
    normalizeCustomerPurchasedItemsQuery({ period: '30d', search: '  SKU-01  ', limit: '25', offset: '50' }),
    {
      ok: true,
      query: {
        period: '30d',
        search: 'SKU-01',
        limit: 25,
        offset: 50,
      },
    },
  );
});
