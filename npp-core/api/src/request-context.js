import { buildAuthContext, extractBearerToken, tokenMatches } from '@npp/auth-context';
import { createRequestId } from '@npp/shared-utils';

export const PERMISSIONS = Object.freeze({
  coreConfigRead: 'core.config.read',
  coreHealthAuthenticatedRead: 'core.health.authenticated.read',
  coreIdempotencyTestWrite: 'core.idempotency.test.write',
});

const PERMISSION_REGISTRY = new Set(Object.values(PERMISSIONS));

function frozenStrings(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze([...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]);
}

function normalizeScopes(scopes = {}) {
  return Object.freeze({
    branchIds: frozenStrings(scopes.branchIds),
    warehouseIds: frozenStrings(scopes.warehouseIds),
    territoryIds: frozenStrings(scopes.territoryIds),
  });
}

function normalizePrincipal(principal = {}) {
  return Object.freeze({
    actorId: principal.actorId ?? 'system:anonymous',
    employeeId: principal.employeeId ?? null,
    roles: Object.freeze([...(principal.roles ?? [])]),
    permissions: Object.freeze([...(principal.permissions ?? [])]),
    scopes: normalizeScopes(principal.scopes),
    sourceApp: principal.sourceApp ?? 'npp-core-api',
  });
}

export function createAnonymousPrincipal() {
  return normalizePrincipal({
    actorId: 'system:anonymous',
    employeeId: null,
    roles: ['anonymous'],
    permissions: [],
    scopes: { warehouseIds: [] },
    sourceApp: 'npp-core-api',
  });
}

export function createBootstrapPrincipal(config) {
  return normalizePrincipal({
    actorId: config.coreBootstrapActorId,
    employeeId: null,
    roles: ['bootstrap'],
    permissions: [
      PERMISSIONS.coreConfigRead,
      PERMISSIONS.coreHealthAuthenticatedRead,
      PERMISSIONS.coreIdempotencyTestWrite,
    ],
    scopes: { warehouseIds: [] },
    sourceApp: 'npp-core-api',
  });
}

export function createRequestContext({ config, principal = createAnonymousPrincipal(), requestId = createRequestId('req'), receivedAt = new Date().toISOString() }) {
  const normalizedPrincipal = normalizePrincipal(principal);
  return Object.freeze({
    installationId: config.installationId,
    actorId: normalizedPrincipal.actorId,
    employeeId: normalizedPrincipal.employeeId,
    roles: normalizedPrincipal.roles,
    permissions: normalizedPrincipal.permissions,
    scopes: normalizedPrincipal.scopes,
    requestId,
    sourceApp: normalizedPrincipal.sourceApp,
    receivedAt,
    authContext: buildAuthContext({
      requestId,
      installationId: config.installationId,
      actorId: normalizedPrincipal.actorId,
      employeeId: normalizedPrincipal.employeeId,
      roles: normalizedPrincipal.roles,
      permissions: normalizedPrincipal.permissions,
      scopes: normalizedPrincipal.scopes,
      sourceApp: normalizedPrincipal.sourceApp,
      receivedAt,
    }),
  });
}

export function authenticateRequest(req, config) {
  const candidate = extractBearerToken(req.headers.authorization);
  if (!candidate || !tokenMatches(candidate, config.backendApiToken)) {
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

  if (!Array.isArray(requestContext?.permissions) || !requestContext.permissions.includes(permission)) {
    return { ok: false, code: 'FORBIDDEN', statusCode: 403 };
  }

  return { ok: true };
}

export function safeRequestContext(requestContext) {
  return Object.freeze({
    actorId: requestContext.actorId,
    employeeId: requestContext.employeeId,
    installationId: requestContext.installationId,
    roles: [...requestContext.roles],
    permissions: [...requestContext.permissions],
    scopes: {
      branchIds: [...requestContext.scopes.branchIds],
      warehouseIds: [...requestContext.scopes.warehouseIds],
      territoryIds: [...requestContext.scopes.territoryIds],
    },
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    receivedAt: requestContext.receivedAt,
  });
}
