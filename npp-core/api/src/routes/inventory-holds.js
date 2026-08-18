import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { loadWarehouseBusinessHoldBreakdown } from '../services/inventory-business-holds.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function apiError(code, message, statusCode, details = {}) {
  return { code, message, details, retryable: false, statusCode };
}

function writeError(res, options, error) {
  sendError(res, error, options.requestId, options.receivedAt);
}

function writeSuccess(res, options, data) {
  sendJson(
    res,
    200,
    createSuccessEnvelope(data, options.requestId, options.receivedAt),
    options.requestId,
  );
}

function authorizeRead(req, res, options) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    writeError(res, options, apiError('UNAUTHORIZED', 'Authorization required', 401));
    return null;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  const allowed = [
    options.PERMISSIONS.coreFulfillmentRead,
    options.PERMISSIONS.coreReportingInventoryRead,
  ].some((permission) => permission && options.authorize(requestContext, permission).ok);
  if (!allowed) {
    writeError(res, options, apiError('PERMISSION_DENIED', 'Permission denied', 403));
    return null;
  }
  return requestContext;
}

function warehouseAllowed(requestContext, warehouseId) {
  if (Array.isArray(requestContext.scopes?.warehouseIds)
      && requestContext.scopes.warehouseIds.includes(warehouseId)) return true;
  return Array.isArray(requestContext.roles) && requestContext.roles.includes('bootstrap');
}

export async function handleInventoryHoldRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  if (url.pathname !== '/api/inventory/holds') return false;
  const method = String(req.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    writeError(res, options, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', 405));
    return true;
  }

  const requestContext = authorizeRead(req, res, options);
  if (!requestContext) return true;
  const warehouseId = String(url.searchParams.get('warehouseId') ?? '').trim();
  const baseVariantId = String(url.searchParams.get('baseVariantId') ?? '').trim();
  const excludeSalesOrderId = String(url.searchParams.get('excludeSalesOrderId') ?? '').trim() || null;
  if (!UUID_PATTERN.test(warehouseId) || !UUID_PATTERN.test(baseVariantId)
      || (excludeSalesOrderId && !UUID_PATTERN.test(excludeSalesOrderId))) {
    writeError(res, options, apiError(
      'INVALID_HOLD_SCOPE',
      'Phạm vi xem hàng đang giữ không hợp lệ.',
      400,
    ));
    return true;
  }
  if (!warehouseAllowed(requestContext, warehouseId)) {
    writeError(res, options, apiError('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope', 403));
    return true;
  }

  try {
    const data = await loadWarehouseBusinessHoldBreakdown(options.getPool(), {
      installationId: requestContext.installationId,
      warehouseId,
      baseVariantId,
      excludeSalesOrderId,
    });
    writeSuccess(res, options, data);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'inventory_hold_read_failed',
      requestId: options.requestId,
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    }));
    writeError(res, options, {
      ...apiError('INVENTORY_HOLD_READ_FAILED', 'Chưa tải được danh sách đơn đang giữ hàng.', 503),
      retryable: true,
    });
  }
  return true;
}
