import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  withAuditOutboxTransaction,
} from '../src/audit-outbox.js';

const requestContext = Object.freeze({
  installationId: 'installation-one',
  actorId: 'actor-one',
  employeeId: null,
  sourceApp: 'npp-core-api',
  requestId: 'req_audit_outbox_invariant',
});

function createClient() {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql: String(sql).trim(), values });
      return { rows: [], rowCount: 1 };
    },
    async release() {},
  };
}

function adapterFor(client) {
  return { connect: async () => client };
}

test('builders reject incomplete domain identifiers and invalid versions', () => {
  assert.throws(
    () => buildAuditRecord({ requestContext, resourceType: 'order' }),
    /audit_action_required/,
  );
  assert.throws(
    () => buildOutboxEvent({
      requestContext,
      aggregateType: 'order',
      aggregateId: '',
      eventType: 'order.created',
      payload: {},
    }),
    /aggregate_id_required/,
  );
  assert.throws(
    () => buildOutboxEvent({
      requestContext,
      aggregateType: 'order',
      aggregateId: 'order-1',
      eventType: 'order.created',
      eventVersion: 0,
      payload: {},
    }),
    /invalid_event_version/,
  );
});

test('nested secret values are removed before persistence', () => {
  const audit = buildAuditRecord({
    requestContext,
    action: 'order.create',
    resourceType: 'order',
    afterData: { nested: { databaseUrl: 'private', value: 'safe' } },
  });
  const event = buildOutboxEvent({
    requestContext,
    aggregateType: 'order',
    aggregateId: 'order-1',
    eventType: 'order.created',
    payload: { credentials: [{ apiToken: 'private', label: 'safe' }] },
  });

  assert.equal(audit.afterData.nested.databaseUrl, null);
  assert.equal(audit.afterData.nested.value, 'safe');
  assert.equal(event.payload.credentials[0].apiToken, null);
  assert.equal(event.payload.credentials[0].label, 'safe');
  assert.equal(event.status, 'pending');
  assert.equal(event.attempts, 0);
  assert.equal(event.publishedAt, null);
});

test('transaction rolls back when mutation omits the mandatory audit record', async () => {
  const client = createClient();

  await assert.rejects(
    withAuditOutboxTransaction({
      adapter: adapterFor(client),
      mutate: async () => ({ result: 'changed' }),
    }),
    /audit_record_required/,
  );

  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!client.calls.some(({ sql }) => sql === 'COMMIT'));
});

test('transaction rolls back when an event is declared without an outbox insert', async () => {
  const client = createClient();

  await assert.rejects(
    withAuditOutboxTransaction({
      adapter: adapterFor(client),
      mutate: async (transactionClient, { buildAuditRecord, insertAuditRecord }) => {
        const audit = buildAuditRecord({
          requestContext,
          action: 'order.create',
          resourceType: 'order',
          resourceId: 'order-1',
        });
        await insertAuditRecord(transactionClient, audit);
        return { auditId: audit.auditId, eventId: randomUUID() };
      },
    }),
    /outbox_event_required/,
  );

  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!client.calls.some(({ sql }) => sql === 'COMMIT'));
});

test('transaction rejects duplicate audit writes', async () => {
  const client = createClient();

  await assert.rejects(
    withAuditOutboxTransaction({
      adapter: adapterFor(client),
      mutate: async (transactionClient, { buildAuditRecord, insertAuditRecord }) => {
        const first = buildAuditRecord({
          requestContext,
          action: 'order.create',
          resourceType: 'order',
          auditId: randomUUID(),
        });
        const second = buildAuditRecord({
          requestContext,
          action: 'order.create.duplicate',
          resourceType: 'order',
          auditId: randomUUID(),
        });
        await insertAuditRecord(transactionClient, first);
        await insertAuditRecord(transactionClient, second);
        return { auditId: first.auditId };
      },
    }),
    /audit_record_required/,
  );

  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});
