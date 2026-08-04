import { buildAuthContext, extractBearerToken, tokenMatches } from '@npp/auth-context';
import { createRequestId } from '@npp/shared-utils';
import { PERMISSION_REGISTRY, PERMISSIONS } from './access/permissions.js';

export { PERMISSIONS } from './access/permissions.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  return normalizePrincipal({ actorId: 'system:anonymous', roles: ['anonymous'], permissions: [], sourceApp: 'npp-core-api' });
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
      PERMISSIONS.coreCustomerRead,
      PERMISSIONS.coreCustomerWrite,
      PERMISSIONS.coreSupplierRead,
      PERMISSIONS.coreSupplierWrite,
      PERMISSIONS.coreProductRead,
      PERMISSIONS.coreProductWrite,
      PERMISSIONS.corePriceRead,
      PERMISSIONS.corePriceWrite,
      PERMISSIONS.coreDocumentNumberRead,
      PERMISSIONS.coreDocumentNumberWrite,
      PERMISSIONS.coreInventoryRead,
      PERMISSIONS.coreInventoryPost,
      PERMISSIONS.coreInventoryReverse,
      PERMISSIONS.coreEmployeeRead,
      PERMISSIONS.coreEmployeeWrite,
      PERMISSIONS.coreUserRead,
      PERMISSIONS.coreUserWrite,
      PERMISSIONS.coreUserRoleWrite,
      PERMISSIONS.corePermissionRead,
      PERMISSIONS.coreRoleRead,
      PERMISSIONS.coreRoleWrite,
      PERMISSIONS.coreInventoryTrackingPolicyRead,
      PERMISSIONS.coreInventoryTrackingPolicyManage,
      PERMISSIONS.coreInventoryLotRead,
      PERMISSIONS.coreInventoryLotManage,
      PERMISSIONS.coreInventoryOpeningBalanceImport,
      PERMISSIONS.corePurchaseOrderRead,
      PERMISSIONS.corePurchaseOrderCreate,
      PERMISSIONS.corePurchaseOrderUpdate,
      PERMISSIONS.corePurchaseOrderSubmit,
      PERMISSIONS.corePurchaseOrderApprove,
      PERMISSIONS.corePurchaseOrderCancel,
      PERMISSIONS.coreSupplierPurchasePriceRead,
      PERMISSIONS.coreSupplierPurchasePriceManage,
      PERMISSIONS.corePurchaseOrderPriceRead,
      PERMISSIONS.corePurchaseOrderPriceOverride,
      PERMISSIONS.coreGoodsReceiptRead,
      PERMISSIONS.coreGoodsReceiptCreate,
      PERMISSIONS.coreGoodsReceiptUpdate,
      PERMISSIONS.coreGoodsReceiptPost,
      PERMISSIONS.coreGoodsReceiptReverse,
      PERMISSIONS.coreGoodsReceiptVariance,
      PERMISSIONS.coreSupplierReturnRead,
      PERMISSIONS.coreSupplierReturnCreate,
      PERMISSIONS.coreSupplierReturnUpdate,
      PERMISSIONS.coreSupplierReturnSubmit,
      PERMISSIONS.coreSupplierReturnApprove,
      PERMISSIONS.coreSupplierReturnCancel,
      PERMISSIONS.coreSupplierReturnPost,
      PERMISSIONS.coreSupplierReturnReverse,
      PERMISSIONS.corePayableRead,
      PERMISSIONS.coreSupplierPaymentRead,
      PERMISSIONS.coreSupplierPaymentCreate,
      PERMISSIONS.coreSupplierPaymentReverse,
      PERMISSIONS.corePayableAllocationCreate,
      PERMISSIONS.corePayableAllocationReverse,
      PERMISSIONS.coreSalesOrderRead,
      PERMISSIONS.coreSalesOrderCreate,
      PERMISSIONS.coreSalesOrderUpdateDraft,
      PERMISSIONS.coreSalesOrderConfirm,
      PERMISSIONS.coreSalesOrderAmend,
      PERMISSIONS.coreSalesOrderCancel,
      PERMISSIONS.coreSalesOrderPriceOverride,
      PERMISSIONS.coreSalesOrderDiscountOverride,
      PERMISSIONS.coreSalesOrderCreditOverride,
      PERMISSIONS.coreFulfillmentRead,
      PERMISSIONS.coreFulfillmentConfigureBackorder,
      PERMISSIONS.coreFulfillmentAllocate,
      PERMISSIONS.coreFulfillmentPick,
      PERMISSIONS.coreFulfillmentPack,
      PERMISSIONS.coreFulfillmentOverrideAllocationPolicy,
      PERMISSIONS.coreDeliveryOrderRead,
      PERMISSIONS.coreDeliveryOrderCreate,
      PERMISSIONS.coreDeliveryOrderConfirm,
      PERMISSIONS.coreDeliveryOrderCancel,
      PERMISSIONS.coreDeliveryOrderIssueInventory,
      PERMISSIONS.coreDeliveryOrderPickupHandover,
      PERMISSIONS.coreDeliveryOrderReverseInventoryIssue,
      PERMISSIONS.coreCustomerReturnRead,
      PERMISSIONS.coreCustomerReturnCreate,
      PERMISSIONS.coreCustomerReturnReceive,
      PERMISSIONS.coreCustomerReturnCancel,
      PERMISSIONS.coreCustomerOnboardingRead,
      PERMISSIONS.coreCustomerOnboardingSubmit,
      PERMISSIONS.coreCustomerOnboardingReview,
      PERMISSIONS.coreCustomerOnboardingApprove,
      PERMISSIONS.coreCustomerOnboardingLinkExisting,
      PERMISSIONS.coreCustomerOnboardingReject,
    ],
    sourceApp: 'npp-core-api',
  });
}

