import { sendError, sendSuccess } from '../http-utils.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import * as payableService from '../services/payable.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('CONFLICT') || code.includes('MISMATCH')) return 409;
  return 400;
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)),
    options.requestId,
    options.receivedAt,
  );
}

function parseInteger(value, fallback, min, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Query parameter must be an integer between ${min} and ${max}`,
      statusCode: 400,
    });
  }
  return parsed;
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

async function ensureWarehouseScopes(client, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) {
    return requestContext;
  }
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) {
    return requestContext;
  }
  const warehouses = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: undefined,
    limit: 10000,
    offset: 0,
  });
  return withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
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
  if (!options.authorize(requestContext, options.PERMISSIONS.corePayableRead).ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  const scoped = await ensureWarehouseScopes(options.getPool(), requestContext);
  if (!Array.isArray(scoped.scopes?.warehouseIds) || scoped.scopes.warehouseIds.length === 0) {
    sendError(res, apiError('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return scoped;
}

export async function handlePayableRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  if (pathname !== '/api/payables' && !pathname.startsWith('/api/payables/')) return false;
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  const requestContext = await authenticateAndAuthorize(req, res, options);
  if (!requestContext) return true;

  try {
    if (pathname === '/api/payables') {
      const result = await payableService.listPayableDocuments(options.getPool(), {
        requestContext,
        supplierId: url.searchParams.get('supplierId'),
        warehouseId: url.searchParams.get('warehouseId'),
        status: url.searchParams.get('status'),
        direction: url.searchParams.get('direction'),
        dueBefore: url.searchParams.get('dueBefore'),
        search: url.searchParams.get('search'),
        limit: parseInteger(url.searchParams.get('limit'), 100, 1, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 0, 100000),
      });
      if (!result.ok) {
        sendServiceError(res, result, options);
        return true;
      }
      sendSuccess(res, result.payableDocuments, options.requestId, options.receivedAt);
      return true;
    }

    if (pathname === '/api/payables/balances') {
      const result = await payableService.listSupplierPayableBalances(options.getPool(), {
        requestContext,
        supplierId: url.searchParams.get('supplierId'),
        search: url.searchParams.get('search'),
        limit: parseInteger(url.searchParams.get('limit'), 100, 1, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 0, 100000),
      });
      if (!result.ok) {
        sendServiceError(res, result, options);
        return true;
      }
      sendSuccess(res, result.balances, options.requestId, options.receivedAt);
      return true;
    }

    const detail = pathname.match(/^\/api\/payables\/([^/]+)$/);
    if (detail) {
      const result = await payableService.getPayableDocument(options.getPool(), {
        requestContext,
        id: detail[1],
      });
      if (!result.ok) {
        sendServiceError(res, result, options);
        return true;
      }
      sendSuccess(res, result.payableDocument, options.requestId, options.receivedAt);
      return true;
    }
  } catch (error) {
    sendError(
      res,
      apiError(
        error?.code ?? 'PAYABLE_READ_FAILED',
        error?.publicMessage ?? 'Payable read failed',
        {},
        false,
        error?.statusCode ?? 500,
      ),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  sendError(res, apiError('NOT_FOUND', 'Route not found', {}, false, 404), options.requestId, options.receivedAt);
  return true;
}
