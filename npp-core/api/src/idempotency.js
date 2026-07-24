import { createHash } from 'node:crypto';
import { createErrorEnvelope } from '@npp/contracts';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export const IDEMPOTENCY_ERROR_CODES = Object.freeze({
  invalidKey: 'IDEMPOTENCY_KEY_INVALID',
  inProgress: 'IDEMPOTENCY_IN_PROGRESS',
  payloadMismatch: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
  failed: 'IDEMPOTENCY_FAILED',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSort(entry));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, stableSort(nestedValue)]),
    );
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSort(value ?? {}));
}

export function createRequestFingerprint(payload) {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function normalizeIdempotencyKey(keyValue) {
  if (keyValue === undefined || keyValue === null) return null;
  const key = String(keyValue).trim();
  if (!key) return null;
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw Object.assign(new Error('invalid_idempotency_key'), {
      code: IDEMPOTENCY_ERROR_CODES.invalidKey,
      statusCode: 400,
    });
  }
  return key;
}

export function getScopeFromRequest(requestContext, req, route) {
  return {
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
    httpMethod: String(req.method ?? 'GET').toUpperCase(),
    route,
  };
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { rawBody: text };
  }
}

export function createPostgresIdempotencyStore(adapter) {
  if (!adapter || typeof adapter.connect !== 'function') {
    throw new Error('invalid_idempotency_adapter');
  }

  return {
    async reserve(scope, requestFingerprint, requestId) {
      const client = await adapter.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `
            INSERT INTO shared.core_idempotency_records (
              installation_id,
              actor_id,
              http_method,
              route,
              idempotency_key,
              request_fingerprint,
              request_id,
              status,
              response_status,
              response_content_type,
              response_body,
              created_at,
              updated_at,
              completed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', 0, 'application/json', '{}'::jsonb, now(), now(), null)
            ON CONFLICT (installation_id, actor_id, http_method, route, idempotency_key)
            DO NOTHING
            RETURNING *
          `,
          [
            scope.installationId,
            scope.actorId,
            scope.httpMethod,
            scope.route,
            scope.idempotencyKey,
            requestFingerprint,
            requestId,
          ],
        );

        if (inserted.rows.length > 0) {
          await client.query('COMMIT');
          return { created: true, record: inserted.rows[0] };
        }

        const existing = await client.query(
          `
            SELECT *
            FROM shared.core_idempotency_records
            WHERE installation_id = $1
              AND actor_id = $2
              AND http_method = $3
              AND route = $4
              AND idempotency_key = $5
            LIMIT 1
          `,
          [
            scope.installationId,
            scope.actorId,
            scope.httpMethod,
            scope.route,
            scope.idempotencyKey,
          ],
        );
        await client.query('COMMIT');
        return { created: false, record: existing.rows[0] ?? null };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async get(scope) {
      const client = await adapter.connect();
      try {
        const existing = await client.query(
          `
            SELECT *
            FROM shared.core_idempotency_records
            WHERE installation_id = $1
              AND actor_id = $2
              AND http_method = $3
              AND route = $4
              AND idempotency_key = $5
            LIMIT 1
          `,
          [
            scope.installationId,
            scope.actorId,
            scope.httpMethod,
            scope.route,
            scope.idempotencyKey,
          ],
        );
        return existing.rows[0] ?? null;
      } finally {
        client.release();
      }
    },

    async markCompleted(scope, requestId, responsePayload) {
      const client = await adapter.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `
            UPDATE shared.core_idempotency_records
            SET status = 'completed',
                response_status = $1,
                response_content_type = $2,
                response_body = $3::jsonb,
                updated_at = now(),
                completed_at = now()
            WHERE installation_id = $4
              AND actor_id = $5
              AND http_method = $6
              AND route = $7
              AND idempotency_key = $8
              AND request_id = $9
          `,
          [
            responsePayload.statusCode,
            responsePayload.contentType,
            JSON.stringify(responsePayload.body),
            scope.installationId,
            scope.actorId,
            scope.httpMethod,
            scope.route,
            scope.idempotencyKey,
            requestId,
          ],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async markFailed(scope, requestId, responsePayload) {
      const client = await adapter.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `
            UPDATE shared.core_idempotency_records
            SET status = 'failed',
                response_status = $1,
                response_content_type = $2,
                response_body = $3::jsonb,
                updated_at = now(),
                completed_at = now()
            WHERE installation_id = $4
              AND actor_id = $5
              AND http_method = $6
              AND route = $7
              AND idempotency_key = $8
              AND request_id = $9
          `,
          [
            responsePayload.statusCode,
            responsePayload.contentType,
            JSON.stringify(responsePayload.body),
            scope.installationId,
            scope.actorId,
            scope.httpMethod,
            scope.route,
            scope.idempotencyKey,
            requestId,
          ],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

const processingLocks = new Set();
// serialize reserve calls per-key to simulate DB atomicity in-process
const reservePromises = new Map();

export async function executeRequestWithIdempotency({
  idempotencyStore,
  req,
  requestContext,
  requestId,
  receivedAt,
  route,
  payload,
  onProcess,
}) {
  const idempotencyKey = req.headers['idempotency-key'];
  if (idempotencyKey === undefined) {
    return { response: await onProcess(), replayed: false };
  }

  let normalizedKey;
  try {
    normalizedKey = normalizeIdempotencyKey(idempotencyKey);
  } catch (error) {
    return {
      response: {
        statusCode: error.statusCode,
        contentType: 'application/json',
        requestId,
        body: createErrorEnvelope(
          {
            code: error.code,
            message: 'Idempotency-Key must be 1-128 characters and contain only letters, numbers, dots, underscores, or hyphens',
            statusCode: error.statusCode,
          },
          requestId,
          receivedAt,
        ),
      },
      replayed: false,
    };
  }

  if (!normalizedKey) {
    return {
      response: {
        statusCode: 400,
        contentType: 'application/json',
        requestId,
        body: createErrorEnvelope(
          {
            code: IDEMPOTENCY_ERROR_CODES.invalidKey,
            message: 'Idempotency-Key is required to be a non-empty token',
            statusCode: 400,
          },
          requestId,
          receivedAt,
        ),
      },
      replayed: false,
    };
  }

  const scope = {
    ...getScopeFromRequest(requestContext, req, route),
    idempotencyKey: normalizedKey,
  };
  const requestFingerprint = createRequestFingerprint(payload);
  const lockKey = [scope.installationId, scope.actorId, scope.httpMethod, scope.route, scope.idempotencyKey].join('::');

  // If the adapter supports a non-destructive read, prefer checking the
  // existing record first so we can detect payload mismatches even when
  // another process is currently handling the request.
  if (typeof idempotencyStore.get === 'function') {
    const existing = await idempotencyStore.get(scope);
    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        return {
          response: {
            statusCode: 409,
            contentType: 'application/json',
            requestId,
            body: createErrorEnvelope(
              {
                code: IDEMPOTENCY_ERROR_CODES.payloadMismatch,
                message: 'Idempotency-Key already used with a different payload',
                statusCode: 409,
              },
              requestId,
              receivedAt,
            ),
          },
          replayed: false,
        };
      }

      if (existing.status === 'processing') {
        return {
          response: {
            statusCode: 409,
            contentType: 'application/json',
            requestId,
            body: createErrorEnvelope(
              {
                code: IDEMPOTENCY_ERROR_CODES.inProgress,
                message: 'Request is already being processed with this Idempotency-Key',
                statusCode: 409,
              },
              requestId,
              receivedAt,
            ),
          },
          replayed: false,
        };
      }

      if (existing.status === 'failed') {
        return {
          response: {
            statusCode: existing.response_status ?? 500,
            contentType: existing.response_content_type ?? 'application/json',
            requestId: existing.request_id ?? requestId,
            body: existing.response_body ?? {},
          },
          replayed: true,
        };
      }

      if (existing.status === 'completed') {
        return {
          response: {
            statusCode: existing.response_status ?? 200,
            contentType: existing.response_content_type ?? 'application/json',
            requestId: existing.request_id ?? requestId,
            body: existing.response_body ?? {},
          },
          replayed: true,
        };
      }
    }
  }

  // Acquire an in-process processing lock early to ensure concurrent
  // requests to the same idempotency key in this process immediately
  // return 409 instead of racing to create duplicate records.
  if (processingLocks.has(lockKey)) {
    return {
      response: {
        statusCode: 409,
        contentType: 'application/json',
        requestId,
        body: createErrorEnvelope(
          {
            code: IDEMPOTENCY_ERROR_CODES.inProgress,
            message: 'Request is already being processed with this Idempotency-Key',
            statusCode: 409,
          },
          requestId,
          receivedAt,
        ),
      },
      replayed: false,
    };
  }

  processingLocks.add(lockKey);

  // Ensure reserve() calls for the same key run sequentially to avoid
  // in-memory races in tests. Real DB adapters are atomic via INSERT .. ON CONFLICT.
  const prev = reservePromises.get(lockKey) ?? Promise.resolve();
  const current = prev.then(() => idempotencyStore.reserve(scope, requestFingerprint, requestId));
  reservePromises.set(lockKey, current.finally(() => reservePromises.delete(lockKey)));
  let reserveResult;
  try {
    reserveResult = await current;
  } catch (err) {
    // ensure any processing lock is not left behind
    processingLocks.delete(lockKey);
    throw err;
  }

  if (!reserveResult.created) {
    const record = reserveResult.record;
    if (!record) {
      return {
        response: {
          statusCode: 409,
          contentType: 'application/json',
          requestId,
          body: createErrorEnvelope(
            {
              code: IDEMPOTENCY_ERROR_CODES.inProgress,
              message: 'Request is already being processed with this Idempotency-Key',
              statusCode: 409,
            },
            requestId,
            receivedAt,
          ),
        },
        replayed: false,
      };
    }

    if (record.request_fingerprint !== requestFingerprint) {
      return {
        response: {
          statusCode: 409,
          contentType: 'application/json',
          requestId,
          body: createErrorEnvelope(
            {
              code: IDEMPOTENCY_ERROR_CODES.payloadMismatch,
              message: 'Idempotency-Key already used with a different payload',
              statusCode: 409,
            },
            requestId,
            receivedAt,
          ),
        },
        replayed: false,
      };
    }

    if (record.status === 'processing') {
      return {
        response: {
          statusCode: 409,
          contentType: 'application/json',
          requestId,
          body: createErrorEnvelope(
            {
              code: IDEMPOTENCY_ERROR_CODES.inProgress,
              message: 'Request is already being processed with this Idempotency-Key',
              statusCode: 409,
            },
            requestId,
            receivedAt,
          ),
        },
        replayed: false,
      };
    }

    if (record.status === 'failed') {
      return {
        response: {
          statusCode: record.response_status ?? 500,
          contentType: record.response_content_type ?? 'application/json',
          requestId: record.request_id ?? requestId,
          body: record.response_body ?? {},
        },
        replayed: true,
      };
    }

    if (record.status === 'completed') {
      return {
        response: {
          statusCode: record.response_status ?? 200,
          contentType: record.response_content_type ?? 'application/json',
          requestId: record.request_id ?? requestId,
          body: record.response_body ?? {},
        },
        replayed: true,
      };
    }
  }

  try {
    const response = await onProcess();
    await idempotencyStore.markCompleted(scope, requestId, response);
    return { response, replayed: false };
  } catch (error) {
    const failureResponse = {
      statusCode: error.statusCode ?? 500,
      contentType: 'application/json',
      requestId,
      body: createErrorEnvelope(
        {
          code: error.code ?? 'INTERNAL_ERROR',
          message: error.publicMessage ?? error.message ?? 'Request failed',
          statusCode: error.statusCode ?? 500,
          details: error.details ?? {},
        },
        requestId,
        receivedAt,
      ),
    };
    await idempotencyStore.markFailed(scope, requestId, failureResponse).catch(() => {});
    return { response: failureResponse, replayed: false };
  } finally {
    processingLocks.delete(lockKey);
  }
}

export function createIdempotencyReplayResponse(record) {
  return {
    statusCode: record.response_status ?? 200,
    contentType: record.response_content_type ?? 'application/json',
    requestId: record.request_id,
    body: record.response_body ?? {},
  };
}
