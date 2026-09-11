import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getCustomerDeliveryAttemptFacts,
  getCustomerDeliveryOrders,
  getCustomerReturns,
} from '../src/db/repositories/customer-profile-delivery-returns.js';
import { normalizeCustomerDeliveryReturnsQuery } from '../src/services/customer-profile-delivery-returns.js';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

const installationId = 'test-installation';
const customerId = '11111111-1111-4111-8111-111111111111';
const warehouseId = '22222222-2222-4222-8222-222222222222';
const deliveryOrderId = '33333333-3333-4333-8333-333333333333';

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

test('lịch sử giao khóa đúng customerId, kho và phân trang nhỏ', async () => {
  const client = clientWithRows([]);
  await getCustomerDeliveryOrders(client, {
    installationId,
    customerId,
    warehouseIds: [warehouseId],
    limit: 21,
    offset: 40,
  });
  const call = client.calls.at(-1);
  assert.match(call.sql, /delivery_order\.customer_id = \$2::uuid/);
  assert.match(call.sql, /delivery_order\.warehouse_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(call.sql, /LIMIT \$4::integer OFFSET \$5::integer/);
  assert.equal(call.params[1], customerId);
  assert.deepEqual(call.params[2], [warehouseId]);
  assert.equal(call.params[3], 21);
  assert.equal(call.params[4], 40);
});

test('kết quả lần giao được gom một batch theo deliveryOrderIds, không N+1', async () => {
  const client = clientWithRows([]);
  await getCustomerDeliveryAttemptFacts(client, {
    installationId,
    deliveryOrderIds: [deliveryOrderId],
  });
  assert.equal(client.calls.length, 1);
  const call = client.calls[0];
  assert.match(call.sql, /attempt\.delivery_order_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(call.sql, /delivered_partial/);
  assert.match(call.sql, /failed/);
  assert.match(call.sql, /rescheduled/);
  assert.deepEqual(call.params[1], [deliveryOrderId]);
});

test('hàng khách trả khóa đúng customerId và kho, không kéo toàn bộ lịch sử', async () => {
  const client = clientWithRows([]);
  await getCustomerReturns(client, {
    installationId,
    customerId,
    warehouseIds: [warehouseId],
    limit: 21,
    offset: 0,
  });
  const call = client.calls.at(-1);
  assert.match(call.sql, /customer_return\.customer_id = \$2::uuid/);
  assert.match(call.sql, /customer_return\.warehouse_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(call.sql, /customer_return_receipt_lines/);
  assert.equal(call.params[3], 21);
});

test('query Lô 4 chặn limit và offset bất thường', () => {
  assert.equal(normalizeCustomerDeliveryReturnsQuery({ deliveryLimit: '51' }).ok, false);
  assert.equal(normalizeCustomerDeliveryReturnsQuery({ returnLimit: '0' }).ok, false);
  assert.equal(normalizeCustomerDeliveryReturnsQuery({ deliveryOffset: '-1' }).ok, false);
  assert.equal(normalizeCustomerDeliveryReturnsQuery({ returnOffset: '1000001' }).ok, false);
  assert.deepEqual(
    normalizeCustomerDeliveryReturnsQuery({ deliveryLimit: '20', deliveryOffset: '40', returnLimit: '10', returnOffset: '20' }),
    {
      ok: true,
      query: {
        deliveryLimit: 20,
        deliveryOffset: 40,
        returnLimit: 10,
        returnOffset: 20,
      },
    },
  );
});

test('route Lô 4 giữ quyền chứng từ giao, kết quả giao, chuyến giao và hàng trả độc lập', () => {
  const route = readFileSync(new URL('../src/routes/customer-profile.js', import.meta.url), 'utf8');
  assert.match(route, /delivery-returns/);
  assert.match(route, /coreDeliveryOrderRead/);
  assert.match(route, /coreDeliveryAttemptRead/);
  assert.match(route, /coreDeliveryTripRead/);
  assert.match(route, /coreCustomerReturnRead/);
  assert.match(route, /deliveryAttempts: canReadDeliveryOrders && canReadDeliveryAttempts/);
});

test('migration 134 chỉ bổ sung index lịch sử theo khách', () => {
  const migration = CORE_API_MIGRATIONS.find(({ id }) => id === '134_customer_profile_delivery_return_indexes');
  assert.ok(migration);
  assert.match(migration.sql, /delivery_orders_customer_history_idx/);
  assert.match(migration.sql, /customer_returns_customer_history_idx/);
  assert.match(migration.sql, /customer_id/);
  assert.doesNotMatch(migration.sql, /CREATE TABLE/);
  assert.doesNotMatch(migration.sql, /ALTER TABLE/);
});
