import { buildAuthContext, extractBearerToken, tokenMatches } from '@npp/auth-context';
import { createRequestId } from '@npp/shared-utils';

export const PERMISSIONS = Object.freeze({
  coreConfigRead: 'core.config.read',
  coreHealthAuthenticatedRead: 'core.health.authenticated.read',
});

const PERMISSION_REGISTRY = new Set(Object.values(PERMISSIONS));

function normalizePrincipal(principal = {}) {
  return Object.freeze({
    actorId: principal.actorId ?? 'system:anonymous',
    roles: Object.freeze([...(principal.roles ?? [])]),
    permissions: Object.freeze([...(principal.permissions ?? [])]),
    sourceApp: principal.sourceApp ?? 'npp-core-api',
  });
}

export function createAnonymousPrincipal() {
  return normalizePrincipal({
    actorId: 'system:anonymous',
    roles: ['anonymous'],
    permissions: [],
    sourceApp: 'npp-core-api',
  });
}

export function createBootstrapPrincipal(config) {
  return normalizePrincipal({
    actorId: config.coreBootstrapActorId,
    roles: ['bootstrap', 'admin'],
    permissions: [PERMISSIONS.coreConfigRead, PERMISSIONS.coreHealthAuthenticatedRead],
    sourceApp: 'npp-core-api',
  });
}

export function createRequestContext({ config, principal = createAnonymousPrincipal(), requestId = createRequestId('req'), receivedAt = new Date().toISOString() }) {
  const normalizedPrincipal = normalizePrincipal(principal);
  return Object.freeze({
    installationId: config.installationId,
    actorId: normalizedPrincipal.actorId,
    roles: normalizedPrincipal.roles,
    permissions: normalizedPrincipal.permissions,
    requestId,
    sourceApp: normalizedPrincipal.sourceApp,
    receivedAt,
    authContext: buildAuthContext({
      requestId,
      installationId: config.installationId,
      actorId: normalizedPrincipal.actorId,
      roles: normalizedPrincipal.roles,
      permissions: normalizedPrincipal.permissions,
      sourceApp: normalizedPrincipal.sourceApp,
      receivedAt,
    }),
  });
}

export function authenticateRequest(req, config) {
  const candidate = extractBearerToken(req.headers.authorization);
  if (!candidate) {
    return { ok: false, code: 'UNAUTHORIZED', statusCode: 401 };
  }

  if (!tokenMatches(candidate, config.backendApiToken)) {
    return { ok: false, code: 'UNAUTHORIZED', statusCode: 401 };
  }

  return {
    ok: true,
    principal: createBootstrapPrincipal(config),
  };
}

export function requirePermission(requestContext, permission) {
  if (!PERMISSION_REGISTRY.has(permission)) {
    return { ok: false, code: 'FORBIDDEN', statusCode: 403 };
  }

  if (!requestContext.permissions.includes(permission)) {
    return { ok: false, code: 'FORBIDDEN', statusCode: 403 };
  }

  return { ok: true };
}

export function safeRequestContext(requestContext) {
  return Object.freeze({
    actorId: requestContext.actorId,
    installationId: requestContext.installationId,
    roles: [...requestContext.roles],
    permissions: [...requestContext.permissions],
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    receivedAt: requestContext.receivedAt,
  });
}
