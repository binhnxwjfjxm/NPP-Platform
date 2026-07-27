import test from 'node:test';
import assert from 'node:assert/strict';
import { withAuditOutboxTransaction } from '../src/audit-outbox.js';

function createFakeClient() {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(String(sql).trim());
      return { rows: [], rowCount: 1 };
    },
    async release() {},
  };
}

function createFakeAdapter(client) {
  return { connect: async () => client };
}

test('read-only replay commits without duplicate audit writes', async () => {
  const client = createFakeClient();
  const result = await withAuditOutboxTransaction({
    adapter: createFakeAdapter(client),
    mutate: async (trackedClient) => {
      await trackedClient.query('SELECT id FROM shared.document_number_allocations WHERE id = $1', ['allocation']);
      return { replayed: true, allocationId: 'allocation' };
    },
  });

  assert.equal(result.replayed, true);
  assert.equal(client.calls[0], 'BEGIN');
  assert.equal(client.calls.at(-1), 'COMMIT');
});

test('replay transaction rejects hidden business writes', async () => {
  const client = createFakeClient();
  await assert.rejects(
    withAuditOutboxTransaction({
      adapter: createFakeAdapter(client),
      mutate: async (trackedClient) => {
        await trackedClient.query('UPDATE shared.document_number_counters SET next_counter = next_counter + 1');
        return { replayed: true };
      },
    }),
    /replay_transaction_must_be_read_only/,
  );

  assert.equal(client.calls.at(-1), 'ROLLBACK');
});

test('CTE-backed writes are detected during replay', async () => {
  const client = createFakeClient();
  await assert.rejects(
    withAuditOutboxTransaction({
      adapter: createFakeAdapter(client),
      mutate: async (trackedClient) => {
        await trackedClient.query(`WITH current AS (SELECT 1)
          INSERT INTO shared.document_number_counters
            (installation_id, series_id, period_key, next_counter)
          VALUES ('i', '00000000-0000-4000-8000-000000000000', 'ALL', 1)`);
        return { replayed: true };
      },
    }),
    /replay_transaction_must_be_read_only/,
  );

  assert.equal(client.calls.at(-1), 'ROLLBACK');
});
