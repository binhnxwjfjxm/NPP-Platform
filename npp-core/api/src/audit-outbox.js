export {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
} from './audit-outbox-core.js';

import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
} from './audit-outbox-core.js';

function createTrackedClient(client, writeState) {
  return Object.freeze({
    query: async (sql, values = []) => {
      const result = await client.query(sql, values);
      const normalizedSql = String(sql).trim().replace(/\s+/g, ' ').toLowerCase();
      if (normalizedSql.startsWith('insert into shared.core_audit_records')) writeState.auditCount += 1;
      if (normalizedSql.startsWith('insert into shared.core_outbox_events')) writeState.outboxCount += 1;
      return result;
    },
  });
}

export async function withAuditOutboxTransaction({ adapter, mutate }) {
  if (!adapter || typeof adapter.connect !== 'function') throw new Error('invalid_audit_outbox_adapter');
  if (typeof mutate !== 'function') throw new Error('invalid_mutation_callback');

  const client = await adapter.connect();
  const writeState = { auditCount: 0, outboxCount: 0 };
  const trackedClient = createTrackedClient(client, writeState);

  try {
    await client.query('BEGIN');
    const result = await mutate(trackedClient, {
      buildAuditRecord,
      buildOutboxEvent,
      insertAuditRecord,
      insertOutboxEvent,
    });

    if (result?.failed || (result?.skipAudit === true && result?.replayed !== true)) {
      await client.query('ROLLBACK');
      return result;
    }

    const replayWithoutWrites = result?.replayed === true
      && writeState.auditCount === 0
      && writeState.outboxCount === 0;

    if (!replayWithoutWrites) {
      if (writeState.auditCount !== 1) throw new Error('audit_record_required');
      const expectsOutbox = result?.eventId !== undefined && result?.eventId !== null;
      if (expectsOutbox && writeState.outboxCount !== 1) throw new Error('outbox_event_required');
      if (!expectsOutbox && writeState.outboxCount !== 0) throw new Error('unexpected_outbox_event');
    }

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (typeof client.release === 'function') await client.release();
  }
}
