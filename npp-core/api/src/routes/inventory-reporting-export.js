import { sendError, sendSuccess } from '../http-utils.js';
import { ensureWarehouseScopes } from './reporting-common.js';
import { handleInventoryReportingExportRoutes as handleBaseInventoryReportingExportRoutes } from './inventory-reporting-export-base.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

async function authorizeMovementExport(req, res, options, url) {
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
  const required = [options.PERMISSIONS.coreInventoryRead, options.PERMISSIONS.coreReportingExport];
  if (required.some((permission) => !permission || !options.authorize(requestContext, permission).ok)) {
    sendError(res, apiError('FORBIDDEN', 'Tài khoản hiện tại không có quyền xuất biến động kho', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }
  try {
    requestContext = await ensureWarehouseScopes(options.getPool(), requestContext);
  } catch {
    sendError(res, apiError('INVENTORY_EXPORT_SCOPE_LOOKUP_FAILED', 'Không tải được phạm vi kho', {}, true, 503), options.requestId, options.receivedAt);
    return true;
  }
  const warehouseId = String(url.searchParams.get('warehouseId') ?? '').trim().toLowerCase();
  const allowed = Array.isArray(requestContext.scopes?.warehouseIds)
    ? requestContext.scopes.warehouseIds.map((value) => String(value).trim().toLowerCase())
    : [];
  if (!warehouseId || !allowed.includes(warehouseId)) {
    sendError(res, apiError('WAREHOUSE_SCOPE_DENIED', 'Kho không thuộc phạm vi được cấp', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }
  res.setHeader('Cache-Control', 'no-store');
  sendSuccess(res, { authorized: true }, options.requestId, options.receivedAt);
  return true;
}

export async function handleInventoryReportingExportRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/api/inventory/reporting-export') return false;
  if (url.searchParams.get('authorizeMovement') === '1') {
    if (String(req.method ?? 'GET').toUpperCase() !== 'GET') {
      sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
      return true;
    }
    return authorizeMovementExport(req, res, options, url);
  }
  return handleBaseInventoryReportingExportRoutes(req, res, options);
}
