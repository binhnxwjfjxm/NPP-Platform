import * as base from './request-context-base.js';
import { PERMISSION_REGISTRY, PERMISSIONS } from './access/permissions.js';

// Compatibility contract for the least-privilege MCP Sales principal remains owned by
// request-context-base.js: mcp-sales-order-service, coreProductRead,
// coreSalesOrderRead, coreSalesOrderCreate, warehouseIds: config.mcpSalesWarehouseIds.
// Logistics permissions are added only to the existing bootstrap principal below.
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
  PERMISSIONS.coreDeliveryTripDispatch,
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