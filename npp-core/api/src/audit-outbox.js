import { randomUUID } from 'node:crypto';

const SECRET_KEY_PATTERN = /(?:secret|token|password|passphrase|db_?url|database_?url|connection_?string|api_?key|auth_?token|private_?key)/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIRECT_MUTATING_SQL_PATTERN = /^(?:insert\s+into|update\s+|delete\s+from|merge\s+into|truncate\s+|create\s+|alter\s+|drop\s+|grant\s+|revoke\s+)/i;
const CTE_BODY_MUTATION_PATTERN = /\bas\s*\(\s*(?:insert\s+into|update\s+|delete\s+from|merge\s+into)\b/i;
const CTE_MAIN_MUTATION_PATTERN = /\)\s*(?:insert\s+into|update\s+|delete\s+from|merge\s+into)\b/i;

function isMutatingSql(normalizedSql) {
  if (DIRECT_MUTATING_SQL_PATTERN.test(normalizedSql)) return true;
  if (!normalizedSql.startsWith('with ')) return false;
  return CTE_BODY_MUTATION_PATTERN.test(normalizedSql)
    || CTE_MAIN_MUTATION_PATTERN.test(normalizedSql);
}

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

function sanitizeTransactionError(error) {
  const raw = typeof error?.message === 'string' ? error.message : 'transaction_failed';
  const message = raw
    .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
    .replace(/(?:password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 240);
  return Object.freeze({
    event: 'audit_outbox_transaction_failed',
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    constraint: typeof error?.constraint === 'string' ? error.constraint.slice(0, 160) : null,
    message,
  });
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
      if (isMutatingSql(normalizedSql)) writeState.writeCount += 1;
      if (normalizedSql.startsWith('insert into shared.core_audit_records')) writeState.auditCount += 1;
      if (normalizedSql.startsWith('insert into shared.core_outbox_events')) writeState.outboxCount += 1;
      return result;
    },
  });
}

function expectedCount(value, fallback, errorCode) {
  if (value === undefined || value === null) return fallback;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 100) {
    throw new Error(errorCode);
  }
  return normalized;
}

export async function withAuditOutboxTransaction({ adapter, mutate }) {
  if (!adapter || typeof adapter.connect !== 'function') throw new Error('invalid_audit_outbox_adapter');
  if (typeof mutate !== 'function') throw new Error('invalid_mutation_callback');

  const client = await adapter.connect();
  const writeState = { writeCount: 0, auditCount: 0, outboxCount: 0 };
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

    if (result?.replayed === true && writeState.writeCount !== 0) {
      throw new Error('replay_transaction_must_be_read_only');
    }

    const replayWithoutWrites = result?.replayed === true
      && writeState.writeCount === 0
      && writeState.auditCount === 0
      && writeState.outboxCount === 0;

    if (!replayWithoutWrites) {
      const expectsOutbox = result?.eventId !== undefined && result?.eventId !== null;
      const explicitAuditCount = result?.expectedAuditCount !== undefined
        && result?.expectedAuditCount !== null;
      const explicitOutboxCount = result?.expectedOutboxCount !== undefined
        && result?.expectedOutboxCount !== null;
      const requiredAuditCount = expectedCount(
        result?.expectedAuditCount,
        1,
        'invalid_expected_audit_count',
      );
      const requiredOutboxCount = expectedCount(
        result?.expectedOutboxCount,
        expectsOutbox ? 1 : 0,
        'invalid_expected_outbox_count',
      );
      if (writeState.auditCount !== requiredAuditCount) {
        throw new Error(explicitAuditCount ? 'audit_record_count_mismatch' : 'audit_record_required');
      }
      if (writeState.outboxCount !== requiredOutboxCount) {
        if (explicitOutboxCount) throw new Error('outbox_event_count_mismatch');
        throw new Error(expectsOutbox ? 'outbox_event_required' : 'unexpected_outbox_event');
      }
    }

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(JSON.stringify(sanitizeTransactionError(error)));
    throw error;
  } finally {
    if (typeof client.release === 'function') await client.release();
  }
}