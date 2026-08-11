import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import {
  buildAuditRecord,
  insertAuditRecord,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import * as service from '../services/file-operations.js';
import * as productOnboardingService from '../services/product-onboarding-file.js';

const STOCKTAKE_PERMISSIONS = Object.freeze({
  read: 'core.stocktake.read',
  create: 'core.stocktake.create',
  count: 'core.stocktake.count',
});

const OFFICIAL_POST_PATHS = new Set([
  '/api/file-operations/products/export',
  '/api/file-operations/products/import',
  '/api/file-operations/pricing/export',
  '/api/file-operations/pricing/import',
  '/api/file-operations/stocktake/export',
  '/api/file-operations/stocktake/import',
  '/api/file-operations/inventory/movements/export',
  '/api/file-operations/quotation',
]);

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
    apiError(
      result.code ?? 'FILE_OPERATION_FAILED',
      result.message ?? 'File operation failed',
      result.details ?? {},
      Boolean(result.retryable),
      statusFor(result),
    ),
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
  if (pathname === '/api/file-operations/products/export') return [permissions.coreProductRead, permissions.coreInventoryTrackingPolicyRead];
  if (pathname === '/api/file-operations/products/import') return [permissions.coreProductWrite, permissions.coreInventoryTrackingPolicyManage];
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
    authContext: requestContext.authContext
      ? Object.freeze({ ...requestContext.authContext, scopes })
      : requestContext.authContext,
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
    return {
      ok: false,
      code: error.code ?? 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must use 1-128 safe characters',
    };
  }
}

function sanitizeOfficialResult(pathname, result) {
  if (pathname !== '/api/file-operations/stocktake/export' || !result?.ok) return result;
  const columns = Array.isArray(result.columns)
    ? result.columns.filter((column) => column !== 'systemQuantity')
    : result.columns;
  const rows = Array.isArray(result.rows)
    ? result.rows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const { systemQuantity: _hidden, ...safe } = row;
      return Object.freeze(safe);
    })
    : result.rows;
  return Object.freeze({ ...result, columns: columns ? Object.freeze(columns) : columns, rows: rows ? Object.freeze(rows) : rows });
}

function auditSummary(pathname, result) {
  const rowCount = Array.isArray(result.rows)
    ? result.rows.length
    : Number.isInteger(result.import?.totalItems)
      ? result.import.totalItems
      : Number.isInteger(result.import?.imported)
        ? result.import.imported
        : null;
  return Object.freeze({
    jobId: result.jobId ?? null,
    operation: pathname.replace('/api/file-operations/', ''),
    rowCount,
    stocktakeId: result.stocktake?.id ?? null,
    stocktakeStatus: result.stocktake?.status ?? null,
  });
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
        const transaction = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const rawResult = await operation(client);
            if (!rawResult.ok) return { failed: rawResult, skipAudit: true };
            const result = sanitizeOfficialResult(pathname, rawResult);
            const summary = auditSummary(pathname, result);
            await insertAuditRecord(client, buildAuditRecord({
              requestContext,
              action: 'file_operation',
              resourceType: 'import_export_job',
              resourceId: result.jobId ?? options.requestId,
              afterData: summary,
              metadata: { pathname },
            }));
            return { result };
          },
        });
        if (transaction.failed) {
          return {
            statusCode: statusFor(transaction.failed),
            contentType: 'application/json',
            requestId: options.requestId,
            body: {
              error: {
                code: transaction.failed.code,
                message: transaction.failed.message,
                retryable: Boolean(transaction.failed.retryable),
                details: transaction.failed.details ?? {},
              },
              requestId: options.requestId,
              receivedAt: options.receivedAt,
            },
          };
        }
        const { ok: _ok, ...data } = transaction.result;
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
    sendError(
      res,
      apiError('FILE_OPERATION_STORAGE_UNAVAILABLE', 'File operation storage is temporarily unavailable', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}

export async function handleFileOperationRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/file-operations/')) return false;
  const method = String(req.method || 'GET').toUpperCase();
  const isMovementRead = pathname === '/api/file-operations/inventory/movements';
  if (!isMovementRead && !OFFICIAL_POST_PATHS.has(pathname)) return false;
  if (isMovementRead ? method !== 'GET' : method !== 'POST') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  const requestContext = await authenticateAndAuthorize(req, res, options, pathname, method);
  if (!requestContext) return true;

  if (isMovementRead) {
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

  const operations = {
    '/api/file-operations/products/export': (client) => productOnboardingService.exportProductOnboardingRows(client, {
      requestContext,
      format: payload?.format,
    }),
    '/api/file-operations/products/import': (client) => productOnboardingService.importProductOnboardingRows(client, {
      requestContext,
      payload,
    }),
    '/api/file-operations/pricing/export': (client) => service.exportPricingRows(client, {
      requestContext,
      format: payload?.format,
    }),
    '/api/file-operations/pricing/import': (client) => service.importPricingRows(client, {
      requestContext,
      payload,
    }),
    '/api/file-operations/stocktake/export': (client) => service.exportStocktakeRows(client, {
      requestContext,
      warehouseId: payload?.warehouseId,
      format: payload?.format,
    }),
    '/api/file-operations/stocktake/import': (client) => service.importStocktakeRows(client, {
      requestContext,
      payload,
    }),
    '/api/file-operations/inventory/movements/export': (client) => service.listMovementRows(client, {
      requestContext,
      filters: payload?.filters ?? {},
      format: payload?.format,
      recordExport: true,
    }),
    '/api/file-operations/quotation': (client) => service.buildQuotationRows(client, {
      requestContext,
      payload,
    }),
  };

  await executeOfficialOperation(req, res, options, {
    requestContext,
    pathname,
    payload,
    operation: operations[pathname],
  });
  return true;
}
