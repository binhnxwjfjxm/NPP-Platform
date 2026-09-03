import test from 'node:test';
import assert from 'node:assert/strict';
import { auditOutboxEffect } from '../src/audit-outbox-effects.js';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../src/audit-outbox.js';
import { salesOrderEntryInternals } from '../src/services/sales-order-entry.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

function requestContext() {
  return Object.freeze({
    installationId: 'installation-test',
    actorId: `user:${USER_ID}`,
    employeeId: null,
    sourceApp: 'internal-web',
    requestId: 'req-sales-entry-defaults-audit',
    scopes: Object.freeze({ branchIds: [], warehouseIds: [], territoryIds: [] }),
  });
}

function createTransactionClient() {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql: String(sql), values });
      return { rows: [], rowCount: 1 };
    },
    async release() {},
  };
}

function createPreferenceClient(storedPreference = null) {
  const effects = [];
  const calls = [];
  return {
    effects,
    calls,
    registerAuditOutboxEffect(effect) {
      effects.push(effect);
    },
    async query(sql, values = []) {
      const normalized = String(sql).trim().replace(/\s+/g, ' ').toLowerCase();
      calls.push({ sql: normalized, values });
      if (normalized.startsWith('select preference_value from shared.user_preferences')) {
        return {
          rows: storedPreference === null
            ? []
            : [{ preference_value: storedPreference }],
          rowCount: storedPreference === null ? 0 : 1,
        };
      }
      if (normalized.startsWith('insert into shared.user_preferences')) {
        return {
          rows: [{ preference_value: JSON.parse(values[3]) }],
          rowCount: 1,
        };
      }
      if (normalized.startsWith('delete from shared.user_preferences')) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith('insert into shared.core_audit_records')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected_sql:${normalized}`);
    },
  };
}

test('transaction guard accepts one registered nested audit plus the primary audit/outbox', async () => {
  const client = createTransactionClient();
  const context = requestContext();
  const result = await withAuditOutboxTransaction({
    adapter: { connect: async () => client },
    mutate: async (db) => {
      db.registerAuditOutboxEffect(auditOutboxEffect(1, 0));
      await insertAuditRecord(db, buildAuditRecord({
        requestContext: context,
        action: 'sales.order_entry_defaults.update',
        resourceType: 'user_preference',
        resourceId: USER_ID,
      }));
      await insertAuditRecord(db, buildAuditRecord({
        requestContext: context,
        action: 'create',
        resourceType: 'sales_order',
        resourceId: ORDER_ID,
      }));
      const event = buildOutboxEvent({
        requestContext: context,
        aggregateType: 'sales.sales_order',
        aggregateId: ORDER_ID,
        eventType: 'sales.sales_order.created',
        payload: { id: ORDER_ID },
      });
      await insertOutboxEvent(db, event);
      return { salesOrder: { id: ORDER_ID }, eventId: event.eventId };
    },
  });

  assert.equal(result.salesOrder.id, ORDER_ID);
  assert.equal(client.calls.filter((call) => call.sql === 'COMMIT').length, 1);
  assert.equal(client.calls.filter((call) => call.sql === 'ROLLBACK').length, 0);
});

test('saving changed Sales Order entry defaults registers exactly one nested audit effect', async () => {
  const client = createPreferenceClient();
  const result = await salesOrderEntryInternals.persistEntryDefaults(client, {
    requestContext: requestContext(),
    input: { warehouseId: null, deliveryChoice: 'MANUAL' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(client.effects, [auditOutboxEffect(1, 0)]);
  assert.equal(
    client.calls.filter((call) => call.sql.startsWith('insert into shared.core_audit_records')).length,
    1,
  );
});

test('unchanged Sales Order entry defaults do not register or write an extra audit', async () => {
  const client = createPreferenceClient({ warehouseId: null, deliveryChoice: 'MANUAL' });
  const result = await salesOrderEntryInternals.persistEntryDefaults(client, {
    requestContext: requestContext(),
    input: { warehouseId: null, deliveryChoice: 'MANUAL' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(client.effects, []);
  assert.equal(
    client.calls.filter((call) => call.sql.startsWith('insert into shared.core_audit_records')).length,
    0,
  );
});
