import * as repository from '../db/repositories/sales-settlement-reconciliation.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['all', 'matched', 'mismatch']);

function failure(code, message, details = {}) {
  return Object.freeze({ ok: false, code, message, details });
}

function date(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (!DATE_PATTERN.test(normalized)) return undefined;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized ? undefined : normalized;
}

function text(value, maxLength) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= maxLength ? normalized : normalized ? undefined : null;
}

function integer(value, fallback, min, max) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

function camelKey(value) {
  return value.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function mapRow(row) {
  return Object.freeze(Object.fromEntries(Object.entries(row).map(([key, value]) => [camelKey(key), value])));
}

function mapRows(rows) {
  return Object.freeze(rows.map(mapRow));
}

function normalize(input) {
  const from = date(input.from);
  const to = date(input.to);
  const search = text(input.search, 160);
  const status = String(input.status ?? 'all').trim().toLowerCase() || 'all';
  const limit = integer(input.limit, 100, 1, 500);
  if (from === undefined || to === undefined) return failure('INVALID_RECONCILIATION_DATE', 'Ngày đối soát phải theo định dạng YYYY-MM-DD');
  if (from && to && from > to) return failure('INVALID_RECONCILIATION_PERIOD', 'Ngày bắt đầu không được sau ngày kết thúc');
  if (search === undefined) return failure('INVALID_RECONCILIATION_SEARCH', 'Từ khóa đối soát không được vượt quá 160 ký tự');
  if (!STATUSES.has(status)) return failure('INVALID_RECONCILIATION_STATUS', 'Trạng thái đối soát không hợp lệ');
  if (limit === undefined) return failure('INVALID_RECONCILIATION_LIMIT', 'Giới hạn kết quả phải từ 1 đến 500');
  return Object.freeze({ ok: true, from, to, search, status, limit });
}

export async function getSalesSettlementReconciliation(adapter, { requestContext, ...input }) {
  const warehouseIds = requestContext.scopes?.warehouseIds ?? [];
  if (!Array.isArray(warehouseIds) || !warehouseIds.length) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Cần ít nhất một kho được cấp quyền để xem đối soát');
  }
  const normalized = normalize(input);
  if (!normalized.ok) return normalized;
  const query = Object.freeze({
    installationId: requestContext.installationId,
    warehouseIds,
    from: normalized.from,
    to: normalized.to,
    search: normalized.search,
    status: normalized.status,
    limit: normalized.limit,
  });
  const [summary, customers, documents, orders, codCollections, codHandovers, anomalies] = await Promise.all([
    repository.getSummary(adapter, query),
    repository.listCustomers(adapter, query),
    repository.listDocuments(adapter, query),
    repository.listOrders(adapter, query),
    repository.listCodCollections(adapter, query),
    repository.listCodHandovers(adapter, query),
    repository.listAnomalies(adapter, query),
  ]);
  return Object.freeze({
    ok: true,
    report: Object.freeze({
      generatedAt: requestContext.receivedAt,
      filters: Object.freeze({ from: normalized.from, to: normalized.to, search: normalized.search, status: normalized.status, limit: normalized.limit }),
      summary: mapRow(summary),
      customers: mapRows(customers),
      documents: mapRows(documents),
      orders: mapRows(orders),
      codCollections: mapRows(codCollections),
      codHandovers: mapRows(codHandovers),
      anomalies: mapRows(anomalies),
    }),
  });
}

export const salesSettlementReconciliationInternals = Object.freeze({ date, text, integer, mapRow, normalize });