export function createMcpOnboardingPrincipal(config) {
  if (!config.mcpOnboardingApiToken) return null;
  return normalizePrincipal({
    actorId: config.mcpOnboardingActorId,
    roles: ['mcp-onboarding-service'],
    permissions: [
      PERMISSIONS.coreCustomerOnboardingRead,
      PERMISSIONS.coreCustomerOnboardingSubmit,
    ],
    sourceApp: 'mcp-plan-backend',
  });
}

export function createMcpSalesPrincipal(config) {
  if (!config.mcpSalesApiToken) return null;
  return normalizePrincipal({
    actorId: config.mcpSalesActorId,
    roles: ['mcp-sales-order-service'],
    permissions: [
      PERMISSIONS.coreProductRead,
      PERMISSIONS.coreSalesOrderRead,
      PERMISSIONS.coreSalesOrderCreate,
    ],
    scopes: {
      warehouseIds: config.mcpSalesWarehouseIds,
    },
    sourceApp: 'mcp-plan-backend',
  });
}

export function createDeliveryFrontendPrincipal(config, employeeId) {
  if (!config.deliveryFrontendApiToken || !UUID_PATTERN.test(String(employeeId ?? ''))) return null;
  return normalizePrincipal({
    actorId: `${config.deliveryFrontendActorId}:${employeeId}`,
    employeeId,
    roles: ['driver'],
    permissions: [PERMISSIONS.coreDeliveryTripDriverRead],
    scopes: {
      warehouseIds: config.deliveryFrontendWarehouseIds,
    },
    sourceApp: 'delivery-web',
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
  if (!candidate) return { ok: false, code: 'UNAUTHORIZED', statusCode: 401 };
  if (config.deliveryFrontendApiToken && tokenMatches(candidate, config.deliveryFrontendApiToken)) {
    const employeeId = String(req.headers['x-npp-delivery-employee-id'] ?? '').trim();
    const principal = createDeliveryFrontendPrincipal(config, employeeId);
    return principal
      ? { ok: true, principal }
      : { ok: false, code: 'UNAUTHORIZED', statusCode: 401 };
  }
  if (config.mcpSalesApiToken && tokenMatches(candidate, config.mcpSalesApiToken)) {
    return { ok: true, principal: createMcpSalesPrincipal(config) };
  }
  if (config.mcpOnboardingApiToken && tokenMatches(candidate, config.mcpOnboardingApiToken)) {
    return { ok: true, principal: createMcpOnboardingPrincipal(config) };
  }
  if (tokenMatches(candidate, config.backendApiToken)) {
    return { ok: true, principal: createBootstrapPrincipal(config) };
  }
  return { ok: false, code: 'UNAUTHORIZED', statusCode: 401 };
}

export function requirePermission(requestContext, permission) {
  if (!PERMISSION_REGISTRY.has(permission)) return { ok: false, code: 'FORBIDDEN', statusCode: 403 };
  if (!Array.isArray(requestContext?.permissions) || !requestContext.permissions.includes(permission)) return { ok: false, code: 'FORBIDDEN', statusCode: 403 };
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
