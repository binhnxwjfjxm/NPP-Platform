import { randomUUID } from 'node:crypto';

export function createRequestId(prefix = 'req') {
  return `${prefix}_${randomUUID()}`;
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
