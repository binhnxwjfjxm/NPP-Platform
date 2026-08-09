import { createHash } from 'node:crypto';
import { createErrorEnvelope } from '@npp/contracts';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export const IDEMPOTENCY_ERROR_CODES = Object.freeze({
  invalidKey: 'IDEMPOTENCY_KEY_INVALID',
  inProgress: 'IDEMPOTENCY_IN_PROGRESS',
  payloadMismatch: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value ?? {}));
}

export function createRequestFingerprint(payload) {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function normalizeIdempotencyKey(headerValue) {
  if (headerValue === undefined || headerValue === null) return null;
  if (Array.isArray(headerValue) && headerValue.length !== 1) {
    throw Object.assign(new Error('invalid_idempotency_key'), {
      code: IDEMPOTENCY_ERROR_CODES.invalidKey,
      statusCode: 400,
    });
  }
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const key = typeof candidate === 'string' ? candidate.trim() : '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw Object.assign(new Error('invalid_idempotency_key'), {
      code: IDEMPOTENCY_ERROR_CODES.invalidKey,
      statusCode: 400,
    });
  }
  return key;
}

export function getScopeFromRequest(requestContext, req, route) {
  if (!requestContext?.installationId || !requestContext?.actorId) {
    throw new Error('invalid_idempotency_scope');
  }
  return Object.freeze({
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
    httpMethod: String(req.method ?? 'GET').toUpperCase(),
    route,
  });
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('invalid_json_body'), {
      code: 'INVALID_JSON_BODY',
      publicMessage: 'Request body must be valid JSON',
      statusCode: 400,
    });
  }
}

function scopeValues(scope) {
  return [scope.installationId, scope.actorId, scope.httpMethod, scope.route, scope.idempotencyKey];
}

function assertOwnedUpdate(result) {
  const changed = result?.rowCount ?? result?.rows?.length ?? 0;
  if (changed !== 1) throw new Error('idempotency_record_not_owned');
}

