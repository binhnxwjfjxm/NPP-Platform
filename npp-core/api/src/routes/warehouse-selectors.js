import { sendError, sendSuccess } from '../http-utils.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
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
    authContext: requestContext.authContext
      ? Object.freeze({ ...requestContext.authContext, scopes })
      : requestContext.authContext,
  });
}

async function ensureBootstrapWarehouseScopes(client, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) return requestContext;
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) return requestContext;
  const warehouses = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: true,
    limit: 10000,
    offset: 0,
  });
  return withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
}

function permissionFor(pathname, options) {
  if (pathname === '/api/logistics/warehouses') return options.PERMISSIONS.coreDeliveryTripRead;
  if (pathname === '/api/inventory/stocktakes/warehouses') return 'core.stocktake.read';
  return null;
}

export function selectScopedWarehouseOptions(rows, warehouseIds) {
  const allowedIds = new Set(Array.isArray(warehouseIds) ? warehouseIds : []);
  return rows
    .filter((warehouse) => allowedIds.has(warehouse.id))
    .map((warehouse) => ({ id: warehouse.id, code: warehouse.code, name: warehouse.name }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

export async function handleWarehouseSelectorRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const permission = permissionFor(pathname, options);
  if (!permission) return false;

  if (String(req.method ?? 'GET').toUpperCase() !== 'GET') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }

  let requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, permission).ok) {
    sendError(res, apiError('PERMISSION_DENIED', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  try {
    requestContext = await ensureBootstrapWarehouseScopes(options.getPool(), requestContext);
    const rows = await warehouseRepository.listWarehousesForInstallation(options.getPool(), {
      installationId: requestContext.installationId,
      active: true,
      limit: 10000,
      offset: 0,
    });
    sendSuccess(
      res,
      selectScopedWarehouseOptions(rows, requestContext.scopes?.warehouseIds),
      options.requestId,
      options.receivedAt,
    );
  } catch {
    sendError(
      res,
      apiError('WAREHOUSE_SELECTOR_QUERY_FAILED', 'Danh sách kho tạm thời không khả dụng', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
  return true;
}
