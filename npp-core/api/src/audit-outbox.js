import { randomUUID } from 'node:crypto';

const SECRET_KEY_PATTERN = /(?:secret|token|password|passphrase|db_?url|connection_?string|api_?key|auth_?token|private_?key)/i;

function shouldRedactKey(key) {
  return typeof key === 'string' && SECRET_KEY_PATTERN.test(key);
}

function sanitizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }

  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (shouldRedactKey(key)) {
          return [key, null];
        }
        return [key, sanitizeJsonValue(child)];
      }),
    );
  }

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
}) {
  if (!requestContext) throw new Error('missing_request_context');
  return {
    auditId,
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
    employeeId: requestContext.employeeId,
    sourceApp: requestContext.sourceApp,
    requestId: requestContext.requestId,
    action: String(action ?? 'unknown').trim() || 'unknown',
    resourceType: String(resourceType ?? 'unknown').trim() || 'unknown',
    resourceId: resourceId == null ? null : String(resourceId),
    beforeData: beforeData == null ? null : sanitizeJsonValue(beforeData),
    afterData: afterData == null ? null : sanitizeJsonValue(afterData),
    metadata: sanitizeJsonValue(metadata),
    occurredAt: new Date().toISOString(),
  };
}

export function buildOutboxEvent({
  requestContext,
  eventId = randomUUID(),
  aggregateType,
  aggregateId,
  eventType,
  eventVersion,
  payload,
  metadata = {},
  status = 'pending',
  attempts = 0,
  availableAt = new Date().toISOString(),
  createdAt = new Date().toISOString(),
  publishedAt = null,
  lastError = null,
}) {
  if (!requestContext) throw new Error('missing_request_context');
  if (payload === undefined) throw new Error('payload_required');
  return {
    eventId,
    installationId: requestContext.installationId,
    aggregateType: String(aggregateType ?? 'unknown').trim() || 'unknown',
    aggregateId: String(aggregateId ?? requestContext.requestId),
    eventType: String(eventType ?? 'unknown').trim() || 'unknown',
    eventVersion: Number(eventVersion ?? 1),
    payload: sanitizeJsonValue(payload),
    metadata: sanitizeJsonValue(metadata),
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
    sourceApp: requestContext.sourceApp,
    status,
    attempts,
    availableAt,
    createdAt,
    publishedAt,
    lastError,
  };
}

function validateDbClient(client) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('invalid_db_client');
  }
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

export async function withAuditOutboxTransaction({ adapter, mutate }) {
  if (!adapter || typeof adapter.connect !== 'function') {
    throw new Error('invalid_audit_outbox_adapter');
  }
  if (typeof mutate !== 'function') {
    throw new Error('invalid_mutation_callback');
  }

  const client = await adapter.connect();
  try {
    await client.query('BEGIN');
    const result = await mutate(client, {
      buildAuditRecord,
      buildOutboxEvent,
      insertAuditRecord,
      insertOutboxEvent,
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (typeof client.release === 'function') {
      await client.release();
    }
  }
}
