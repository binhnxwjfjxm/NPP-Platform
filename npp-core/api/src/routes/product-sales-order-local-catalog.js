import { sendError, sendSuccess } from '../http-utils.js';
import * as catalogService from '../services/sales-order-local-catalog.js';

const PATH = '/api/products/sales-order-local-catalog';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

export async function handleProductSalesOrderLocalCatalogRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  if (url.pathname !== PATH) return false;
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
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  const permission = options.authorize(requestContext, options.PERMISSIONS.coreSalesOrderRead);
  if (!permission.ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  try {
    const result = await catalogService.getSalesOrderLocalCatalog(options.getPool(), {
      installationId: requestContext.installationId,
      since: url.searchParams.get('since'),
    });
    if (!result.ok) {
      sendError(res, apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), 400), options.requestId, options.receivedAt);
      return true;
    }
    res.setHeader('Cache-Control', 'no-store');
    sendSuccess(res, result.catalog, options.requestId, options.receivedAt);
  } catch {
    sendError(
      res,
      apiError('SALES_ORDER_LOCAL_CATALOG_UNAVAILABLE', 'Chưa cập nhật được danh mục hàng hóa', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
  return true;
}