export function createPostgresIdempotencyStore(adapter) {
  if (!adapter || typeof adapter.connect !== 'function') throw new Error('invalid_idempotency_adapter');

  async function markFinal(scope, requestId, status, responsePayload) {
    const client = await adapter.connect();
    try {
      const result = await client.query(
        `UPDATE shared.core_idempotency_records
         SET status=$1, response_status=$2, response_content_type=$3,
             response_body=$4::jsonb, updated_at=now(), finished_at=now()
         WHERE installation_id=$5 AND actor_id=$6 AND http_method=$7 AND route=$8
           AND idempotency_key=$9 AND request_id=$10 AND status='processing'
         RETURNING *`,
        [status, responsePayload.statusCode, responsePayload.contentType,
          JSON.stringify(responsePayload.body), ...scopeValues(scope), requestId],
      );
      assertOwnedUpdate(result);
      return result.rows?.[0] ?? null;
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    async reserve(scope, requestFingerprint, requestId) {
      const client = await adapter.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO shared.core_idempotency_records (
             installation_id, actor_id, http_method, route, idempotency_key,
             request_fingerprint, request_id, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'processing')
           ON CONFLICT (installation_id, actor_id, http_method, route, idempotency_key)
           DO NOTHING RETURNING *`,
          [...scopeValues(scope), requestFingerprint, requestId],
        );
        if (inserted.rows.length === 1) {
          await client.query('COMMIT');
          return Object.freeze({ created: true, record: inserted.rows[0] });
        }
        const existing = await client.query(
          `SELECT * FROM shared.core_idempotency_records
           WHERE installation_id=$1 AND actor_id=$2 AND http_method=$3 AND route=$4
             AND idempotency_key=$5 LIMIT 1`,
          scopeValues(scope),
        );
        await client.query('COMMIT');
        if (existing.rows.length !== 1) throw new Error('idempotency_conflict_record_missing');
        return Object.freeze({ created: false, record: existing.rows[0] });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async reclaimFailed(scope, requestFingerprint, requestId) {
      const client = await adapter.connect();
      try {
        const result = await client.query(
          `UPDATE shared.core_idempotency_records
           SET status='processing', request_id=$1,
               response_status=NULL, response_content_type=NULL, response_body=NULL,
               updated_at=now(), finished_at=NULL
           WHERE installation_id=$2 AND actor_id=$3 AND http_method=$4 AND route=$5
             AND idempotency_key=$6 AND request_fingerprint=$7 AND status='failed'
             AND (response_status >= 500 OR response_body->'error'->>'retryable' = 'true')
           RETURNING *`,
          [requestId, ...scopeValues(scope), requestFingerprint],
        );
        return Object.freeze({ claimed: result.rows.length === 1, record: result.rows[0] ?? null });
      } finally {
        client.release();
      }
    },

    markCompleted(scope, requestId, responsePayload) {
      return markFinal(scope, requestId, 'completed', responsePayload);
    },
    markFailed(scope, requestId, responsePayload) {
      return markFinal(scope, requestId, 'failed', responsePayload);
    },
  });
}

function errorResponse({ code, message, statusCode, requestId, receivedAt, details = {}, retryable = false }) {
  return {
    statusCode,
    contentType: 'application/json',
    requestId,
    body: createErrorEnvelope({ code, message, statusCode, details, retryable }, requestId, receivedAt),
  };
}

export function createIdempotencyReplayResponse(record) {
  return {
    statusCode: record.response_status,
    contentType: record.response_content_type,
    requestId: record.request_id,
    body: record.response_body,
  };
}

function failedRecordIsRetryable(record) {
  return record?.status === 'failed'
    && (Number(record.response_status) >= 500 || record.response_body?.error?.retryable === true);
}

function responseForExistingRecord(record, requestFingerprint, requestId, receivedAt) {
  if (record.request_fingerprint !== requestFingerprint) {
    return {
      response: errorResponse({
        code: IDEMPOTENCY_ERROR_CODES.payloadMismatch,
        message: 'Idempotency-Key already used with a different payload',
        statusCode: 409,
        requestId,
        receivedAt,
      }),
      replayed: false,
    };
  }
  if (record.status === 'processing') {
    return {
      response: errorResponse({
        code: IDEMPOTENCY_ERROR_CODES.inProgress,
        message: 'Request is already being processed with this Idempotency-Key',
        statusCode: 409,
        requestId,
        receivedAt,
      }),
      replayed: false,
    };
  }
  if (record.status === 'completed' || (record.status === 'failed' && !failedRecordIsRetryable(record))) {
    return { response: createIdempotencyReplayResponse(record), replayed: true };
  }
  if (failedRecordIsRetryable(record)) return null;
  throw new Error('invalid_idempotency_record_status');
}

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
  const rawKey = req.headers['idempotency-key'];
  if (rawKey === undefined) return { response: await onProcess(), replayed: false };

  let idempotencyKey;
  try {
    idempotencyKey = normalizeIdempotencyKey(rawKey);
  } catch (error) {
    return {
      response: errorResponse({
        code: error.code,
        message: 'Idempotency-Key must be 1-128 characters and contain only letters, numbers, dots, underscores, or hyphens',
        statusCode: error.statusCode,
        requestId,
        receivedAt,
      }),
      replayed: false,
    };
  }

  if (!idempotencyStore || typeof idempotencyStore.reserve !== 'function') {
    throw new Error('invalid_idempotency_store');
  }

  const scope = Object.freeze({ ...getScopeFromRequest(requestContext, req, route), idempotencyKey });
  const requestFingerprint = createRequestFingerprint(payload);
  let reservation = await idempotencyStore.reserve(scope, requestFingerprint, requestId);

  if (!reservation.created) {
    const existingResponse = responseForExistingRecord(
      reservation.record,
      requestFingerprint,
      requestId,
      receivedAt,
    );
    if (existingResponse) return existingResponse;
    if (typeof idempotencyStore.reclaimFailed !== 'function') throw new Error('invalid_idempotency_store');
    const reclaimed = await idempotencyStore.reclaimFailed(scope, requestFingerprint, requestId);
    if (!reclaimed.claimed) {
      return {
        response: errorResponse({
          code: IDEMPOTENCY_ERROR_CODES.inProgress,
          message: 'Request is already being processed with this Idempotency-Key',
          statusCode: 409,
          requestId,
          receivedAt,
          retryable: true,
        }),
        replayed: false,
      };
    }
    reservation = { created: true, record: reclaimed.record };
  }

  try {
    const response = await onProcess();
    await idempotencyStore.markCompleted(scope, requestId, response);
    return { response, replayed: false };
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 503;
    const retryable = typeof error?.retryable === 'boolean' ? error.retryable : statusCode >= 500;
    const failureResponse = errorResponse({
      code: error?.code ?? 'INTERNAL_ERROR',
      message: error?.publicMessage ?? 'Request failed',
      statusCode,
      requestId,
      receivedAt,
      details: error?.details ?? {},
      retryable,
    });
    await idempotencyStore.markFailed(scope, requestId, failureResponse);
    return { response: failureResponse, replayed: false };
  }
}
