import { sendError, sendSuccess } from '../http-utils.js';
import {
  ensureWarehouseScopes,
  normalizeFilters,
  reportingInternals,
  validateScope,
} from './reporting-common.js';
import { salesReport } from './reporting-sales.js';
import { purchasingReport } from './reporting-purchasing.js';
import { inventoryReport, normalizeSlowDays } from './reporting-inventory.js';

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

  try {
    requestContext = await ensureWarehouseScopes(options.getPool(), requestContext);
    return requestContext;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'reporting_scope_lookup_failed',
      requestId: options.requestId,
      errorName: error?.name ?? null,
      errorCode: typeof error?.code === 'string' ? error.code : null,
    }));
    sendError(
      res,
      apiError('REPORTING_SCOPE_LOOKUP_FAILED', 'Không tải được phạm vi kho', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
}

function reportingFamily(pathname) {
  if (pathname === '/api/reporting/sales') return 'sales';
  if (pathname === '/api/reporting/purchasing') return 'purchasing';
  if (pathname === '/api/reporting/inventory') return 'inventory';
  return null;
}

function reportingPermission(options, family) {
  if (family === 'sales') return options.PERMISSIONS.coreReportingSalesRead;
  if (family === 'purchasing') return options.PERMISSIONS.coreReportingPurchasingRead;
  return options.PERMISSIONS.coreReportingInventoryRead;
}

export async function handleReportingRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const family = reportingFamily(url.pathname);
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

  const requestContext = await authenticateAndAuthorize(
    req,
    res,
    options,
    reportingPermission(options, family),
  );
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

  const slowDays = family === 'inventory'
    ? normalizeSlowDays(url.searchParams.get('slowDays'))
    : undefined;
  if (family === 'inventory' && slowDays === null) {
    sendError(
      res,
      apiError(
        'INVALID_REPORTING_SLOW_DAYS',
        'Ngưỡng hàng chậm luân chuyển phải là số nguyên từ 30 đến 365 ngày',
        {},
        false,
        400,
      ),
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
    let report;
    if (family === 'sales') {
      report = await salesReport(options.getPool(), requestContext, normalized, scope.warehouseIds);
    } else if (family === 'purchasing') {
      report = await purchasingReport(options.getPool(), requestContext, normalized, scope.warehouseIds);
    } else {
      report = await inventoryReport(
        options.getPool(),
        requestContext,
        normalized,
        scope.warehouseIds,
        slowDays,
      );
    }
    res.setHeader('Cache-Control', 'no-store');
    sendSuccess(res, report, options.requestId, options.receivedAt);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'reporting_query_failed',
      requestId: options.requestId,
      family,
      errorName: error?.name ?? null,
      errorCode: typeof error?.code === 'string' ? error.code : null,
    }));
    sendError(
      res,
      apiError(
        'REPORTING_QUERY_FAILED',
        'Không tải được báo cáo vận hành',
        {},
        false,
        503,
      ),
      options.requestId,
      options.receivedAt,
    );
  }
  return true;
}

export { reportingInternals };
