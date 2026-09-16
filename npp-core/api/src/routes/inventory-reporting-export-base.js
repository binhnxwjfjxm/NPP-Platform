import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { sendError } from '../http-utils.js';
import {
  ensureWarehouseScopes,
  normalizeFilters,
  validateScope,
} from './reporting-common.js';
import { normalizeSlowDays } from './reporting-inventory-safe.js';
import {
  createInventoryReportingExport,
  normalizeInventoryReportingExportSelection,
} from '../services/reporting-inventory-export.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function sendNormalizedError(res, normalized, options) {
  sendError(
    res,
    apiError(normalized.code, normalized.message, normalized.details ?? {}, false, normalized.statusCode ?? 400),
    options.requestId,
    options.receivedAt,
  );
}

async function authenticate(req, res, options) {
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
  const required = [
    options.PERMISSIONS.coreReportingInventoryRead,
    options.PERMISSIONS.coreReportingExport,
  ];
  if (required.some((permission) => !permission || !options.authorize(requestContext, permission).ok)) {
    sendError(
      res,
      apiError('FORBIDDEN', 'Tài khoản hiện tại không có quyền xuất Báo cáo tồn kho', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  try {
    return await ensureWarehouseScopes(options.getPool(), requestContext);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'inventory_reporting_export_scope_failed',
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

export async function handleInventoryReportingExportRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/api/inventory/reporting-export') return false;
  if (String(req.method ?? 'GET').toUpperCase() !== 'GET') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  const requestContext = await authenticate(req, res, options);
  if (!requestContext) return true;

  const filters = normalizeFilters({
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    warehouseId: url.searchParams.get('warehouseId'),
  }, new Date(options.receivedAt));
  if (!filters.ok) {
    sendNormalizedError(res, filters, options);
    return true;
  }

  const slowDays = normalizeSlowDays(url.searchParams.get('slowDays'));
  if (slowDays === null) {
    sendError(
      res,
      apiError('INVALID_REPORTING_SLOW_DAYS', 'Ngưỡng hàng chậm luân chuyển phải từ 30 đến 365 ngày', {}, false, 400),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  const warehouseScope = validateScope(requestContext, filters);
  if (!warehouseScope.ok) {
    sendNormalizedError(res, warehouseScope, options);
    return true;
  }

  const selection = normalizeInventoryReportingExportSelection({
    dimension: url.searchParams.get('dimension'),
    format: url.searchParams.get('format'),
    columns: url.searchParams.getAll('column'),
  });
  if (!selection.ok) {
    sendNormalizedError(res, selection, options);
    return true;
  }

  let artifact = null;
  try {
    artifact = await createInventoryReportingExport(options.getPool(), {
      requestContext,
      filters,
      warehouseIds: warehouseScope.warehouseIds,
      slowDays,
      selection,
    });
    res.statusCode = 200;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
    res.setHeader('Content-Length', String(artifact.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(createReadStream(artifact.filePath), res);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'inventory_reporting_export_failed',
      requestId: options.requestId,
      errorName: error?.name ?? null,
      errorCode: typeof error?.code === 'string' ? error.code : null,
    }));
    if (!res.headersSent) {
      const tooLarge = error?.code === 'INVENTORY_REPORT_EXPORT_TOO_LARGE';
      sendError(
        res,
        apiError(
          tooLarge ? 'INVENTORY_REPORT_EXPORT_TOO_LARGE' : 'INVENTORY_REPORT_EXPORT_FAILED',
          tooLarge
            ? 'Dữ liệu xuất quá lớn. Hãy thu hẹp kỳ báo cáo hoặc chọn một kho.'
            : 'Không xuất được Báo cáo tồn kho',
          {},
          !tooLarge,
          tooLarge ? 413 : 503,
        ),
        options.requestId,
        options.receivedAt,
      );
    } else if (!res.destroyed) {
      res.destroy(error instanceof Error ? error : undefined);
    }
  } finally {
    if (artifact?.cleanup) {
      try { await artifact.cleanup(); } catch {}
    }
  }
  return true;
}
