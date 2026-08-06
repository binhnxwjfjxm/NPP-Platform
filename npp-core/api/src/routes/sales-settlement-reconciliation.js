import { sendError, sendSuccess } from '../http-utils.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import { getSalesSettlementReconciliation } from '../services/sales-settlement-reconciliation.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_FAILED')) return 503;
  return 400;
}

function withWarehouseScopes(requestContext, warehouseIds) {
  const scopes = Object.freeze({
    branchIds: Object.freeze([...(requestContext.scopes?.branchIds ?? [])]),
    warehouseIds: Object.freeze(warehouseIds),
    territoryIds: Object.freeze([...(requestContext.scopes?.territoryIds ?? [])]),
  });
  return Object.freeze({
    ...requestContext,
    scopes,
    authContext: requestContext.authContext ? Object.freeze({ ...requestContext.authContext, scopes }) : requestContext.authContext,
  });
}

async function authenticateAndAuthorize(req, res, options) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, options.PERMISSIONS.coreReceivableRead).ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length) return requestContext;
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) {
    sendError(res, apiError('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  const warehouses = await warehouseRepository.listWarehousesForInstallation(options.getPool(), {
    installationId: requestContext.installationId,
    active: undefined,
    limit: 10000,
    offset: 0,
  });
  const scoped = withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
  if (!scoped.scopes.warehouseIds.length) {
    sendError(res, apiError('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return scoped;
}

export async function handleSalesSettlementReconciliationRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  if (url.pathname !== '/api/accounting/reconciliation') return false;
  const method = String(req.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Only GET is supported for reconciliation', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }
  const requestContext = await authenticateAndAuthorize(req, res, options);
  if (!requestContext) return true;
  try {
    const result = await getSalesSettlementReconciliation(options.getPool(), {
      requestContext,
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      search: url.searchParams.get('search'),
      status: url.searchParams.get('status'),
      limit: url.searchParams.get('limit'),
    });
    if (!result.ok) {
      sendError(res, apiError(result.code, result.message, result.details ?? {}, false, statusFor(result.code)), options.requestId, options.receivedAt);
    } else {
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(res, result.report, options.requestId, options.receivedAt);
    }
  } catch (error) {
    sendError(res, apiError(
      error?.code ?? 'SALES_SETTLEMENT_RECONCILIATION_FAILED',
      'Không tải được đối soát bán hàng và COD',
      {},
      true,
      error?.statusCode ?? 503,
    ), options.requestId, options.receivedAt);
  }
  return true;
}
