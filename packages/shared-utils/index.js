import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function createRequestId(prefix = 'req') {
  const suffix = randomUUID().replaceAll('-', '');
  return `${prefix}_${suffix}`;
}

export function normalizeRequestId(value, prefix = 'req') {
  if (typeof value === 'string' && SAFE_REQUEST_ID_PATTERN.test(value)) {
    return value;
  }
  return createRequestId(prefix);
}

export function resolveRequestId(value, prefix = 'req') {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate === 'string') {
    const normalized = candidate.trim();
    if (REQUEST_ID_PATTERN.test(normalized)) return normalized;
  }
  return createRequestId(prefix);
}

export function sanitizeConfigRecord(input = {}) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
  );
}

export function toBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
