import { Buffer } from 'node:buffer';
import { BUSINESS_TIMEZONE, mapRow } from './reporting-common.js';
import { salesReport } from './reporting-sales.js';
import { purchasingReport } from './reporting-purchasing.js';
import { inventoryReport } from './reporting-inventory.js';
import { agingReport, grossMarginReport } from './reporting-finance.js';
import { employeeMcpReport, resolveEmployeeMcpScope } from './reporting-employee-mcp.js';
import { logisticsReport } from './reporting-logistics.js';
import { codReport } from './reporting-cod.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const IMPORT_EXPORT_DIRECTIONS = new Set(['IMPORT', 'EXPORT']);
const IMPORT_EXPORT_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled']);

function invalid(code, message) {
  return Object.freeze({ ok: false, code, message, statusCode: 400, details: {} });
}

function boundedText(value, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > maxLength || /[\r\n]/.test(text)) return undefined;
  return text;
}

function normalizeLimit(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_LIMIT;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT ? parsed : null;
}

function isValidCursorTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = CURSOR_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const millis = (match[2] ?? '').padEnd(3, '0').slice(0, 3);
  const parsed = new Date(`${match[1]}.${millis}Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === match[1];
}

function encodeCursor(at, id) {
  if (!isValidCursorTimestamp(at) || !UUID_PATTERN.test(String(id ?? ''))) {
    throw new Error('invalid_history_cursor_source');
  }
  return Buffer.from(JSON.stringify({ at, id: String(id).toLowerCase() }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > 512) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    const at = typeof parsed?.at === 'string' ? parsed.at : '';
    const id = typeof parsed?.id === 'string' ? parsed.id.toLowerCase() : '';
    if (!isValidCursorTimestamp(at) || !UUID_PATTERN.test(id)) return undefined;
    return Object.freeze({ at, id });
  } catch {
    return undefined;
  }
}

function mapAuditHistoryRow(row) {
  return Object.freeze({
    auditId: String(row.audit_id),
    actorId: String(row.actor_id),
    employeeId: row.employee_id == null ? null : String(row.employee_id),
    sourceApp: String(row.source_app),
    requestId: String(row.request_id),
    action: String(row.action),
    resourceType: String(row.resource_type),
    resourceId: row.resource_id == null ? null : String(row.resource_id),
    occurredAt: row.occurred_at,
    hasBeforeData: row.has_before_data === true,
    hasAfterData: row.has_after_data === true,
    hasMetadata: row.has_metadata === true,
  });
}

function mapImportExportHistoryRow(row) {
  return Object.freeze({
    jobId: String(row.job_id),
    direction: String(row.direction),
    definitionKey: String(row.definition_key),
    definitionVersion: String(row.definition_version),
    format: String(row.format),
    status: String(row.status),
    actorId: String(row.actor_id),
    employeeId: row.employee_id == null ? null : String(row.employee_id),
    sourceApp: String(row.source_app),
    requestId: String(row.request_id),
    normalizedFilters: row.normalized_filters ?? {},
    effectiveScopes: row.effective_scopes ?? {},
    businessTimezone: String(row.business_timezone),
    sourceAsOf: row.source_as_of ?? null,
    rowCount: row.row_count == null ? null : String(row.row_count),
    hasResult: row.has_result === true,
    resultChecksumSha256: row.result_checksum_sha256 == null ? null : String(row.result_checksum_sha256),
    failureCode: row.failure_code == null ? null : String(row.failure_code),
    requestedAt: row.requested_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
  });
}

export function normalizeAuditHistoryFilters(searchParams, normalizedPeriod) {
  const limit = normalizeLimit(searchParams.get('limit'));
  if (limit === null) return invalid('INVALID_HISTORY_LIMIT', `Giới hạn lịch sử phải từ 1 đến ${MAX_LIMIT}`);
  const cursor = decodeCursor(searchParams.get('cursor'));
  if (cursor === undefined) return invalid('INVALID_HISTORY_CURSOR', 'Con trỏ lịch sử không hợp lệ');
  const action = boundedText(searchParams.get('action'), 160);
  const resourceType = boundedText(searchParams.get('resourceType'), 160);
  const sourceApp = boundedText(searchParams.get('sourceApp'), 128);
  if (action === undefined || resourceType === undefined || sourceApp === undefined) {
    return invalid('INVALID_HISTORY_FILTER', 'Bộ lọc lịch sử không hợp lệ');
  }
  return Object.freeze({
    ok: true,
    from: normalizedPeriod.from,
    to: normalizedPeriod.to,
    fromInstant: normalizedPeriod.fromInstant,
    toExclusiveInstant: normalizedPeriod.toExclusiveInstant,
    limit,
    cursor,
    action,
    resourceType,
    sourceApp,
  });
}

export function normalizeImportExportHistoryFilters(searchParams, normalizedPeriod) {
  const limit = normalizeLimit(searchParams.get('limit'));
  if (limit === null) return invalid('INVALID_HISTORY_LIMIT', `Giới hạn lịch sử phải từ 1 đến ${MAX_LIMIT}`);
  const cursor = decodeCursor(searchParams.get('cursor'));
  if (cursor === undefined) return invalid('INVALID_HISTORY_CURSOR', 'Con trỏ lịch sử không hợp lệ');
  const directionRaw = boundedText(searchParams.get('direction'), 16);
  const statusRaw = boundedText(searchParams.get('status'), 32);
  const definitionKey = boundedText(searchParams.get('definitionKey'), 160);
  if (directionRaw === undefined || statusRaw === undefined || definitionKey === undefined) {
    return invalid('INVALID_HISTORY_FILTER', 'Bộ lọc lịch sử không hợp lệ');
  }
  const direction = directionRaw ? directionRaw.toUpperCase() : null;
  const status = statusRaw ? statusRaw.toLowerCase() : null;
  if (direction && !IMPORT_EXPORT_DIRECTIONS.has(direction)) return invalid('INVALID_HISTORY_DIRECTION', 'Chiều import/export không hợp lệ');
  if (status && !IMPORT_EXPORT_STATUSES.has(status)) return invalid('INVALID_HISTORY_STATUS', 'Trạng thái import/export không hợp lệ');
  return Object.freeze({
    ok: true,
    from: normalizedPeriod.from,
    to: normalizedPeriod.to,
    fromInstant: normalizedPeriod.fromInstant,
    toExclusiveInstant: normalizedPeriod.toExclusiveInstant,
    limit,
    cursor,
    direction,
    status,
    definitionKey,
  });
}

export async function auditHistoryReport(adapter, requestContext, filters) {
  const rows = await adapter.query(
    `SELECT audit_id, actor_id, employee_id, source_app, request_id, action,
            resource_type, resource_id, occurred_at,
            (before_data IS NOT NULL) AS has_before_data,
            (after_data IS NOT NULL) AS has_after_data,
            COALESCE(metadata <> '{}'::jsonb, false) AS has_metadata,
            to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
       FROM shared.core_audit_records
      WHERE installation_id = $1
        AND occurred_at >= $2::timestamptz
        AND occurred_at < $3::timestamptz
        AND ($4::text IS NULL OR action = $4::text)
        AND ($5::text IS NULL OR resource_type = $5::text)
        AND ($6::text IS NULL OR source_app = $6::text)
        AND ($7::timestamptz IS NULL OR occurred_at < $7::timestamptz
             OR (occurred_at = $7::timestamptz AND audit_id < $8::uuid))
      ORDER BY occurred_at DESC, audit_id DESC
      LIMIT $9`,
    [
      requestContext.installationId,
      filters.fromInstant,
      filters.toExclusiveInstant,
      filters.action,
      filters.resourceType,
      filters.sourceApp,
      filters.cursor?.at ?? null,
      filters.cursor?.id ?? null,
      filters.limit + 1,
    ],
  );
  const allRows = rows.rows ?? [];
  const hasMore = allRows.length > filters.limit;
  const visible = allRows.slice(0, filters.limit);
  const last = visible.at(-1);
  return Object.freeze({
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    filters: Object.freeze({ from: filters.from, to: filters.to, action: filters.action, resourceType: filters.resourceType, sourceApp: filters.sourceApp, limit: filters.limit }),
    rows: Object.freeze(visible.map(mapAuditHistoryRow)),
    page: Object.freeze({ hasMore, nextCursor: hasMore && last ? encodeCursor(last.cursor_at, last.audit_id) : null }),
  });
}

export async function importExportHistoryReport(adapter, requestContext, filters) {
  const rows = await adapter.query(
    `SELECT job_id, direction, definition_key, definition_version, format, status,
            actor_id, employee_id, source_app, request_id,
            normalized_filters, effective_scopes, business_timezone, source_as_of,
            row_count::text, (result_object_key IS NOT NULL) AS has_result,
            result_checksum_sha256, failure_code,
            requested_at, started_at, completed_at,
            to_char(requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
       FROM reporting.import_export_jobs
      WHERE installation_id = $1
        AND requested_at >= $2::timestamptz
        AND requested_at < $3::timestamptz
        AND ($4::text IS NULL OR direction = $4::text)
        AND ($5::text IS NULL OR status = $5::text)
        AND ($6::text IS NULL OR definition_key = $6::text)
        AND ($7::timestamptz IS NULL OR requested_at < $7::timestamptz
             OR (requested_at = $7::timestamptz AND job_id < $8::uuid))
      ORDER BY requested_at DESC, job_id DESC
      LIMIT $9`,
    [
      requestContext.installationId,
      filters.fromInstant,
      filters.toExclusiveInstant,
      filters.direction,
      filters.status,
      filters.definitionKey,
      filters.cursor?.at ?? null,
      filters.cursor?.id ?? null,
      filters.limit + 1,
    ],
  );
  const allRows = rows.rows ?? [];
  const hasMore = allRows.length > filters.limit;
  const visible = allRows.slice(0, filters.limit);
  const last = visible.at(-1);
  return Object.freeze({
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    filters: Object.freeze({ from: filters.from, to: filters.to, direction: filters.direction, status: filters.status, definitionKey: filters.definitionKey, limit: filters.limit }),
    rows: Object.freeze(visible.map(mapImportExportHistoryRow)),
    page: Object.freeze({ hasMore, nextCursor: hasMore && last ? encodeCursor(last.cursor_at, last.job_id) : null }),
  });
}

function publicWarning(family, code) {
  return Object.freeze({ family, code: typeof code === 'string' ? code.slice(0, 120) : 'REPORTING_FAMILY_UNAVAILABLE' });
}

function codManagementView(report) {
  const snapshot = report?.currentSnapshot ?? {};
  const exceptions = report?.exceptions ?? {};
  return Object.freeze({
    custodyByCurrency: Object.freeze([...(snapshot.custodyByCurrency ?? [])]),
    hasPendingHandovers: (snapshot.pendingHandovers?.length ?? 0) > 0,
    hasDiscrepancies: (snapshot.discrepancies?.length ?? 0) > 0,
    hasOverduePromises: (snapshot.overduePromises?.length ?? 0) > 0,
    hasLifecycleExceptions: (exceptions.lifecycle?.length ?? 0) > 0,
    hasCurrencyLineageExceptions: (exceptions.currencyLineage?.length ?? 0) > 0,
  });
}

export async function controlTowerReport(adapter, requestContext, filters, warehouseIds) {
  const canReadInstallationMcp = requestContext.roles?.includes('bootstrap') === true;
  const hasEmployeeScope = typeof requestContext.employeeId === 'string' && requestContext.employeeId.trim().length > 0;
  const fieldScopePromise = (!canReadInstallationMcp && !hasEmployeeScope)
    ? Promise.resolve(Object.freeze({
      ok: false,
      code: 'EMPLOYEE_MCP_SCOPE_DENIED',
      message: 'Cần phạm vi nhân viên canonical để xem báo cáo MCP',
      statusCode: 403,
      details: {},
    }))
    : resolveEmployeeMcpScope(adapter, requestContext);
  const loaders = [
    ['sales', () => salesReport(adapter, requestContext, filters, warehouseIds)],
    ['purchasing', () => purchasingReport(adapter, requestContext, filters, warehouseIds)],
    ['inventory', () => inventoryReport(adapter, requestContext, filters, warehouseIds)],
    ['aging', () => agingReport(adapter, requestContext, filters, warehouseIds)],
    ['grossMargin', () => grossMarginReport(adapter, requestContext, filters, warehouseIds)],
    ['logistics', () => logisticsReport(adapter, requestContext, filters, warehouseIds)],
    ['cod', () => codReport(adapter, requestContext, filters, warehouseIds)],
    ['employeeMcp', async () => {
      const fieldScope = await fieldScopePromise;
      if (!fieldScope.ok) {
        const error = new Error(fieldScope.message);
        error.code = fieldScope.code;
        throw error;
      }
      return employeeMcpReport(adapter, requestContext, filters, fieldScope);
    }],
  ];
  const settled = await Promise.allSettled(loaders.map(([, load]) => load()));
  const warnings = [];
  const reports = {};
  settled.forEach((result, index) => {
    const family = loaders[index][0];
    if (result.status === 'fulfilled') reports[family] = result.value;
    else warnings.push(publicWarning(family, result.reason?.code));
  });

  return Object.freeze({
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    filters: Object.freeze({ from: filters.from, to: filters.to, warehouseId: filters.warehouseId }),
    management: Object.freeze({
      sales: reports.sales ? Object.freeze({ summary: reports.sales.summary, currencyTotals: reports.sales.currencyTotals }) : null,
      purchasing: reports.purchasing ? Object.freeze({ summary: reports.purchasing.summary, currencyTotals: reports.purchasing.currencyTotals }) : null,
      inventory: reports.inventory ? Object.freeze({ summary: reports.inventory.summary, projectionState: reports.inventory.projectionState }) : null,
      aging: reports.aging ? Object.freeze({ receivableSummary: reports.aging.receivable.summary, payableSummary: reports.aging.payable.summary }) : null,
      grossMargin: reports.grossMargin ? Object.freeze({ summary: reports.grossMargin.summary }) : null,
      employeeMcp: reports.employeeMcp ? Object.freeze({ summary: reports.employeeMcp.summary }) : null,
      logistics: reports.logistics ? Object.freeze({ summary: reports.logistics.summary, dataQuality: reports.logistics.dataQuality }) : null,
      cod: reports.cod ? codManagementView(reports.cod) : null,
    }),
    warnings: Object.freeze(warnings),
  });
}

export const operationsReportingInternals = Object.freeze({
  DEFAULT_LIMIT,
  MAX_LIMIT,
  encodeCursor,
  decodeCursor,
  isValidCursorTimestamp,
  normalizeLimit,
  normalizeAuditHistoryFilters,
  normalizeImportExportHistoryFilters,
  codManagementView,
  mapRow,
});
