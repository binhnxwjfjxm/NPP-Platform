import * as warehouseRepository from '../db/repositories/warehouse.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
const BUSINESS_OFFSET = '+07:00';

function failure(code, message, statusCode = 400, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, details });
}

function strictDate(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (!DATE_PATTERN.test(normalized)) return undefined;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized
    ? undefined
    : normalized;
}

function businessDateNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function firstDayOfMonth(date) {
  return `${date.slice(0, 7)}-01`;
}

function nextDate(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function toInstant(date) {
  return new Date(`${date}T00:00:00${BUSINESS_OFFSET}`).toISOString();
}

export function normalizeFilters(input = {}, now = new Date()) {
  const today = businessDateNow(now);
  const parsedFrom = strictDate(input.from);
  const parsedTo = strictDate(input.to);
  if (parsedFrom === undefined || parsedTo === undefined) {
    return failure('INVALID_REPORTING_DATE', 'Ngày báo cáo phải theo định dạng YYYY-MM-DD');
  }

  const from = parsedFrom ?? firstDayOfMonth(today);
  const to = parsedTo ?? today;
  if (from > to) {
    return failure('INVALID_REPORTING_PERIOD', 'Ngày bắt đầu không được sau ngày kết thúc');
  }

  const warehouseId = String(input.warehouseId ?? '').trim() || null;
  if (warehouseId && !UUID_PATTERN.test(warehouseId)) {
    return failure('INVALID_REPORTING_WAREHOUSE', 'Kho báo cáo không hợp lệ');
  }

  return Object.freeze({
    ok: true,
    from,
    to,
    warehouseId,
    fromInstant: toInstant(from),
    toExclusiveInstant: toInstant(nextDate(to)),
  });
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

export async function ensureWarehouseScopes(adapter, requestContext) {
  const current = requestContext.scopes?.warehouseIds;
  if (Array.isArray(current) && current.length) return requestContext;
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) {
    return requestContext;
  }

  const warehouses = await warehouseRepository.listWarehousesForInstallation(adapter, {
    installationId: requestContext.installationId,
    active: undefined,
    limit: 10000,
    offset: 0,
  });
  return withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
}

function authorizedWarehouseIds(requestContext) {
  return Array.isArray(requestContext.scopes?.warehouseIds)
    ? [...new Set(
      requestContext.scopes.warehouseIds
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim()),
    )]
    : [];
}

export function validateScope(requestContext, filters) {
  const warehouseIds = authorizedWarehouseIds(requestContext);
  if (!warehouseIds.length) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Cần ít nhất một kho được cấp quyền để xem báo cáo', 403);
  }
  if (filters.warehouseId && !warehouseIds.includes(filters.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Kho được yêu cầu nằm ngoài phạm vi được cấp quyền', 403);
  }
  return Object.freeze({ ok: true, warehouseIds });
}

function camelKey(value) {
  return value.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

export function mapRow(row) {
  return Object.freeze(
    Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [camelKey(key), value])),
  );
}

export function mapRows(rows) {
  return Object.freeze((rows ?? []).map(mapRow));
}

export const reportingInternals = Object.freeze({
  BUSINESS_TIMEZONE,
  strictDate,
  businessDateNow,
  firstDayOfMonth,
  nextDate,
  toInstant,
  normalizeFilters,
  validateScope,
  mapRow,
});
