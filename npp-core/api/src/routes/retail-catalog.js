import { readJsonBody } from '../idempotency.js';
import { sendError, sendSuccess } from '../http-utils.js';
import * as retailCatalogService from '../services/retail-catalog.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (['SALES_ORDER_NOT_FOUND', 'VARIANT_NOT_FOUND', 'SALES_CHANNEL_NOT_FOUND'].includes(code)) return 404;
  if (['BASE_PRICE_NOT_FOUND', 'VARIANT_NOT_PRICEABLE'].includes(code)) return 409;
  return 400;
}

function parseInteger(value, fallback, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Giá trị phải là số nguyên từ 0 đến ${max}`,
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
    authContext: requestContext.authContext ? Object.freeze({ ...requestContext.authContext, scopes }) : requestContext.authContext,
  });
}

async function ensureWarehouseScopes(options, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) {
    return requestContext;
  }
  if (!requestContext.roles?.includes('bootstrap')) return requestContext;
  const warehouses = await warehouseRepository.listWarehousesForInstallation(options.getPool(), {
    installationId: requestContext.installationId,
    active: undefined,
    limit: 10000,
    offset: 0,
  });
  return withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
}

async function authorize(req, res, options, permission) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Cần đăng nhập để tiếp tục', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, permission).ok) {
    sendError(res, apiError('FORBIDDEN', 'Tài khoản chưa được cấp quyền thực hiện thao tác này', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return ensureWarehouseScopes(options, requestContext);
}

function sendServiceError(res, result, options) {
  sendError(res, apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)), options.requestId, options.receivedAt);
}

export async function handleRetailCatalogRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/retail/')) return false;

  if (url.pathname === '/api/retail/products' && req.method === 'GET') {
    const context = await authorize(req, res, options, options.PERMISSIONS.coreProductRead);
    if (!context) return true;
    try {
      const result = await retailCatalogService.searchRetailCatalog(options.getPool(), {
        requestContext: context,
        search: url.searchParams.get('search') ?? '',
        categoryId: url.searchParams.get('categoryId'),
        limit: parseInteger(url.searchParams.get('limit'), 30, 50),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.products, options.requestId, options.receivedAt);
    } catch (error) {
      sendError(res, apiError(error.code ?? 'RETAIL_CATALOG_UNAVAILABLE', error.publicMessage ?? 'Chưa thể tải danh mục sản phẩm', {}, true, error.statusCode ?? 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (url.pathname === '/api/retail/price' && req.method === 'POST') {
    const context = await authorize(req, res, options, options.PERMISSIONS.corePriceRead);
    if (!context) return true;
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendError(res, apiError(error.code ?? 'INVALID_INPUT', error.publicMessage ?? 'Nội dung yêu cầu không hợp lệ', {}, false, error.statusCode ?? 400), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const result = await retailCatalogService.resolveRetailPrice(options.getPool(), {
        requestContext: context,
        payload,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.resolution, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('RETAIL_PRICE_UNAVAILABLE', 'Chưa thể tính giá bán', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  const availability = url.pathname.match(/^\/api\/retail\/sales-orders\/([^/]+)\/availability$/);
  if (availability && req.method === 'GET') {
    const context = await authorize(req, res, options, options.PERMISSIONS.coreSalesOrderRead);
    if (!context) return true;
    try {
      const result = await retailCatalogService.getRetailOrderAvailability(options.getPool(), {
        requestContext: context,
        salesOrderId: availability[1],
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.availability, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('RETAIL_AVAILABILITY_UNAVAILABLE', 'Chưa thể tải Khả dụng của đơn', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (!['GET', 'POST'].includes(req.method ?? '')) {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức yêu cầu không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }
  sendError(res, apiError('NOT_FOUND', 'Không tìm thấy chức năng yêu cầu', {}, false, 404), options.requestId, options.receivedAt);
  return true;
}
