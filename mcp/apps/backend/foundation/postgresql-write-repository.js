const BANNED_REPOSITORY_KEYS = new Set(["client", "pool", "query", "sql", "table", "rpc", "provider"]);

function repositoryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requiredText(value, code, maxLength = 512) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > maxLength) throw repositoryError(code);
  return candidate;
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function positiveInteger(value, code) {
  const candidate = Number(value);
  if (!Number.isInteger(candidate) || candidate < 1) throw repositoryError(code);
  return candidate;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

function assertSafeRepositoryShape(value, client, seen = new Set()) {
  if (value === client) throw repositoryError("unsafe_domain_repository_contract");
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (BANNED_REPOSITORY_KEYS.has(key.toLowerCase()) || item === client) {
      throw repositoryError("unsafe_domain_repository_contract");
    }
    assertSafeRepositoryShape(item, client, seen);
  }
}

function safeDomainRepositories(factory, client) {
  const repositories = factory ? factory(client) : {};
  if (!repositories || typeof repositories !== "object" || Array.isArray(repositories)) {
    throw repositoryError("invalid_domain_repository_contract");
  }
  assertSafeRepositoryShape(repositories, client);
  return deepFreeze(repositories);
}

function idempotencyPort(client, retryAfterSeconds) {
  return Object.freeze({
    async claim({ installationId, commandName, idempotencyKey, fingerprint, requestId, actorId }) {
      const values = [
        requiredText(installationId, "invalid_installation_id", 191),
        requiredText(commandName, "invalid_command_name", 128),
        requiredText(idempotencyKey, "invalid_idempotency_key", 512),
        requiredText(fingerprint, "invalid_fingerprint", 64),
        requiredText(requestId, "invalid_request_id", 191),
        requiredText(actorId, "invalid_actor_id", 191)
      ];
      const inserted = await client.query(
        `INSERT INTO mcp.idempotency_records (
           installation_id, command_name, idempotency_key, fingerprint, request_id, actor_id
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (installation_id, command_name, idempotency_key) DO NOTHING
         RETURNING id::text AS record_id`,
        values
      );
      if (inserted.rows?.[0]) {
        return Object.freeze({ state: "claimed", recordId: String(inserted.rows[0].record_id) });
      }

      const existing = await client.query(
        `SELECT id::text AS record_id, fingerprint, state, response, request_id
         FROM mcp.idempotency_records
         WHERE installation_id = $1 AND command_name = $2 AND idempotency_key = $3
         FOR UPDATE`,
        values.slice(0, 3)
      );
      const row = existing.rows?.[0];
      if (!row) throw repositoryError("idempotency_claim_lost");
      if (String(row.fingerprint) !== values[3]) return Object.freeze({ state: "conflict" });
      if (row.state === "completed") {
        return Object.freeze({
          state: "replay",
          recordId: String(row.record_id),
          response: row.response,
          originalRequestId: String(row.request_id)
        });
      }
      return Object.freeze({ state: "in_progress", retryAfterSeconds });
    },

    async complete({
      recordId, installationId, commandName, idempotencyKey, fingerprint, requestId, response
    }) {
      const result = await client.query(
        `UPDATE mcp.idempotency_records
         SET state = 'completed',
             response = $7::jsonb,
             completed_at = now(),
             expires_at = COALESCE(expires_at, now() + interval '7 days')
         WHERE id = $1::uuid
           AND installation_id = $2
           AND command_name = $3
           AND idempotency_key = $4
           AND fingerprint = $5
           AND request_id = $6
           AND state = 'in_progress'
         RETURNING id::text AS record_id`,
        [
          requiredText(recordId, "invalid_idempotency_record_id", 64),
          requiredText(installationId, "invalid_installation_id", 191),
          requiredText(commandName, "invalid_command_name", 128),
          requiredText(idempotencyKey, "invalid_idempotency_key", 512),
          requiredText(fingerprint, "invalid_fingerprint", 64),
          requiredText(requestId, "invalid_request_id", 191),
          json(response)
        ]
      );
      if (!result.rows?.[0]) throw repositoryError("idempotency_completion_conflict");
      return Object.freeze({ recordId: String(result.rows[0].record_id) });
    }
  });
}

