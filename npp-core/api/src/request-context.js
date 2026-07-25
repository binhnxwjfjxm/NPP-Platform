import { buildAuthContext, extractBearerToken, tokenMatches } from '@npp/auth-context';
import { createRequestId } from '@npp/shared-utils';

export const PERMISSIONS = Object.freeze({
  coreConfigRead: 'core.config.read',
  coreHealthAuthenticatedRead: 'core.health.authenticated.read',
  coreIdempotencyTestWrite: 'core.idempotency.test.write',
  coreAuditOutboxTestWrite: 'core.audit-outbox.test.write',
  coreStorageR2TestWrite: 'core.storage.r2.test.write',
  coreOrganizationRead: 'core.organization.read',
  coreOrganizationWrite: 'core.organization.write',
  coreBranchRead: 'core.branch.read',
  coreBranchWrite: 'core.branch.write',
  coreWarehouseRead: 'core.warehouse.read',
  coreWarehouseWrite: 'core.warehouse.write',
  coreWarehouseLocationRead: 'core.warehouse.location.read',
  coreWarehouseLocationWrite: 'core.warehouse.location.write',
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
    actorId: typeof principal.actorId === 'string' && principal.actorId.trim() ? principal.actorId.trim() : 'system:anonymous',
    employeeId: typeof principal.employeeId === 'string' && principal.employeeId.trim() ? principal.employeeId.trim() : null,
    roles: frozenStrings(principal.roles),
    permissions: frozenStrings(principal.permissions),
    scopes: normalizeScopes(principal.scopes),
    sourceApp: typeof principal.sourceApp === 'string' && principal.sourceApp.trim() ? principal.sourceApp.trim() : 'npp-core-api',
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
    roles: ['bootstrap'],
    permissions: [
      PERMISSIONS.coreConfigRead,
      PERMISSIONS.coreHealthAuthenticatedRead,
      PERMISSIONS.coreIdempotencyTestWrite,
      PERMISSIONS.coreAuditOutboxTestWrite,
      PERMISSIONS.coreStorageR2TestWrite,
      PERMISSIONS.coreOrganizationRead,
      PERMISSIONS.coreOrganizationWrite,
      PERMISSIONS.coreBranchRead,
      PERMISSIONS.coreBranchWrite,
      PERMISSIONS.coreWarehouseRead,
      PERMISSIONS.coreWarehouseWrite,
      PERMISSIONS.coreWarehouseLocationRead,
      PERMISSIONS.coreWarehouseLocationWrite,
    ],
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
  return { ok: true, principal: createBootstrapPrincipal(config) };
}

export function requirePermission(requestContext, permission) {
  if (!PERMISSION_REGISTRY.has(permission)) return { ok: false, code: 'FORBIDDEN', statusCode: 403 };
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
