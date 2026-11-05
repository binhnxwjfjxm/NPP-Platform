import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS } from '../src/access/permissions.js';
import { confirmManualInbound, readManualInboundConfirmationStatus, manualInboundConfirmationInternals } from '../src/services/manual-inbound-confirmation.js';

const installationId = '123e4567-e89b-42d3-a456-426614174000';
const warehouseId = '123e4567-e89b-42d3-a456-426614174001';
const context = { installationId, scopes: { warehouseIds: [warehouseId] }, permissions: [PERMISSIONS.coreInventoryManualInboundPost, PERMISSIONS.coreInventoryManualInboundPrepare] };
const key = 'manual-inbound-confirm.regression-1';

function fakePool(document = null) {
  const locks = new Map();
  const operations = [];
  let nextId = 0;
  const adapter = {
    async connect() {
      const id = ++nextId;
      let inTransaction = false;
      return {
        async query(sql, params = []) {
          operations.push({ sql, id });
          if (sql === 'BEGIN') { inTransaction = true; return { rows: [] }; }
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            for (const [scope, holder] of locks) if (holder === id) locks.delete(scope);
            inTransaction = false;
            return { rows: [] };
          }
          if (sql.includes('pg_try_advisory_xact_lock')) {
            assert.equal(inTransaction, true);
            const scope = params[0], acquired = !locks.has(scope) || locks.get(scope) === id;
            if (acquired) locks.set(scope, id);
            return { rows: [{ acquired }] };
          }
          if (sql.includes('pg_advisory_xact_lock')) {
            const scope = params[0];
            if (locks.has(scope) && locks.get(scope) !== id) throw new Error('would block');
            locks.set(scope, id);
            return { rows: [] };
          }
          if (sql.includes('FROM inventory.manual_inbound_documents'))
            return { rows: document ? [document] : [] };
          throw new Error('Unexpected SQL: ' + sql.slice(0, 80));
        },
        release() { assert.equal(inTransaction, false); },
      };
    },
  };
  return { adapter, locks, operations };
}

async function lockExternally(adapter) {
  const holder = await adapter.connect();
  await holder.query('BEGIN');
  await holder.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
    [manualInboundConfirmationInternals.confirmationScope(context, key)]);
  return holder;
}

test('A GET differentiates in-progress confirmation from an absent receipt', async () => {
  const { adapter, locks } = fakePool();
  const holder = await lockExternally(adapter);
  const busy = await readManualInboundConfirmationStatus({ adapter, requestContext: context, idempotencyKey: key });
  assert.equal(busy.processing, true);
  assert.equal(busy.posted, false);
  await holder.query('COMMIT');
  holder.release();
  assert.equal(locks.size, 0);
  const idle = await readManualInboundConfirmationStatus({ adapter, requestContext: context, idempotencyKey: key });
  assert.equal(idle.processing, false);
  assert.equal(idle.posted, false);
});

test('Same-key concurrent POST fails with retryable 409 before revalidation', async () => {
  const { adapter, operations } = fakePool();
  const holder = await lockExternally(adapter);
  const result = await confirmManualInbound({ adapter, requestContext: context, idempotencyKey: key, payload: { rows: [] } });
  assert.equal(result.code, 'MANUAL_INBOUND_CONFIRM_IN_PROGRESS');
  assert.equal(result.retryable, true);
  assert.equal(result.statusCode, 409);
  assert.equal(operations.some(op => op.sql.includes('FROM inventory.manual_inbound_documents')), false);
  await holder.query('COMMIT');
  holder.release();
});

test('Previously committed receipt is returned before stale preview, using only one DB connection', async () => {
  const document = { id: '123e4567-e89b-42d3-a456-426614174010', warehouse_id: warehouseId, document_number: 'NKT-00000004' };
  const { adapter, locks, operations } = fakePool(document);
  const result = await confirmManualInbound({ adapter, requestContext: context, idempotencyKey: key, payload: { rows: [] } });
  assert.equal(result.ok, true);
  assert.equal(result.replayed, true);
  assert.equal(result.document.id, document.id);
  assert.equal(operations.filter(op => op.sql === 'BEGIN').length, 1);
  assert.equal(locks.size, 0);
});

test('Definitive validation failure rolls back and lets status prove nothing was posted', async () => {
  const { adapter, locks, operations } = fakePool();
  const failed = await confirmManualInbound({ adapter, requestContext: context, idempotencyKey: key, payload: { warehouseId: 'invalid', rows: [] } });
  assert.equal(failed.ok, false);
  assert.equal(operations.some(op => op.sql === 'ROLLBACK'), true);
  assert.equal(locks.size, 0);
  const status = await readManualInboundConfirmationStatus({ adapter, requestContext: context, idempotencyKey: key });
  assert.equal(status.posted, false);
  assert.equal(status.processing, false);
});
