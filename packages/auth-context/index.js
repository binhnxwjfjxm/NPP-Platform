import { createRequestId } from '@npp/shared-utils';

export function buildAuthContext(input = {}) {
  return {
    requestId: input.requestId ?? createRequestId('req'),
    actorId: input.actorId ?? 'system:anonymous',
    roles: input.roles ?? [],
    installationId: input.installationId ?? 'default',
  };
}

export function sanitizeToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  return token.trim().slice(0, 24);
}
