import { randomUUID } from 'node:crypto';

const SECRET_KEY_PATTERN = /(?:secret|token|password|passphrase|db_?url|database_?url|connection_?string|api_?key|auth_?token|private_?key)/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function shouldRedactKey(key) {
  return typeof key === 'string' && SECRET_KEY_PATTERN.test(key);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeJsonValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      shouldRedactKey(key) ? null : sanitizeJsonValue(child),
    ]),
  );
}

function requireString(value, errorCode) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(errorCode);
  return value.trim();
}

function validateRequestContext(requestContext) {
  if (!requestContext) throw new Error('missing_request_context');
  requireString(requestContext.installationId, 'missing_installation_id');
  requireString(requestContext.actorId, 'missing_actor_id');
  requireString(requestContext.sourceApp, 'missing_source_app');
  requireString(requestContext.requestId, 'missing_request_id');
}

function validateUuid(value, errorCode) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(errorCode);
  return value;
}

export function buildAuditRecord({
  requestContext,
  auditId = randomUUID(),
  action,
  resourceType,
  resourceId = null,
  beforeData = null,
  afterData = null,
  metadata = {},
  occurredAt = new Date().toISOString(),
}) {
  validateRequestContext(requestContext);

  return Object.freeze({
    auditId: validateUuid(auditId, 'invalid_audit_id'),
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
    employeeId: requestContext.employeeId ?? null,
    sourceApp: requestContext.sourceApp,
    requestId: requestContext.requestId,
    action: requireString(action, 'audit_action_required'),
    resourceType: requireString(resourceType, 'audit_resource_type_required'),
    resourceId: resourceId == null ? null : requireString(String(resourceId), 'invalid_audit_resource_id'),
    beforeData: beforeData == null ? null : sanitizeJsonValue(beforeData),
    afterData: afterData == null ? null : sanitizeJsonValue(afterData),
    metadata: sanitizeJsonValue(metadata ?? {}),
    occurredAt,
  });
}

export function buildOutboxEvent({
  requestContext,
  eventId = randomUUID(),
  aggregateType,
  aggregateId,
  eventType,
  eventVersion = 1,
  payload,
  metadata = {},
  availableAt = new Date().toISOString(),
  createdAt = new Date().toISOString(),
}) {
  validateRequestContext(requestContext);
  if (payload === undefined) throw new Error('payload_required');

  const normalizedVersion = Number(eventVersion);
  if (!Number.isInteger(normalizedVersion) || normalizedVersion < 1) {
    throw new Error('invalid_event_version');
  }

  return Object.freeze({
    eventId: validateUuid(eventId, 'invalid_event_id'),
    installationId: requestContext.installationId,
    aggregateType: requireString(aggregateType, 'aggregate_type_required'),
    aggregateId: requireString(String(aggregateId ?? ''), 'aggregate_id_required'),
    eventType: requireString(eventType, 'event_type_required'),
    eventVersion: normalizedVersion,
    payload: sanitizeJsonValue(payload),
    metadata: sanitizeJsonValue(metadata ?? {}),
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
    sourceApp: requestContext.sourceApp,
    status: 'pending',
    attempts: 0,
    availableAt,
    createdAt,
    publishedAt: null,
    lastError: null,
  });
}

function validateDbClient(client) {
  if (!client || typeof client.query !== 'function') throw new Error('invalid_db_client');
}

export async function insertAuditRecord(client, record) {
  validateDbClient(client);
  await client.query(
    `INSERT INTO shared.core_audit_records (
      audit_id,
      installation_id,
      actor_id,
      employee_id,
      source_app,
      request_id,
      action,
      resource_type,
      resource_id,
      before_data,
      after_data,
      metadata,
      occurred_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      record.auditId,
      record.installationId,
      record.actorId,
      record.employeeId,
      record.sourceApp,
      record.requestId,
      record.action,
      record.resourceType,
      record.resourceId,
      record.beforeData,
      record.afterData,
      record.metadata,
      record.occurredAt,
    ],
  );
}

export async function insertOutboxEvent(client, event) {
  validateDbClient(client);
  await client.query(
    `INSERT INTO shared.core_outbox_events (
      event_id,
      installation_id,
      aggregate_type,
      aggregate_id,
      event_type,
      event_version,
      payload,
      metadata,
      request_id,
      actor_id,
      source_app,
      status,
      attempts,
      available_at,
      created_at,
      published_at,
      last_error
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      event.eventId,
      event.installationId,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      event.eventVersion,
      event.payload,
      event.metadata,
      event.requestId,
      event.actorId,
      event.sourceApp,
      event.status,
      event.attempts,
      event.availableAt,
      event.createdAt,
      event.publishedAt,
      event.lastError,
    ],
  );
}

function createTrackedClient(client, writeState) {
  return Object.freeze({
    query: async (sql, values = []) => {
      const result = await client.query(sql, values);
      const normalizedSql = String(sql).trim().replace(/\s+/g, ' ').toLowerCase();
      if (normalizedSql.startsWith('insert into shared.core_audit_records')) {
        writeState.auditCount += 1;
      }
      if (normalizedSql.startsWith('insert into shared.core_outbox_events')) {
        writeState.outboxCount += 1;
      }
      return result;
    },
  });
}

export async function withAuditOutboxTransaction({ adapter, mutate }) {
  if (!adapter || typeof adapter.connect !== 'function') {
    throw new Error('invalid_audit_outbox_adapter');
  }
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

    if (result && result.skipAudit === true) {
      await client.query('ROLLBACK');
      return result;
    }

    if (writeState.auditCount !== 1) throw new Error('audit_record_required');
    const expectsOutbox = result?.eventId !== undefined && result?.eventId !== null;
    if (expectsOutbox && writeState.outboxCount !== 1) throw new Error('outbox_event_required');
    if (!expectsOutbox && writeState.outboxCount !== 0) throw new Error('unexpected_outbox_event');

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (typeof client.release === 'function') await client.release();
  }
}
