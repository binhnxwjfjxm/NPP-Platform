import { sendError, sendSuccess } from '../http-utils.js';
import {
  ensureWarehouseScopes,
  normalizeFilters,
  reportingInternals,
  validateScope,
} from './reporting-common.js';
import { salesReport } from './reporting-sales.js';
import { purchasingReport } from './reporting-purchasing.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

async function authenticateAndAuthorize(req, res, options, permission) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(
      res,
      apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }

  let requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });

  if (!options.authorize(requestContext, permission).ok) {
    sendError(
      res,
      apiError('FORBIDDEN', 'Permission denied', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }

  requestContext = await ensureWarehouseScopes(options.getPool(), requestContext);
  return requestContext;
}

export async function handleReportingRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const family = url.pathname === '/api/reporting/sales'
    ? 'sales'
    : url.pathname === '/api/reporting/purchasing'
      ? 'purchasing'
      : null;
  if (!family) return false;

  const method = String(req.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    sendError(
      res,
      apiError('METHOD_NOT_ALLOWED', 'Only GET is supported for reporting', {}, false, 405),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  const permission = family === 'sales'
    ? options.PERMISSIONS.coreReportingSalesRead
    : options.PERMISSIONS.coreReportingPurchasingRead;
  const requestContext = await authenticateAndAuthorize(req, res, options, permission);
  if (!requestContext) return true;

  const normalized = normalizeFilters({
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    warehouseId: url.searchParams.get('warehouseId'),
  });
  if (!normalized.ok) {
    sendError(
      res,
      apiError(normalized.code, normalized.message, normalized.details, false, normalized.statusCode),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  const scope = validateScope(requestContext, normalized);
  if (!scope.ok) {
    sendError(
      res,
      apiError(scope.code, scope.message, scope.details, false, scope.statusCode),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  try {
    const report = family === 'sales'
      ? await salesReport(options.getPool(), requestContext, normalized, scope.warehouseIds)
      : await purchasingReport(options.getPool(), requestContext, normalized, scope.warehouseIds);
    res.setHeader('Cache-Control', 'no-store');
    sendSuccess(res, report, options.requestId, options.receivedAt);
  } catch (error) {
    sendError(
      res,
      apiError(
        error?.code ?? 'REPORTING_QUERY_FAILED',
        'Không tải được báo cáo vận hành',
        {},
        true,
        error?.statusCode ?? 503,
      ),
      options.requestId,
      options.receivedAt,
    );
  }
  return true;
}

export { reportingInternals };
