import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { sendError, sendSuccess } from '../http-utils.js';
import {
  ensureWarehouseScopes,
  normalizeFilters,
  reportingInternals,
  validateScope,
} from './reporting-common.js';
import { salesReport } from './reporting-sales.js';
import { purchasingReport } from './reporting-purchasing.js';
import { inventoryReport, normalizeSlowDays } from './reporting-inventory-safe.js';
import { agingReport, grossMarginReport } from './reporting-finance.js';
import { employeeMcpReport, resolveEmployeeMcpScope } from './reporting-employee-mcp.js';
import { adminAlertsReport, mcpSupervisionReport } from './reporting-mcp-alerts.js';
import { handleAdminAlertMutation } from './reporting-admin-alert-mutations.js';
import { logisticsReport } from './reporting-logistics.js';
import { codReport } from './reporting-cod.js';
import {
  auditHistoryReport,
  controlTowerReport,
  importExportHistoryReport,
  normalizeAuditHistoryFilters,
  normalizeImportExportHistoryFilters,
} from './reporting-operations.js';
import { createBusinessDataExport } from '../services/business-data-export.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

async function authenticateAndAuthorize(req, res, options, permission, warehouseScoped = true) {
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

  if (!options.authorize(requestContext, permission).ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }

  if (!warehouseScoped) return requestContext;

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
    sendError(res, apiError('REPORTING_SCOPE_LOOKUP_FAILED', 'Không tải được phạm vi kho', {}, true, 503), options.requestId, options.receivedAt);
    return null;
  }
}

function reportingFamily(pathname) {
  if (pathname === '/api/reporting/sales') return 'sales';
  if (pathname === '/api/reporting/purchasing') return 'purchasing';
  if (pathname === '/api/reporting/inventory') return 'inventory';
  if (pathname === '/api/reporting/aging') return 'aging';
  if (pathname === '/api/reporting/gross-margin') return 'gross-margin';
  if (pathname === '/api/reporting/employee-mcp') return 'employee-mcp';
  if (pathname === '/api/reporting/mcp-supervision') return 'mcp-supervision';
  if (pathname === '/api/reporting/admin-alerts' || pathname.startsWith('/api/reporting/admin-alerts/')) return 'admin-alerts';
  if (pathname === '/api/reporting/logistics') return 'logistics';
  if (pathname === '/api/reporting/cod') return 'cod';
  if (pathname === '/api/reporting/audit-history') return 'audit-history';
  if (pathname === '/api/reporting/import-export-history') return 'import-export-history';
  if (pathname === '/api/reporting/control-tower') return 'control-tower';
  if (pathname === '/api/reporting/business-export') return 'business-export';
  return null;
}

function reportingPermission(options, family) {
  if (family === 'sales') return options.PERMISSIONS.coreReportingSalesRead;
  if (family === 'purchasing') return options.PERMISSIONS.coreReportingPurchasingRead;
  if (family === 'inventory') return options.PERMISSIONS.coreReportingInventoryRead;
  if (family === 'aging') return options.PERMISSIONS.coreReportingAgingRead;
  if (family === 'gross-margin') return options.PERMISSIONS.coreReportingGrossMarginRead;
  if (family === 'logistics') return options.PERMISSIONS.coreReportingLogisticsRead;
  if (family === 'cod') return options.PERMISSIONS.coreReportingCodRead;
  if (family === 'business-export') return options.PERMISSIONS.coreReportingExport;
  if (family === 'audit-history' || family === 'import-export-history') return options.PERMISSIONS.coreReportingAuditHistoryRead;
  if (family === 'control-tower') return options.PERMISSIONS.coreReportingControlTowerRead;
  return options.PERMISSIONS.coreReportingEmployeeMcpRead;
}

function sendNormalizedError(res, normalized, options) {
  sendError(
    res,
    apiError(normalized.code, normalized.message, normalized.details ?? {}, false, normalized.statusCode ?? 400),
    options.requestId,
    options.receivedAt,
  );
}

function isMcpFamily(family) {
  return family === 'employee-mcp' || family === 'mcp-supervision' || family === 'admin-alerts';
}

