import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCustomerReceivableSummary,
  loadCustomerSalesSummary,
  normalizeCustomerProfilePeriod,
} from '../src/services/customer-profile.js';

const customerId = '11111111-1111-4111-8111-111111111111';
const warehouseId = '22222222-2222-4222-8222-222222222222';
const employeeId = '33333333-3333-4333-8333-333333333333';

function context(overrides = {}) {
  return {
    installationId: 'test-installation',
    actorId: 'user:test',
    employeeId,
    receivedAt: '2026-09-10T12:00:00.000Z',
    permissions: ['core.sales-order.read', 'core.sales-order.read-all'],
    scopes: { warehouseIds: [warehouseId], branchIds: [], territoryIds: [] },
    ...overrides,
  };
}

test('customer profile period only accepts the locked choices', () => {
  assert.equal(normalizeCustomerProfilePeriod(undefined), '90d');
  assert.equal(normalizeCustomerProfilePeriod('30D'), '30d');
  assert.equal(normalizeCustomerProfilePeriod('all'), 'all');
  assert.equal(normalizeCustomerProfilePeriod('7d'), null);
});

test('sales summary uses customer, warehouse, effective orders and latest confirmed version', async () => {
  let captured;
  const client = {
    async query(sql, params) {
      captured = { sql, params };
      return { rows: [{ revenue: '6215000.000000', order_count: '32', last_purchase_at: '2026-09-09T10:00:00.000Z' }] };
    },
  };
  const result = await loadCustomerSalesSummary(client, {
    requestContext: context(),
    customerId,
    period: '90d',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, {
    period: '90d',
    currencyCode: 'VND',
    revenue: '6215000.000000',
    orderCount: '32',
    lastPurchaseAt: '2026-09-09T10:00:00.000Z',
  });
  assert.match(captured.sql, /so\.customer_id = \$2::uuid/);
  assert.match(captured.sql, /so\.warehouse_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(captured.sql, /so\.status IN \('confirmed', 'closed'\)/);
  assert.match(captured.sql, /version\.version_status IN \('confirmed', 'superseded'\)/);
  assert.match(captured.sql, /sum\(current_version\.total\)/);
  assert.equal(captured.params[0], 'test-installation');
  assert.equal(captured.params[1], customerId);
  assert.deepEqual(captured.params[2], [warehouseId]);
  assert.equal(typeof captured.params[3], 'string');
});

test('sales summary keeps employee visibility when read-all is absent', async () => {
  let sql = '';
  let params = [];
  const client = {
    async query(nextSql, nextParams) {
      sql = nextSql;
      params = nextParams;
      return { rows: [{ revenue: '0', order_count: '0', last_purchase_at: null }] };
    },
  };
  const requestContext = context({ permissions: ['core.sales-order.read'] });
  const result = await loadCustomerSalesSummary(client, { requestContext, customerId, period: 'all' });
  assert.equal(result.ok, true);
  assert.match(sql, /so\.source_employee_id = \$5::uuid/);
  assert.match(sql, /creator_user\.employee_id = \$5::uuid/);
  assert.equal(params[4], employeeId);
  assert.equal(params[3], null);
});

test('receivable summary reads the canonical ledger and open documents for the customer scope', async () => {
  let sql = '';
  const client = {
    async query(nextSql, params) {
      sql = nextSql;
      assert.deepEqual(params, ['test-installation', customerId, [warehouseId]]);
      return { rows: [{ balance: '125000.000000', open_amount: '125000.000000', open_document_count: '2', updated_at: '2026-09-10T11:00:00.000Z' }] };
    },
  };
  const result = await loadCustomerReceivableSummary(client, { requestContext: context(), customerId });
  assert.equal(result.ok, true);
  assert.equal(result.summary.balance, '125000.000000');
  assert.equal(result.summary.openDocumentCount, '2');
  assert.match(sql, /accounting\.receivable_ledger_entries/);
  assert.match(sql, /accounting\.receivable_documents/);
  assert.match(sql, /document\.customer_id = \$2::uuid/);
  assert.match(sql, /document\.warehouse_id = ANY\(\$3::uuid\[\]\)/);
});

test('invalid customer or period is rejected before querying', async () => {
  let calls = 0;
  const client = { async query() { calls += 1; return { rows: [] }; } };
  const invalidCustomer = await loadCustomerSalesSummary(client, { requestContext: context(), customerId: 'bad', period: '90d' });
  assert.equal(invalidCustomer.ok, false);
  const invalidPeriod = await loadCustomerSalesSummary(client, { requestContext: context(), customerId, period: '7d' });
  assert.equal(invalidPeriod.ok, false);
  assert.equal(calls, 0);
});
