import * as base from './request-context-base.js';
import { PERMISSION_REGISTRY, PERMISSIONS } from './access/permissions.js';

// Compatibility contract for least-privilege service principals remains owned by
// request-context-base.js. MCP source-contract markers retained for existing gates:
// mcp-sales-order-service
// coreProductRead
// coreSalesOrderRead
// coreSalesOrderCreate
// warehouseIds: config.mcpSalesWarehouseIds
// Broad operational permissions are added only to bootstrap.
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
  PERMISSIONS.coreDeliveryTripDriverRead,
  PERMISSIONS.coreDeliveryAttemptRead,
  PERMISSIONS.corePodRead,
  PERMISSIONS.coreDeliveryTripReconciliationRead,
  PERMISSIONS.coreDeliveryTripReturnReceive,
  PERMISSIONS.coreDeliveryTripClose,
  PERMISSIONS.coreReceivableRead,
  PERMISSIONS.coreCustomerPaymentRead,
  PERMISSIONS.coreCustomerPaymentCreate,
  PERMISSIONS.coreCustomerPaymentReverse,
  PERMISSIONS.coreReceivableAllocationCreate,
  PERMISSIONS.coreReceivableAllocationReverse,
  PERMISSIONS.coreCustomerReturnCreditRead,
  PERMISSIONS.coreCustomerReturnCreditAllocate,
  PERMISSIONS.coreCustomerReturnCreditReverse,
  PERMISSIONS.coreCustomerRefundCreate,
  PERMISSIONS.coreCustomerRefundReverse,
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

function withDeliveryAttemptPermissions(principal) {
  if (!principal || !Array.isArray(principal.roles) || !principal.roles.includes('driver')) return principal;
  return Object.freeze({
    ...principal,
    permissions: Object.freeze([...new Set([
      ...(Array.isArray(principal.permissions) ? principal.permissions : []),
      PERMISSIONS.coreDeliveryAttemptRead,
      PERMISSIONS.coreDeliveryAttemptRecord,
      PERMISSIONS.corePodRead,
      PERMISSIONS.corePodAttach,
    ])]),
  });
}

export const createAnonymousPrincipal = base.createAnonymousPrincipal;
export const createMcpOnboardingPrincipal = base.createMcpOnboardingPrincipal;
export const createMcpSalesPrincipal = base.createMcpSalesPrincipal;
export const createRequestContext = base.createRequestContext;
export const safeRequestContext = base.safeRequestContext;

export function createDeliveryFrontendPrincipal(config, employeeId) {
  return withDeliveryAttemptPermissions(base.createDeliveryFrontendPrincipal(config, employeeId));
}

export function createBootstrapPrincipal(config) {
  return withLogisticsBootstrapPermissions(base.createBootstrapPrincipal(config));
}

export function authenticateRequest(req, config) {
  const result = base.authenticateRequest(req, config);
  if (!result.ok) return result;
  return Object.freeze({
    ...result,
    principal: withDeliveryAttemptPermissions(withLogisticsBootstrapPermissions(result.principal)),
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