function auditPort(client) {
  return Object.freeze({
    async append(event) {
      await client.query(
        `INSERT INTO mcp.audit_events (
           event_id, event_type, aggregate_type, aggregate_id, aggregate_version,
           installation_id, actor_id, actor_type, employee_id, request_id,
           idempotency_key, source, action, permission, scope, occurred_at, payload
         ) VALUES (
           $1::uuid, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16::timestamptz, $17::jsonb
         )`,
        [
          requiredText(event.eventId, "invalid_event_id", 64),
          requiredText(event.eventType, "invalid_event_type", 128),
          requiredText(event.aggregateType, "invalid_aggregate_type", 128),
          requiredText(event.aggregateId, "invalid_aggregate_id", 191),
          positiveInteger(event.aggregateVersion, "invalid_aggregate_version"),
          requiredText(event.installationId, "invalid_installation_id", 191),
          requiredText(event.actorId, "invalid_actor_id", 191),
          requiredText(event.actorType, "invalid_actor_type", 64),
          event.employeeId ? requiredText(event.employeeId, "invalid_employee_id", 191) : null,
          requiredText(event.requestId, "invalid_request_id", 191),
          requiredText(event.idempotencyKey, "invalid_idempotency_key", 512),
          requiredText(event.source, "invalid_event_source", 128),
          requiredText(event.action, "invalid_audit_action", 128),
          requiredText(event.permission, "invalid_permission", 128),
          event.scope ? requiredText(event.scope, "invalid_scope", 128) : null,
          requiredText(event.occurredAt, "invalid_occurred_at", 64),
          json(event.payload)
        ]
      );
    }
  });
}

function outboxPort(client) {
  return Object.freeze({
    async enqueue(event) {
      await client.query(
        `INSERT INTO mcp.outbox_events (
           event_id, event_type, aggregate_type, aggregate_id, aggregate_version,
           installation_id, actor_id, actor_type, employee_id, request_id,
           idempotency_key, source, occurred_at, payload
         ) VALUES (
           $1::uuid, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, $12, $13::timestamptz, $14::jsonb
         )`,
        [
          requiredText(event.eventId, "invalid_event_id", 64),
          requiredText(event.eventType, "invalid_event_type", 128),
          requiredText(event.aggregateType, "invalid_aggregate_type", 128),
          requiredText(event.aggregateId, "invalid_aggregate_id", 191),
          positiveInteger(event.aggregateVersion, "invalid_aggregate_version"),
          requiredText(event.installationId, "invalid_installation_id", 191),
          requiredText(event.actorId, "invalid_actor_id", 191),
          requiredText(event.actorType, "invalid_actor_type", 64),
          event.employeeId ? requiredText(event.employeeId, "invalid_employee_id", 191) : null,
          requiredText(event.requestId, "invalid_request_id", 191),
          requiredText(event.idempotencyKey, "invalid_idempotency_key", 512),
          requiredText(event.source, "invalid_event_source", 128),
          requiredText(event.occurredAt, "invalid_occurred_at", 64),
          json(event.payload)
        ]
      );
    }
  });
}

export function createPostgresqlWriteTransaction(
  persistence,
  { domainRepositoryFactory = null, retryAfterSeconds = 2 } = {}
) {
  if (!persistence || typeof persistence.withTransaction !== "function") {
    throw repositoryError("postgresql_transaction_boundary_required");
  }
  if (persistence.schema !== "mcp") throw repositoryError("mcp_schema_required");
  const retry = Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0
    ? Math.min(retryAfterSeconds, 300)
    : 2;

  return async function transaction(work) {
    if (typeof work !== "function") throw repositoryError("transaction_work_required");
    return persistence.withTransaction(async (client) => {
      const tx = Object.freeze({
        idempotency: idempotencyPort(client, retry),
        audit: auditPort(client),
        outbox: outboxPort(client),
        repositories: safeDomainRepositories(domainRepositoryFactory, client)
      });
      return work(tx);
    });
  };
}
