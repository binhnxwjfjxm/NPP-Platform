import * as base from './request-context-base.js';
import { PERMISSION_REGISTRY, PERMISSIONS } from './access/permissions.js';

// Compatibility marker: mcp-sales-order-service and its least-privilege principal
// remain owned by request-context-base.js. Logistics permissions are bootstrap-only here.
const LOGISTICS_BOOTSTRAP_PERMISSIONS = Object.freeze([
  PERMISSIONS.coreLogisticsRouteRead,
  PERMISSIONS.coreLogisticsRouteManage,
  PERMISSIONS.coreVehicleRead,
  PERMISSIONS.coreVehicleManage,
  PERMISSIONS.coreDriverProfileRead,
  PERMISSIONS.coreDriverProfileManage,
  PERMISSIONS.coreDeliveryTripRead,
  PERMISSIONS.coreDeliveryTripCreate,
  PERMISSIONS.coreDeliveryTripPlan,
  PERMISSIONS.coreDeliveryTripAssign,
  PERMISSIONS.coreDeliveryTripLock,
]);

function withLogisticsBootstrapPermissions(principal) {
  if (!principal || !Array.isArray(principal.roles) || !principal.roles.includes('bootstrap')) return principal;
  return Object.freeze({
    ...principal,
    permissions: Object.freeze([...new Set([
      ...(Array.isArray(principal.permissions) ? principal.permissions : []),
      ...LOGISTICS_BOOTSTRAP_PERMISSIONS,
    ])]),
  });
}

export const createAnonymousPrincipal = base.createAnonymousPrincipal;
export const createMcpOnboardingPrincipal = base.createMcpOnboardingPrincipal;
export const createMcpSalesPrincipal = base.createMcpSalesPrincipal;
export const createRequestContext = base.createRequestContext;
export const safeRequestContext = base.safeRequestContext;

export function createBootstrapPrincipal(config) {
  return withLogisticsBootstrapPermissions(base.createBootstrapPrincipal(config));
}

export function authenticateRequest(req, config) {
  const result = base.authenticateRequest(req, config);
  if (!result.ok) return result;
  return Object.freeze({
    ...result,
    principal: withLogisticsBootstrapPermissions(result.principal),
  });
}

export function requirePermission(requestContext, permission) {
  if (!PERMISSION_REGISTRY.has(permission)) return { ok: false, code: 'FORBIDDEN', statusCode: 403 };
  if (!Array.isArray(requestContext?.permissions) || !requestContext.permissions.includes(permission)) {
    return { ok: false, code: 'FORBIDDEN', statusCode: 403 };
  }
  return { ok: true };
}

export { PERMISSIONS };
