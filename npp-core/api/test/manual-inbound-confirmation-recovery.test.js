import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS } from '../src/access/permissions.js';
import {
  manualInboundConfirmationInternals,
  confirmManualInbound,
  readManualInboundConfirmationStatus,
} from '../src/services/manual-inbound-confirmation.js';

const installationId = '123e4567-e89b-42d3-a456-426614174000';
const warehouseId = '123e4567-e89b-42d3-a456-426614174001';
const context = {
  installationId,
  scopes: { warehouseIds: [warehouseId] },
  permissions: [PERMISSIONS.coreInventoryManualInboundPost],
};
const key = 'manual-inbound-confirm.regression-1';

function fakeAdapter(document = null) {
  const held = new Set();
  const operations = [];
  const adapter = {
    async connect() {
      return {
        async query(sql, params) {
          operations.push({ sql, params });
          const lockKey = params?.[0];
          if (sql.includes('pg_try_advisory_lock')) {
            const acquired = !held.has(lockKey);
            if (acquired) held.add(lockKey);
            return { rows: [{ acquired }] };
          }
          if (sql.includes('pg_advisory_unlock')) {
            const released = held.delete(lockKey);
            return { rows: [{ released }] };
          }
          if (sql.includes('FROM inventory.manual_inbound_documents')) {
            return { rows: document ? [document] : [] };
          }
          throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
        },
        release(error) {
          if (error) throw error;
        },
      };
    },
  };
  return { adapter, held, operations };
}

test('Same-key status reports processing during preflight and no longer reports it after release', async () => {
  const { adapter, held } = fakeAdapter();
  let finish;
  const incomplete = new Promise((resolve) => { finish = resolve; });
  const posting = manualInboundConfirmationInternals.withConfirmationGuard(
    adapter, context, key, async () => incomplete,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const during = await readManualInboundConfirmationStatus({ adapter, requestContext: context, idempotencyKey: key });
  assert.deepEqual({ ok: during.ok, processing: during.processing, posted: during.posted },
    { ok: true, processing: true, posted: false });
  finish({ ok: true });
  await posting;
  assert.equal(held.size, 0);
  const after = await readManualInboundConfirmationStatus({ adapter, requestContext: context, idempotencyKey: key });
  assert.equal(after.ok, true);
  assert.equal(after.processing, false);
  assert.equal(after.posted, false);
});

test('Same-key retries cannot run while confirmation is in progress', async () => {
  const { adapter } = fakeAdapter();
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const first = manualInboundConfirmationInternals.withConfirmationGuard(adapter, context, key, () => pending);
  await new Promise((resolve) => setImmediate(resolve));
  const second = await manualInboundConfirmationInternals.withConfirmationGuard(adapter, context, key, () => {
    throw new Error('concurrent operation must not run');
  });
  assert.equal(second.ok, false);
  assert.equal(second.statusCode, 409);
  assert.equal(second.code, 'MANUAL_INBOUND_CONFIRM_IN_PROGRESS');
  finish({ ok: true });
  await first;
});

test('A committed same-key confirmation is replayed before preview, even if data changed', async () => {
  const saved = {
    id: '123e4567-e89b-42d3-a456-426614174010',
    warehouse_id: warehouseId,
    document_number: 'NKT-00000004',
  };
  const { adapter } = fakeAdapter(saved);
  const response = await confirmManualInbound({
    adapter,
    requestContext: context,
    idempotencyKey: key,
    payload: { rows: [] },
  });
  assert.equal(response.ok, true);
  assert.equal(response.replayed, true);
  assert.equal(response.document.id, saved.id);
  assert.equal(response.document.documentNumber, saved.document_number);
});

test('A thrown operation releases the guard for the next status request', async () => {
  const { adapter, held } = fakeAdapter();
  await assert.rejects(
    manualInboundConfirmationInternals.withConfirmationGuard(adapter, context, key, () => {
      throw new Error('preflight-failed');
    }),
    /preflight-failed/,
  );
  assert.equal(held.size, 0);
  const status = await readManualInboundConfirmationStatus({ adapter, requestContext: context, idempotencyKey: key });
  assert.equal(status.processing, false);
});
