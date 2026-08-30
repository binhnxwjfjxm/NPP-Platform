import 'server-only';

import { CoreApiError, requestCore } from '../../lib/core-api';
import { normalizeReportPeriod, resolveReportRange, type ReportPeriod } from './report-data';

type JsonRecord = Record<string, unknown>;
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
  summary: JsonRecord;
  comparison: JsonRecord;
  breakdowns: Record<BusinessBreakdownKey, BusinessRow[]>;
  trend: JsonRecord[];
  reconciliation: JsonRecord;
  documents: JsonRecord[];
  warnings: string[];
};

const EMPTY_BREAKDOWNS: Record<BusinessBreakdownKey, BusinessRow[]> = {
  customerGroups: [], customers: [], products: [], productGroups: [], channels: [], employees: [],
};

function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function record(value: unknown): JsonRecord { return isRecord(value) ? value : {}; }
function rows<T = JsonRecord>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }

export async function loadBusinessReport(rawPeriod?: string): Promise<BusinessReport> {
  const period = normalizeReportPeriod(rawPeriod);
  const range = resolveReportRange(period);
  const query = new URLSearchParams({ from: range.from, to: range.to });
  try {
    const data = await requestCore<unknown>(`/api/reporting/sales?${query.toString()}`);
    if (!isRecord(data)) throw new Error('invalid_business_report');
    const reconciliation = record(data.reconciliation);
    if (reconciliation.ok !== true) throw new Error('business_reconciliation_failed');
    const quality = record(data.dataQuality);
    const warnings = rows<unknown>(quality.warnings).filter((value): value is string => typeof value === 'string');
    const breakdowns = record(data.breakdowns);
    return {
      period, from: range.from, to: range.to,
      generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : null,
      state: warnings.length ? 'partial' : 'ready', message: warnings.length ? 'Một phần dữ liệu lịch sử đang dùng tham chiếu danh mục hiện tại và được ghi rõ trong từng chiều.' : null,
      summary: record(data.summary), comparison: record(data.comparison), reconciliation,
      breakdowns: {
        customerGroups: rows<BusinessRow>(breakdowns.customerGroups), customers: rows<BusinessRow>(breakdowns.customers), products: rows<BusinessRow>(breakdowns.products),
        productGroups: rows<BusinessRow>(breakdowns.productGroups), channels: rows<BusinessRow>(breakdowns.channels), employees: rows<BusinessRow>(breakdowns.employees),
      },
      trend: rows(data.dailyTrend), documents: rows(data.documents), warnings,
    };
  } catch (error) {
    const state = error instanceof CoreApiError && error.statusCode === 403 ? 'forbidden' : 'error';
    return { period, from: range.from, to: range.to, generatedAt: null, state, message: state === 'forbidden' ? 'Tài khoản hiện tại không có quyền xem Báo cáo Kinh doanh.' : 'Không thể tải Báo cáo Kinh doanh hoặc dữ liệu chưa đối soát khớp.', summary: {}, comparison: {}, breakdowns: EMPTY_BREAKDOWNS, trend: [], reconciliation: {}, documents: [], warnings: [] };
  }
}
