export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

const IDEMPOTENCY_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_UUID_LENGTH = 36;
const IDEMPOTENCY_OPERATION_MAX_LENGTH = IDEMPOTENCY_KEY_MAX_LENGTH - IDEMPOTENCY_UUID_LENGTH - 1;

export function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function isValidIdempotencyKey(value) {
  const normalized = normalizeIdempotencyKey(value);
  return normalized !== null && IDEMPOTENCY_KEY_PATTERN.test(normalized);
}

export function normalizeIdempotencyOperation(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, IDEMPOTENCY_OPERATION_MAX_LENGTH)
    .replace(/[._-]+$/g, '');
  if (!normalized) throw new Error('idempotency_operation_required');
  return normalized;
}

export function createIdempotencyKey(operation, uuid) {
  const generatedUuid = uuid ?? globalThis.crypto?.randomUUID?.();
  if (typeof generatedUuid !== 'string' || !IDEMPOTENCY_UUID_PATTERN.test(generatedUuid)) {
    throw new Error('idempotency_uuid_invalid');
  }
  const key = `${normalizeIdempotencyOperation(operation)}-${generatedUuid.toLowerCase()}`;
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error('idempotency_key_generation_failed');
  return key;
}

export function createSuccessEnvelope(data, requestId, receivedAt) {
  return {
    data,
    requestId,
    receivedAt,
  };
}

export function createErrorEnvelope(error, requestId, receivedAt) {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details ?? {},
      retryable: Boolean(error.retryable),
    },
    requestId,
    receivedAt,
  };
}
