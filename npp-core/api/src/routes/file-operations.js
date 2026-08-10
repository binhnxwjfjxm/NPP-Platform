import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import { withAuditOutboxTransaction } from '../audit-outbox.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import * as service from '../services/file-operations.js';

const STOCKTAKE_PERMISSIONS = Object.freeze({
  read: 'core.stocktake.read',
  create: 'core.stocktake.create',
  count: 'core.stocktake.count',
});

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(result) {
  if (Number.isInteger(result?.statusCode)) return result.statusCode;
  if (result?.code === 'UNAUTHORIZED') return 401;
  if (result?.code === 'FORBIDDEN' || result?.code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (String(result?.code ?? '').endsWith('_NOT_FOUND')) return 404;
  if (String(result?.code ?? '').includes('CONFLICT') || String(result?.code ?? '').includes('DUPLICATE')) return 409;
  return 400;
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(result.code ?? 'FILE_OPERATION_FAILED', result.message ?? 'File operation failed', result.details ?? {}, Boolean(result.retryable), statusFor(result)),
    options.requestId,
    options.receivedAt,
  );
}

async function readPayload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      apiError(error.code, error.publicMessage, {}, false, error.statusCode),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
}

function requiredPermissions(pathname, method, permissions) {
  if (method === 'GET' && pathname === '/api/file-operations/inventory/movements') return [permissions.coreInventoryRead];
  if (pathname === '/api/file-operations/products/export') return [permissions.coreProductRead];
  if (pathname === '/api/file-operations/products/import') return [permissions.coreProductWrite];
  if (pathname === '/api/file-operations/pricing/export') return [permissions.corePriceRead];
  if (pathname === '/api/file-operations/pricing/import') return [permissions.corePriceWrite];
  if (pathname === '/api/file-operations/stocktake/export') return [STOCKTAKE_PERMISSIONS.read];
  if (pathname === '/api/file-operations/stocktake/import') return [STOCKTAKE_PERMISSIONS.create, STOCKTAKE_PERMISSIONS.count];
  if (pathname === '/api/file-operations/inventory/movements/export') return [permissions.coreInventoryRead];
  if (pathname === '/api/file-operations/quotation') return [permissions.coreProductRead, permissions.corePriceRead];
  return [];
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

async function ensureWarehouseScopes(options, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) return requestContext;
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) return requestContext;
  const warehouses = await warehouseRepository.listWarehousesForInstallation(options.getPool(), {
    installationId: requestContext.installationId,
    active: undefined,
    limit: 10000,
    offset: 0,
  });
  return withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
}

async function authenticateAndAuthorize(req, res, options, pathname, method) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  let requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  const permissions = requiredPermissions(pathname, method, options.PERMISSIONS);
  if (!permissions.length || permissions.some((permission) => !options.authorize(requestContext, permission).ok)) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  if (pathname.includes('/stocktake/') || pathname.includes('/inventory/movements')) {
    requestContext = await ensureWarehouseScopes(options, requestContext);
  }
  return requestContext;
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
    return { ok: true, key };
  } catch (error) {
    return { ok: false, code: error.code ?? 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must use 1-128 safe characters' };
  }
}

