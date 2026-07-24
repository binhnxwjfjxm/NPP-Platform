import { timingSafeEqual } from 'node:crypto';
import { createRequestId } from '@npp/shared-utils';

export function buildAuthContext(input = {}) {
  return Object.freeze({
    requestId: input.requestId ?? createRequestId('req'),
    actorId: input.actorId ?? 'system:anonymous',
    roles: Object.freeze([...(input.roles ?? [])]),
    installationId: input.installationId ?? null,
  });
}

export function extractBearerToken(headerValue) {
  if (typeof headerValue !== 'string' || !headerValue.startsWith('Bearer ')) return null;
  const token = headerValue.slice(7).trim();
  return token || null;
}

export function tokenMatches(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}
