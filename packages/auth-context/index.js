import { timingSafeEqual } from 'node:crypto';
import { createRequestId } from '@npp/shared-utils';

function frozenStrings(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze([...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]);
}

export function buildAuthContext(input = {}) {
  return Object.freeze({
    requestId: input.requestId ?? createRequestId('req'),
    actorId: input.actorId ?? 'system:anonymous',
    employeeId: input.employeeId ?? null,
    roles: frozenStrings(input.roles),
    permissions: frozenStrings(input.permissions),
    scopes: Object.freeze({
      branchIds: frozenStrings(input.scopes?.branchIds),
      warehouseIds: frozenStrings(input.scopes?.warehouseIds),
      territoryIds: frozenStrings(input.scopes?.territoryIds),
    }),
    installationId: input.installationId ?? null,
    sourceApp: input.sourceApp ?? 'npp-core-api',
    receivedAt: input.receivedAt ?? new Date().toISOString(),
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