async function executeOfficialOperation(req, res, options, { requestContext, pathname, payload, operation }) {
  const key = requireIdempotency(req);
  if (!key.ok) {
    sendError(res, apiError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
    return;
  }
  try {
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore,
      req,
      requestContext,
      requestId: options.requestId,
      receivedAt: options.receivedAt,
      route: `POST ${pathname}`,
      payload,
      onProcess: async () => {
        const result = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: (client) => operation(client),
        });
        if (!result.ok) {
          return {
            statusCode: statusFor(result),
            contentType: 'application/json',
            requestId: options.requestId,
            body: {
              error: {
                code: result.code,
                message: result.message,
                retryable: Boolean(result.retryable),
                details: result.details ?? {},
              },
              requestId: options.requestId,
              receivedAt: options.receivedAt,
            },
          };
        }
        const { ok: _ok, ...data } = result;
        return {
          statusCode: 200,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(data, options.requestId, options.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('FILE_OPERATION_STORAGE_UNAVAILABLE', 'File operation storage is temporarily unavailable', {}, true, 503), options.requestId, options.receivedAt);
  }
}

export async function handleFileOperationRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/file-operations/')) return false;
  const method = String(req.method || 'GET').toUpperCase();
  const known = new Set([
    '/api/file-operations/products/export',
    '/api/file-operations/products/import',
    '/api/file-operations/pricing/export',
    '/api/file-operations/pricing/import',
    '/api/file-operations/stocktake/export',
    '/api/file-operations/stocktake/import',
    '/api/file-operations/inventory/movements',
    '/api/file-operations/inventory/movements/export',
    '/api/file-operations/quotation',
  ]);
  if (!known.has(pathname)) return false;
  if (pathname === '/api/file-operations/inventory/movements' ? method !== 'GET' : method !== 'POST') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  const requestContext = await authenticateAndAuthorize(req, res, options, pathname, method);
  if (!requestContext) return true;

  if (method === 'GET' && pathname === '/api/file-operations/inventory/movements') {
    try {
      const result = await service.listMovementRows(options.getPool(), {
        requestContext,
        filters: {
          sku: url.searchParams.get('sku'),
          warehouseId: url.searchParams.get('warehouseId'),
          limit: url.searchParams.get('limit'),
        },
      });
      if (!result.ok) return sendServiceError(res, result, options), true;
      sendSuccess(res, { columns: result.columns, rows: result.rows }, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('FILE_OPERATION_STORAGE_UNAVAILABLE', 'Movement timeline is temporarily unavailable', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  const payload = await readPayload(req, res, options);
  if (payload === null) return true;

  if (pathname === '/api/file-operations/products/export') {
    await executeOfficialOperation(req, res, options, {
      requestContext, pathname, payload,
      operation: (client) => service.exportProductRows(client, { requestContext, format: payload?.format }),
    });
    return true;
  }
  if (pathname === '/api/file-operations/products/import') {
    await executeOfficialOperation(req, res, options, {
      requestContext, pathname, payload,
      operation: (client) => service.importProductRows(client, { requestContext, payload }),
    });
    return true;
  }
  if (pathname === '/api/file-operations/pricing/export') {
    await executeOfficialOperation(req, res, options, {
      requestContext, pathname, payload,
      operation: (client) => service.exportPricingRows(client, { requestContext, format: payload?.format }),
    });
    return true;
  }
  if (pathname === '/api/file-operations/pricing/import') {
    await executeOfficialOperation(req, res, options, {
      requestContext, pathname, payload,
      operation: (client) => service.importPricingRows(client, { requestContext, payload }),
    });
    return true;
  }
  if (pathname === '/api/file-operations/stocktake/export') {
    await executeOfficialOperation(req, res, options, {
      requestContext, pathname, payload,
      operation: (client) => service.exportStocktakeRows(client, {
        requestContext, warehouseId: payload?.warehouseId, format: payload?.format,
      }),
    });
    return true;
  }
  if (pathname === '/api/file-operations/stocktake/import') {
    await executeOfficialOperation(req, res, options, {
      requestContext, pathname, payload,
      operation: (client) => service.importStocktakeRows(client, { requestContext, payload }),
    });
    return true;
  }
  if (pathname === '/api/file-operations/inventory/movements/export') {
    await executeOfficialOperation(req, res, options, {
      requestContext, pathname, payload,
      operation: (client) => service.listMovementRows(client, {
        requestContext,
        filters: payload?.filters ?? {},
        format: payload?.format,
        recordExport: true,
      }),
    });
    return true;
  }
  if (pathname === '/api/file-operations/quotation') {
    await executeOfficialOperation(req, res, options, {
      requestContext, pathname, payload,
      operation: (client) => service.buildQuotationRows(client, { requestContext, payload }),
    });
    return true;
  }
  return false;
}
