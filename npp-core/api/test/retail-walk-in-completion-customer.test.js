import assert from 'node:assert/strict';
import test from 'node:test';
import { directSalesCompletionInternals } from '../src/services/sales-manual-completion.js';

const pickupContract = directSalesCompletionInternals.directCompletionMode('PICKUP');
const requestContext = Object.freeze({ installationId: 'installation-test', actorId: 'employee-test' });

function walkInSettingsClient() {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes('pg_advisory_xact_lock')) return { rows: [] };
      if (String(sql).includes('FROM shared.sales_order_settings settings')) {
        return { rows: [{
          installation_id: 'installation-test',
          walk_in_customer_id: '11111111-1111-4111-8111-111111111111',
          default_tax_mode: 'EXCLUSIVE',
          default_tax_rate: '0',
          customer_id: '11111111-1111-4111-8111-111111111111',
          customer_code: 'WALKIN',
          customer_name: 'Khách vãng lai',
          customer_group_id: null,
          payment_terms_days: 0,
          credit_limit: '0',
          customer_is_active: true,
        }] };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };
}

test('WALK_IN source without customer id resolves the configured installation customer before receivable posting', async () => {
  const client = walkInSettingsClient();
  const source = Object.freeze({
    customer_id: null,
    customer_mode_snapshot: 'WALK_IN',
    customer_address_id: null,
    customer_code_snapshot: '',
    customer_name_snapshot: 'Khách tại quầy',
  });

  const result = await directSalesCompletionInternals.resolveAccountingSource(client, {
    requestContext,
    source,
    contract: pickupContract,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source.customer_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(result.source.customer_code_snapshot, 'WALKIN');
  assert.equal(result.source.customer_name_snapshot, 'Khách tại quầy');
  assert.equal(result.source.customer_address_id, null);
  assert.equal(client.calls.some((sql) => sql.includes('shared.sales_order_settings')), true);
});

test('EXISTING source keeps its customer identity and does not query walk-in settings', async () => {
  const client = { calls: [], async query(sql) { this.calls.push(String(sql)); throw new Error('query not expected'); } };
  const source = Object.freeze({
    customer_id: '22222222-2222-4222-8222-222222222222',
    customer_mode_snapshot: 'EXISTING',
    customer_code_snapshot: 'KH001',
    customer_name_snapshot: 'Khách hàng 001',
  });

  const result = await directSalesCompletionInternals.resolveAccountingSource(client, {
    requestContext,
    source,
    contract: pickupContract,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, source);
  assert.equal(client.calls.length, 0);
});

test('non walk-in source without a customer fails before touching accounting tables', async () => {
  const client = { async query() { throw new Error('query not expected'); } };
  const result = await directSalesCompletionInternals.resolveAccountingSource(client, {
    requestContext,
    source: { customer_id: null, customer_mode_snapshot: 'EXISTING' },
    contract: pickupContract,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'PICKUP_ORDER_CUSTOMER_REQUIRED');
  assert.match(result.message, /khách hàng/i);
});
