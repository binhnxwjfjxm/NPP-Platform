import test from 'node:test';
import assert from 'node:assert/strict';
import { withTransactionLocalSetting } from '../src/db/transaction-local-setting.js';

test('transaction-local setting được khôi phục sau thao tác thành công', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('current_setting')) return { rows: [{ value: 'previous' }] };
      return { rows: [] };
    },
  };

  const result = await withTransactionLocalSetting(
    client,
    'npp.inventory_negative_stock_context',
    'temporary',
    async () => {
      calls.push({ sql: 'OPERATION', params: [] });
      return 'done';
    },
  );

  assert.equal(result, 'done');
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1].params, ['npp.inventory_negative_stock_context', 'temporary']);
  assert.equal(calls[2].sql, 'OPERATION');
  assert.deepEqual(calls[3].params, ['npp.inventory_negative_stock_context', 'previous']);
});

test('lỗi SQL đầu tiên được giữ nguyên và không bị query khôi phục che thành 25P02', async () => {
  const original = Object.assign(new Error('inventory_negative_stock_denied'), {
    code: 'P0001',
    constraint: 'original_constraint',
  });
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('current_setting')) return { rows: [{ value: 'previous' }] };
      return { rows: [] };
    },
  };

  await assert.rejects(
    withTransactionLocalSetting(
      client,
      'npp.sales_fulfillment_write_context',
      'fulfillment_hold_service',
      async () => {
        calls.push({ sql: 'FAILING_OPERATION', params: [] });
        throw original;
      },
    ),
    (error) => error === original,
  );

  assert.equal(calls.length, 3);
  assert.equal(calls[2].sql, 'FAILING_OPERATION');
  assert.equal(calls.slice(3).some((call) => call.sql.includes('set_config')), false);
});