function alertIdFromPath(pathname) {
  const prefix = '/api/reporting/admin-alerts/';
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  if (!raw || raw.includes('/')) return null;
  try {
    const decoded = decodeURIComponent(raw);
    return /^[A-Za-z0-9._-]{1,240}$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

async function streamBusinessExport(req, res, options, requestContext) {
  const warehouseIds = Array.isArray(requestContext.scopes?.warehouseIds)
    ? requestContext.scopes.warehouseIds
    : [];
  let artifact = null;
  try {
    const mcpPermission = options.PERMISSIONS.coreReportingEmployeeMcpRead;
    const canReadMcp = Boolean(mcpPermission && options.authorize(requestContext, mcpPermission).ok);
    const mcpScope = canReadMcp
      ? await resolveEmployeeMcpScope(options.getPool(), requestContext)
      : null;
    artifact = await createBusinessDataExport(options.getPool(), {
      requestContext,
      warehouseIds,
      mcpEmployeeCode: mcpScope?.ok ? mcpScope.employeeCode : null,
      canReadPermission: (permissionName) => {
        const permission = options.PERMISSIONS[permissionName];
        if (!permission || !options.authorize(requestContext, permission).ok) return false;
        if (permissionName === 'coreReportingEmployeeMcpRead') return mcpScope?.ok === true;
        return true;
      },
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
      event: 'business_data_export_failed',
      requestId: options.requestId,
      errorName: error?.name ?? null,
      errorCode: typeof error?.code === 'string' ? error.code : null,
    }));
    if (!res.headersSent) {
      sendError(
        res,
        apiError(
          'BUSINESS_DATA_EXPORT_FAILED',
          'Không xuất được số liệu doanh nghiệp',
          {},
          true,
          503,
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
}

async function resolveMcpFieldScope(res, options, requestContext) {
  const fieldScope = await resolveEmployeeMcpScope(options.getPool(), requestContext);
  if (!fieldScope.ok) {
    sendNormalizedError(res, fieldScope, options);
    return null;
  }
  return fieldScope;
}

export async function handleReportingRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const family = reportingFamily(url.pathname);
  if (!family) return false;

  const method = String(req.method ?? 'GET').toUpperCase();
  const alertId = family === 'admin-alerts' ? alertIdFromPath(url.pathname) : null;
  const alertMutation = family === 'admin-alerts' && alertId !== null && method === 'POST';
  if (method !== 'GET' && !alertMutation) {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  const historyFamily = family === 'audit-history' || family === 'import-export-history';
  const warehouseScoped = family !== 'employee-mcp'
    && family !== 'mcp-supervision'
    && family !== 'admin-alerts'
    && !historyFamily;
  const requestContext = await authenticateAndAuthorize(
    req,
    res,
    options,
    reportingPermission(options, family),
    warehouseScoped,
  );
  if (!requestContext) return true;

  if (family === 'business-export') {
    await streamBusinessExport(req, res, options, requestContext);
    return true;
  }

  if (historyFamily) {
    const period = normalizeFilters({ from: url.searchParams.get('from'), to: url.searchParams.get('to'), warehouseId: null }, new Date(options.receivedAt));
    if (!period.ok) {
      sendNormalizedError(res, period, options);
      return true;
    }
    const historyFilters = family === 'audit-history'
      ? normalizeAuditHistoryFilters(url.searchParams, period)
      : normalizeImportExportHistoryFilters(url.searchParams, period);
    if (!historyFilters.ok) {
      sendNormalizedError(res, historyFilters, options);
      return true;
    }
    try {
      const report = family === 'audit-history'
        ? await auditHistoryReport(options.getPool(), requestContext, historyFilters)
        : await importExportHistoryReport(options.getPool(), requestContext, historyFilters);
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
      sendError(res, apiError('REPORTING_QUERY_FAILED', 'Không tải được lịch sử vận hành', {}, false, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (isMcpFamily(family)
    && !requestContext.roles?.includes('bootstrap')
    && !requestContext.employeeId) {
    sendError(
      res,
      apiError('EMPLOYEE_MCP_SCOPE_DENIED', 'Cần phạm vi nhân viên canonical để xem báo cáo MCP', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  if (family === 'aging' && (url.searchParams.has('from') || url.searchParams.has('to'))) {
    sendError(
      res,
      apiError(
        'AGING_HISTORICAL_FILTER_UNSUPPORTED',
        'Tuổi nợ hiện dùng số dư hiện tại; không nhận bộ lọc kỳ lịch sử',
        {},
        false,
        400,
      ),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  if (isMcpFamily(family) && url.searchParams.has('warehouseId')) {
    sendError(
      res,
      apiError(
        'EMPLOYEE_MCP_WAREHOUSE_FILTER_UNSUPPORTED',
        'Báo cáo MCP không suy diễn phạm vi field từ kho',
        {},
        false,
        400,
      ),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  const normalized = normalizeFilters({
    from: family === 'aging' ? null : url.searchParams.get('from'),
    to: family === 'aging' ? null : url.searchParams.get('to'),
    warehouseId: warehouseScoped ? url.searchParams.get('warehouseId') : null,
  }, new Date(options.receivedAt));
  if (!normalized.ok) {
    sendNormalizedError(res, normalized, options);
    return true;
  }

  const slowDays = family === 'inventory' ? normalizeSlowDays(url.searchParams.get('slowDays')) : undefined;
  if (family === 'inventory' && slowDays === null) {
    sendError(
      res,
      apiError('INVALID_REPORTING_SLOW_DAYS', 'Ngưỡng hàng chậm luân chuyển phải là số nguyên từ 30 đến 365 ngày', {}, false, 400),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  let warehouseScope = null;
  if (warehouseScoped) {
    warehouseScope = validateScope(requestContext, normalized);
    if (!warehouseScope.ok) {
      sendNormalizedError(res, warehouseScope, options);
      return true;
    }
  }

  let fieldScope = null;
  if (isMcpFamily(family)) {
    fieldScope = await resolveMcpFieldScope(res, options, requestContext);
    if (!fieldScope) return true;
  }

  if (alertMutation) {
    await handleAdminAlertMutation({
      req,
      res,
      options,
      requestContext,
      filters: normalized,
      fieldScope,
      alertId,
    });
    return true;
  }

  try {
    let report;
    if (family === 'sales') {
      report = await salesReport(options.getPool(), requestContext, normalized, warehouseScope.warehouseIds);
    } else if (family === 'purchasing') {
      report = await purchasingReport(options.getPool(), requestContext, normalized, warehouseScope.warehouseIds);
    } else if (family === 'inventory') {
      report = await inventoryReport(options.getPool(), requestContext, normalized, warehouseScope.warehouseIds, slowDays);
    } else if (family === 'aging') {
      report = await agingReport(options.getPool(), requestContext, normalized, warehouseScope.warehouseIds);
    } else if (family === 'gross-margin') {
      report = await grossMarginReport(options.getPool(), requestContext, normalized, warehouseScope.warehouseIds);
    } else if (family === 'logistics') {
      report = await logisticsReport(options.getPool(), requestContext, normalized, warehouseScope.warehouseIds);
    } else if (family === 'cod') {
      report = await codReport(options.getPool(), requestContext, normalized, warehouseScope.warehouseIds);
    } else if (family === 'control-tower') {
      report = await controlTowerReport(options.getPool(), requestContext, normalized, warehouseScope.warehouseIds);
    } else if (family === 'mcp-supervision') {
      report = await mcpSupervisionReport(options.getPool(), requestContext, normalized, fieldScope);
    } else if (family === 'admin-alerts') {
      report = await adminAlertsReport(options.getPool(), requestContext, normalized, fieldScope);
    } else {
      report = await employeeMcpReport(options.getPool(), requestContext, normalized, fieldScope);
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
    sendError(res, apiError('REPORTING_QUERY_FAILED', 'Không tải được báo cáo vận hành', {}, false, 503), options.requestId, options.receivedAt);
  }
  return true;
}

export { reportingInternals };
