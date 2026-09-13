import 'server-only';

import { CoreApiError, requestCore } from '../../lib/core-api';
import { normalizeReportPeriod, resolveReportRange, type ReportPeriod } from './report-data';

type JsonRecord = Record<string, unknown>;

export type BusinessClassificationOption = { id: string; code: string | null; name: string };
export type BusinessProductGroupOption = BusinessClassificationOption & { parentCategoryId: string | null };
export type BusinessMatrixColumn = { key: string; id: string | null; code: string | null; name: string; source: string };
export type BusinessMatrixCell = { columnKey: string; customerGroupId: string | null; quantity: string; sharePercent: string };
export type BusinessMatrixRow = { variantId: string | null; sku: string | null; name: string; productGroup: { id: string | null; code: string | null; name: string; source: string }; unit: { id: string | null; code: string; name: string }; totalQuantity: string; cells: BusinessMatrixCell[]; hasActivity: boolean };
export type BusinessMatrixTotal = { unit: { id: string | null; code: string; name: string }; totalQuantity: string; cells: BusinessMatrixCell[] };
export type BusinessReportFilters = { productGroupId: string | null; customerGroupId: string | null; includeZeroProducts: boolean };
export type BusinessClassification = { options: { productGroups: BusinessProductGroupOption[]; customerGroups: BusinessClassificationOption[] }; productCustomerMatrix: { includeZeroProducts: boolean; columns: BusinessMatrixColumn[]; rows: BusinessMatrixRow[]; totalsByUnit: BusinessMatrixTotal[] } };

export type BusinessBreakdownKey = 'customerGroups' | 'customers' | 'products' | 'productGroups' | 'channels' | 'employees';
export type BusinessRow = {
  id: string | null;
  code: string | null;
  name: string;
  source: string;
  currencyCode: string;
  revenue: string;
  quantity: string;
  unit: { id: string | null; code: string; name: string };
  documentCount?: string;
  customerCount?: string;
  productCount?: string;
  sharePercent: string;
  previousRevenue: string;
  previousQuantity: string;
  changePercent: string | null;
  comparisonState: string;
};
export type BusinessReport = {
  period: ReportPeriod;
  from: string;
  to: string;
  generatedAt: string | null;
  state: 'ready' | 'partial' | 'forbidden' | 'error';
  message: string | null;
  filters: BusinessReportFilters;
  summary: JsonRecord;
  comparison: JsonRecord;
  breakdowns: Record<BusinessBreakdownKey, BusinessRow[]>;
  classification: BusinessClassification;
  trend: JsonRecord[];
  reconciliation: JsonRecord;
  documents: JsonRecord[];
  warnings: string[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPTY_BREAKDOWNS: Record<BusinessBreakdownKey, BusinessRow[]> = {
  customerGroups: [], customers: [], products: [], productGroups: [], channels: [], employees: [],
};
const EMPTY_CLASSIFICATION: BusinessClassification = {
  options: { productGroups: [], customerGroups: [] },
  productCustomerMatrix: { includeZeroProducts: false, columns: [], rows: [], totalsByUnit: [] },
};

function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function record(value: unknown): JsonRecord { return isRecord(value) ? value : {}; }
function rows<T = JsonRecord>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function optionalUuid(value: unknown): string | null { const normalized = String(value ?? '').trim(); return UUID_PATTERN.test(normalized) ? normalized.toLowerCase() : null; }
function booleanFlag(value: unknown): boolean { return value === true || String(value ?? '').trim().toLowerCase() === 'true'; }
function classificationOf(value: unknown): BusinessClassification {
  const classification = record(value); const options = record(classification.options); const matrix = record(classification.productCustomerMatrix);
  return { options: { productGroups: rows<BusinessProductGroupOption>(options.productGroups), customerGroups: rows<BusinessClassificationOption>(options.customerGroups) }, productCustomerMatrix: { includeZeroProducts: matrix.includeZeroProducts === true, columns: rows<BusinessMatrixColumn>(matrix.columns), rows: rows<BusinessMatrixRow>(matrix.rows), totalsByUnit: rows<BusinessMatrixTotal>(matrix.totalsByUnit) } };
}

export async function loadBusinessReport(rawPeriod?: string, rawFilters: { productGroupId?: string; customerGroupId?: string; includeZeroProducts?: string | boolean } = {}): Promise<BusinessReport> {
  const period = normalizeReportPeriod(rawPeriod);
  const range = resolveReportRange(period);
  const requestedFilters: BusinessReportFilters = { productGroupId: optionalUuid(rawFilters.productGroupId), customerGroupId: optionalUuid(rawFilters.customerGroupId), includeZeroProducts: booleanFlag(rawFilters.includeZeroProducts) };
  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (requestedFilters.productGroupId) query.set('productGroupId', requestedFilters.productGroupId);
  if (requestedFilters.customerGroupId) query.set('customerGroupId', requestedFilters.customerGroupId);
  if (requestedFilters.includeZeroProducts) query.set('includeZeroProducts', 'true');
  try {
    const data = await requestCore<unknown>(`/api/reporting/sales?${query.toString()}`);
    if (!isRecord(data)) throw new Error('invalid_business_report');
    const reconciliation = record(data.reconciliation);
    if (reconciliation.ok !== true) throw new Error('business_reconciliation_failed');
    const quality = record(data.dataQuality);
    const warnings = rows<unknown>(quality.warnings).filter((value): value is string => typeof value === 'string');
    const breakdowns = record(data.breakdowns);
    const canonicalFilters = record(data.filters);
    return {
      period, from: range.from, to: range.to,
      generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : null,
      state: warnings.length ? 'partial' : 'ready', message: warnings.length ? 'Một phần dữ liệu lịch sử đang dùng tham chiếu danh mục hiện tại và được ghi rõ trong từng chiều.' : null,
      filters: { productGroupId: optionalUuid(canonicalFilters.productGroupId) ?? requestedFilters.productGroupId, customerGroupId: optionalUuid(canonicalFilters.customerGroupId) ?? requestedFilters.customerGroupId, includeZeroProducts: canonicalFilters.includeZeroProducts === true },
      summary: record(data.summary), comparison: record(data.comparison), reconciliation,
      breakdowns: {
        customerGroups: rows<BusinessRow>(breakdowns.customerGroups), customers: rows<BusinessRow>(breakdowns.customers), products: rows<BusinessRow>(breakdowns.products),
        productGroups: rows<BusinessRow>(breakdowns.productGroups), channels: rows<BusinessRow>(breakdowns.channels), employees: rows<BusinessRow>(breakdowns.employees),
      },
      classification: classificationOf(data.classification),
      trend: rows(data.dailyTrend), documents: rows(data.documents), warnings,
    };
  } catch (error) {
    const state = error instanceof CoreApiError && error.statusCode === 403 ? 'forbidden' : 'error';
    return { period, from: range.from, to: range.to, generatedAt: null, state, message: state === 'forbidden' ? 'Tài khoản hiện tại không có quyền xem Báo cáo Kinh doanh.' : 'Không thể tải Báo cáo Kinh doanh hoặc dữ liệu chưa đối soát khớp.', filters: requestedFilters, summary: {}, comparison: {}, breakdowns: EMPTY_BREAKDOWNS, classification: EMPTY_CLASSIFICATION, trend: [], reconciliation: {}, documents: [], warnings: [] };
  }
}
