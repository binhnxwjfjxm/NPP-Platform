import 'server-only';

import { CoreApiError, requestCore } from '../../lib/core-api';

export type ReportDomain =
  | 'executive'
  | 'sales-profit'
  | 'debt'
  | 'inventory'
  | 'delivery-cod'
  | 'mcp'
  | 'people'
  | 'decisions';

export type ReportState = 'ready' | 'partial' | 'empty' | 'forbidden' | 'error' | 'unavailable';

type JsonRecord = Record<string, unknown>;
type SourceResult =
  | { ok: true; data: JsonRecord }
  | { ok: false; state: 'forbidden' | 'error'; message: string };

export type ReportMetric = {
  label: string;
  value: string;
  note: string;
};

export type ReportTrendPoint = {
  label: string;
  value: number;
  display: string;
};

export type ReportPresentation = {
  id: string;
  domain: ReportDomain;
  domainLabel: string;
  title: string;
  summary: string;
  source: string;
  state: ReportState;
  stateLabel: string;
  stateMessage: string;
  periodLabel: string;
  generatedAt: string | null;
  primary: { label: string; value: string };
  metrics: ReportMetric[];
  trend: ReportTrendPoint[];
  trendLabel: string | null;
  trendNote: string;
  highlights: string[];
  details: Array<{ label: string; value: string }>;
};

type ReportDefinition = {
  id: string;
  domain: ReportDomain;
  domainLabel: string;
  title: string;
  summary: string;
  source: string;
};

export const reportDefinitions: Record<ReportDomain, ReportDefinition> = {
  executive: {
    id: 'executive-overview',
    domain: 'executive',
    domainLabel: 'Điều hành',
    title: 'Tổng quan điều hành',
    summary: 'Tổng hợp các chỉ số quản trị chính trong phạm vi quyền hiện tại.',
    source: 'Tổng hợp điều hành của Công Ty',
  },
  'sales-profit': {
    id: 'sales-profit-summary',
    domain: 'sales-profit',
    domainLabel: 'Kinh doanh & lợi nhuận',
    title: 'Kinh doanh và lợi nhuận',
    summary: 'Theo dõi doanh thu xác nhận và lãi gộp đã có giá vốn đối chiếu.',
    source: 'Kinh doanh và lãi gộp của Công Ty',
  },
  debt: {
    id: 'debt-aging',
    domain: 'debt',
    domainLabel: 'Công nợ',
    title: 'Công nợ hiện tại',
    summary: 'Theo dõi tuổi nợ phải thu và phải trả theo số dư còn lại hiện tại.',
    source: 'Công nợ của Công Ty',
  },
  inventory: {
    id: 'inventory-overview',
    domain: 'inventory',
    domainLabel: 'Kho',
    title: 'Tồn kho và giá trị tồn',
    summary: 'Theo dõi tồn hiện tại, giá trị tồn và các điểm cần đối soát giá vốn.',
    source: 'Kho của Công Ty',
  },
  'delivery-cod': {
    id: 'delivery-cod-overview',
    domain: 'delivery-cod',
    domainLabel: 'Giao vận & COD',
    title: 'Giao vận và COD',
    summary: 'Theo dõi kết quả giao hàng, đúng hẹn và tiền COD đang trong quá trình bàn giao.',
    source: 'Giao vận và COD của Công Ty',
  },
  mcp: {
    id: 'mcp-market',
    domain: 'mcp',
    domainLabel: 'MCP / thị trường',
    title: 'MCP và thị trường',
    summary: 'Theo dõi lượt đi tuyến, điểm ghé, nhu cầu đặt hàng và chuyển đổi sang đơn Công Ty.',
    source: 'Hoạt động MCP đã đồng bộ về Công Ty',
  },
  people: {
    id: 'people-performance',
    domain: 'people',
    domainLabel: 'Nhân sự / hiệu suất',
    title: 'Hiệu suất nhân sự thị trường',
    summary: 'Theo dõi hiệu suất nhân viên theo dữ liệu tuyến và lượt ghé đã ghi nhận.',
    source: 'Hiệu suất nhân viên từ MCP',
  },
  decisions: {
    id: 'decisions-alerts',
    domain: 'decisions',
    domainLabel: 'Đề xuất & cảnh báo',
    title: 'Đề xuất và cảnh báo',
    summary: 'Khu vực dành cho đề xuất quản trị và cảnh báo đã được chuẩn hóa.',
    source: 'Chưa có nguồn đề xuất chính thức',
  },
};

const PERIODS = ['Hôm nay', '7 ngày', 'Tháng này', 'Quý này'] as const;
export type ReportPeriod = (typeof PERIODS)[number];
export const reportPeriods: readonly ReportPeriod[] = PERIODS;

const FAMILY_LABELS: Record<string, string> = {
  sales: 'Kinh doanh',
  purchasing: 'Mua hàng',
  inventory: 'Kho',
  aging: 'Công nợ',
  grossMargin: 'Lãi gộp',
  employeeMcp: 'MCP',
  logistics: 'Giao vận',
  cod: 'COD',
};

const STATE_LABELS: Record<ReportState, string> = {
  ready: 'Bình thường',
  partial: 'Dữ liệu chưa đầy đủ',
  empty: 'Không có dữ liệu',
  forbidden: 'Không có quyền',
  error: 'Không thể tải dữ liệu',
  unavailable: 'Chưa có dữ liệu',
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(row: JsonRecord, key: string): string | null {
  const value = row[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numericValue(row: JsonRecord, key: string): number | null {
  const value = row[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function integerText(row: JsonRecord, key: string): string {
  const value = numericValue(row, key);
  return value === null ? 'Chưa có dữ liệu' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value);
}

function percentText(row: JsonRecord, key: string): string {
  const value = numericValue(row, key);
  return value === null
    ? 'Chưa có dữ liệu'
    : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)}%`;
}

function moneyText(value: number | null, currency = 'VND'): string {
  if (value === null) return 'Chưa có dữ liệu';
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

function moneyFromRow(row: JsonRecord, key: string, currency = 'VND'): string {
  return moneyText(numericValue(row, key), currency);
}

function currencyRowsText(value: unknown, amountKey: string): string {
  const parts = rows(value).flatMap((row) => {
    const amount = numericValue(row, amountKey);
    const currency = stringValue(row, 'currencyCode');
    if (amount === null || !currency) return [];
    return [moneyText(amount, currency)];
  });
  return parts.length ? parts.join(' · ') : 'Không có dữ liệu';
}

function bucketAmount(value: unknown, bucket: string): string {
  const matched = rows(value).filter((row) => stringValue(row, 'ageBucket') === bucket);
  if (!matched.length) return 'Không phát sinh';
  const parts = matched.flatMap((row) => {
    const amount = numericValue(row, 'remainingAmount');
    const currency = stringValue(row, 'currencyCode');
    if (amount === null || !currency) return [];
    return [moneyText(amount, currency)];
  });
  return parts.length ? parts.join(' · ') : 'Chưa có dữ liệu';
}

function metric(label: string, value: string, note: string): ReportMetric {
  return { label, value, note };
}

function dateParts(now = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(mapped.year), month: Number(mapped.month), day: Number(mapped.day) };
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function normalizeReportPeriod(value: string | undefined): ReportPeriod {
  return PERIODS.includes(value as ReportPeriod) ? value as ReportPeriod : 'Tháng này';
}

export function resolveReportRange(period: ReportPeriod, now = new Date()): { from: string; to: string; label: string } {
  const { year, month, day } = dateParts(now);
  const today = new Date(Date.UTC(year, month - 1, day));
  let start = new Date(today);
  if (period === '7 ngày') {
    start.setUTCDate(start.getUTCDate() - 6);
  } else if (period === 'Tháng này') {
    start = new Date(Date.UTC(year, month - 1, 1));
  } else if (period === 'Quý này') {
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3;
    start = new Date(Date.UTC(year, quarterStartMonth, 1));
  }
  return { from: dateString(start), to: dateString(today), label: period };
}

function withRange(path: string, range: { from: string; to: string }): string {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  return `${path}?${query.toString()}`;
}

async function loadSource(path: string): Promise<SourceResult> {
  try {
    const data = await requestCore<unknown>(path);
    if (!isRecord(data)) {
      return { ok: false, state: 'error', message: 'Không thể tải dữ liệu.' };
    }
    return { ok: true, data };
  } catch (error) {
    if (error instanceof CoreApiError && error.statusCode === 403) {
      return { ok: false, state: 'forbidden', message: 'Không có quyền xem nhóm báo cáo này.' };
    }
    return { ok: false, state: 'error', message: 'Không thể tải dữ liệu.' };
  }
}

function sourceState(results: SourceResult[], qualityPartial = false): ReportState {
  const successes = results.filter((result) => result.ok).length;
  if (successes === results.length) return qualityPartial ? 'partial' : 'ready';
  if (successes > 0) return 'partial';
  return results.every((result) => !result.ok && result.state === 'forbidden') ? 'forbidden' : 'error';
}

function failureHighlights(results: SourceResult[], labels: string[]): string[] {
  return results.flatMap((result, index) => result.ok ? [] : [`${labels[index]}: ${result.message}`]);
}

function stateMessage(state: ReportState): string {
  if (state === 'ready') return 'Số liệu đã tải từ nguồn quản trị của Công Ty.';
  if (state === 'partial') return 'Một phần số liệu chưa sẵn sàng; phần đã tải vẫn được giữ nguyên.';
  if (state === 'empty') return 'Không có dữ liệu trong phạm vi đang xem.';
  if (state === 'forbidden') return 'Tài khoản hiện tại không có quyền xem nhóm báo cáo này.';
  if (state === 'unavailable') return 'Nguồn dữ liệu chính thức cho nhóm này chưa được mở.';
  return 'Không thể tải dữ liệu ở thời điểm hiện tại.';
}

function generatedAtOf(...sources: SourceResult[]): string | null {
  for (const source of sources) {
    if (!source.ok) continue;
    const generatedAt = stringValue(source.data, 'generatedAt');
    if (generatedAt) return generatedAt;
  }
  return null;
}

function detailRows(range: { from: string; to: string }, generatedAt: string | null): Array<{ label: string; value: string }> {
  return [
    { label: 'Từ ngày', value: range.from },
    { label: 'Đến ngày', value: range.to },
    { label: 'Múi giờ', value: 'Việt Nam (UTC+7)' },
    { label: 'Cập nhật', value: generatedAt ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(generatedAt)) : 'Chưa có dữ liệu' },
  ];
}

function basePresentation(
  domain: ReportDomain,
  range: { from: string; to: string; label: string },
  state: ReportState,
  generatedAt: string | null,
): Omit<ReportPresentation, 'primary' | 'metrics' | 'trend' | 'trendLabel' | 'trendNote' | 'highlights'> {
  const definition = reportDefinitions[domain];
  return {
    ...definition,
    state,
    stateLabel: STATE_LABELS[state],
    stateMessage: stateMessage(state),
    periodLabel: range.label,
    generatedAt,
    details: detailRows(range, generatedAt),
  };
}

function warningHighlights(value: unknown): string[] {
  return rows(value).map((warning) => {
    const family = stringValue(warning, 'family') ?? 'dữ liệu';
    return `${FAMILY_LABELS[family] ?? family}: chưa tải đủ số liệu.`;
  });
}

function buildExecutive(range: { from: string; to: string; label: string }, source: SourceResult): ReportPresentation {
  if (!source.ok) {
    const base = basePresentation('executive', range, source.state, null);
    return {
      ...base,
      primary: { label: 'Tổng quan', value: source.message },
      metrics: [],
      trend: [],
      trendLabel: null,
      trendNote: 'Chưa có chuỗi diễn biến.',
      highlights: [source.message],
    };
  }
  const management = record(source.data.management);
  const sales = record(management.sales);
  const grossMargin = record(management.grossMargin);
  const inventory = record(management.inventory);
  const logistics = record(management.logistics);
  const salesSummary = record(sales.summary);
  const grossSummary = record(grossMargin.summary);
  const inventorySummary = record(inventory.summary);
  const logisticsSummary = record(logistics.summary);
  const warnings = warningHighlights(source.data.warnings);
  const qualityPartial =
    (numericValue(grossSummary, 'missingCostCount') ?? 0) > 0
    || (numericValue(grossSummary, 'costAnomalyCount') ?? 0) > 0
    || record(inventory.projectionState).quantityProjectionStale === true;
  const state: ReportState = warnings.length || qualityPartial ? 'partial' : 'ready';
  const revenue = currencyRowsText(sales.currencyTotals, 'totalValue');
  const generatedAt = stringValue(source.data, 'generatedAt');
  const base = basePresentation('executive', range, state, generatedAt);
  const highlights = [...warnings];
  if ((numericValue(grossSummary, 'missingCostCount') ?? 0) > 0) highlights.push('Một phần doanh thu chưa có giá vốn để tính lãi gộp.');
  if ((numericValue(grossSummary, 'costAnomalyCount') ?? 0) > 0) highlights.push('Có dòng giá vốn cần đối soát.');
  if (record(inventory.projectionState).quantityProjectionStale === true) highlights.push('Số chiếu tồn kho đang chậm hơn sổ kho.');
  if (!highlights.length) highlights.push('Các nguồn quản trị trong phạm vi quyền hiện tại đã phản hồi.');
  return {
    ...base,
    primary: { label: 'Doanh thu kỳ', value: revenue },
    metrics: [
      metric('Doanh thu', revenue, 'Theo đơn đã xác nhận/đóng; không gộp chéo loại tiền.'),
      metric('Lãi gộp', moneyFromRow(grossSummary, 'grossMarginVnd'), 'Chỉ phần có giá vốn so sánh được bằng VND.'),
      metric('Giá trị tồn', moneyFromRow(inventorySummary, 'inventoryValueVnd'), 'Giá trị tồn đã có giá vốn.'),
      metric('Giao đủ', integerText(logisticsSummary, 'deliveredFullCount'), 'Số kết quả giao đủ trong kỳ.'),
    ],
    trend: [],
    trendLabel: null,
    trendNote: 'Tổng quan điều hành không gộp các chuỗi khác đơn vị vào một biểu đồ.',
    highlights,
  };
}

function salesTrend(data: JsonRecord): { points: ReportTrendPoint[]; label: string | null; note: string } {
  const trendRows = rows(data.dailyTrend);
  const currencies = [...new Set(trendRows.map((row) => stringValue(row, 'currencyCode')).filter((value): value is string => Boolean(value)))];
  if (!trendRows.length) return { points: [], label: null, note: 'Không có dữ liệu diễn biến trong kỳ.' };
  if (currencies.length !== 1) return { points: [], label: null, note: 'Có nhiều loại tiền nên không gộp vào một biểu đồ.' };
  const currency = currencies[0];
  const points = trendRows.flatMap((row) => {
    const value = numericValue(row, 'totalValue');
    const day = stringValue(row, 'businessDate');
    if (value === null || !day) return [];
    return [{ label: day, value, display: moneyText(value, currency) }];
  });
  return { points, label: `Doanh thu ${currency}`, note: points.length ? 'Diễn biến doanh thu theo ngày từ số liệu Công Ty.' : 'Không có dữ liệu diễn biến trong kỳ.' };
}

function buildSalesProfit(
  range: { from: string; to: string; label: string },
  salesSource: SourceResult,
  marginSource: SourceResult,
): ReportPresentation {
  const salesData = salesSource.ok ? salesSource.data : {};
  const marginData = marginSource.ok ? marginSource.data : {};
  const salesSummary = record(salesData.summary);
  const marginSummary = record(marginData.summary);
  const qualityPartial =
    (numericValue(marginSummary, 'missingCostCount') ?? 0) > 0
    || (numericValue(marginSummary, 'costAnomalyCount') ?? 0) > 0
    || (numericValue(marginSummary, 'nonVndCount') ?? 0) > 0;
  const state = sourceState([salesSource, marginSource], qualityPartial);
  const generatedAt = generatedAtOf(salesSource, marginSource);
  const base = basePresentation('sales-profit', range, state, generatedAt);
  const revenue = salesSource.ok ? currencyRowsText(salesData.currencyTotals, 'totalValue') : 'Chưa có dữ liệu';
  const trend = salesSource.ok ? salesTrend(salesData) : { points: [], label: null, note: 'Không thể tải diễn biến doanh thu.' };
  const highlights = failureHighlights([salesSource, marginSource], ['Kinh doanh', 'Lãi gộp']);
  const missingCost = numericValue(marginSummary, 'missingCostCount') ?? 0;
  const costAnomaly = numericValue(marginSummary, 'costAnomalyCount') ?? 0;
  const nonVnd = numericValue(marginSummary, 'nonVndCount') ?? 0;
  if (missingCost > 0) highlights.push(`${integerText(marginSummary, 'missingCostCount')} dòng chưa có giá vốn để so sánh.`);
  if (costAnomaly > 0) highlights.push(`${integerText(marginSummary, 'costAnomalyCount')} dòng giá vốn cần đối soát.`);
  if (nonVnd > 0) highlights.push(`${integerText(marginSummary, 'nonVndCount')} dòng ngoại tệ được tách riêng, không trộn vào lãi gộp VND.`);
  if (!highlights.length) highlights.push('Doanh thu và lãi gộp đã tải từ nguồn Công Ty trong kỳ đã chọn.');
  return {
    ...base,
    primary: { label: 'Doanh thu kỳ', value: revenue },
    metrics: [
      metric('Doanh thu', revenue, 'Theo đơn đã xác nhận/đóng; giữ riêng từng loại tiền.'),
      metric('Lãi gộp', marginSource.ok ? moneyFromRow(marginSummary, 'grossMarginVnd') : 'Chưa có dữ liệu', 'Phần doanh thu VND có giá vốn đối chiếu được.'),
      metric('Tỷ lệ lãi gộp', marginSource.ok ? percentText(marginSummary, 'grossMarginPercent') : 'Chưa có dữ liệu', 'Không tính các dòng thiếu giá vốn hoặc không so sánh được.'),
      metric('Đơn hiệu lực', salesSource.ok ? integerText(salesSummary, 'effectiveOrderCount') : 'Chưa có dữ liệu', 'Đơn đã xác nhận hoặc đã đóng.'),
    ],
    trend: trend.points,
    trendLabel: trend.label,
    trendNote: trend.note,
    highlights,
  };
}

function buildDebt(range: { from: string; to: string; label: string }, source: SourceResult): ReportPresentation {
  const debtRange = { ...range, label: 'Số dư hiện tại' };
  if (!source.ok) {
    const base = basePresentation('debt', debtRange, source.state, null);
    return {
      ...base,
      primary: { label: 'Công nợ', value: source.message },
      metrics: [],
      trend: [],
      trendLabel: null,
      trendNote: 'Công nợ dùng số dư hiện tại, không dựng diễn biến lịch sử.',
      highlights: [source.message],
    };
  }
  const receivable = record(source.data.receivable);
  const payable = record(source.data.payable);
  const ar = receivable.summary;
  const ap = payable.summary;
  const generatedAt = stringValue(source.data, 'generatedAt');
  const base = basePresentation('debt', debtRange, 'ready', generatedAt);
  return {
    ...base,
    primary: { label: 'Phải thu 91+ ngày', value: bucketAmount(ar, 'AGE_91_PLUS') },
    metrics: [
      metric('Phải thu 91+ ngày', bucketAmount(ar, 'AGE_91_PLUS'), 'Số dư phải thu hiện tại theo tuổi chứng từ.'),
      metric('Phải thu 61–90 ngày', bucketAmount(ar, 'AGE_61_90'), 'Số dư phải thu hiện tại theo tuổi chứng từ.'),
      metric('Phải trả quá hạn 91+ ngày', bucketAmount(ap, 'OVERDUE_91_PLUS'), 'Số dư phải trả hiện tại theo ngày đến hạn.'),
      metric('Phải trả chưa đến hạn', bucketAmount(ap, 'NOT_DUE'), 'Số dư phải trả chưa đến hạn.'),
    ],
    trend: [],
    trendLabel: null,
    trendNote: 'Công nợ hiện dùng số dư hiện tại; hệ thống không nhận bộ lọc kỳ lịch sử cho báo cáo này.',
    highlights: ['Tuổi nợ được giữ theo từng loại tiền; không cộng chéo các loại tiền.', 'Kỳ chọn ở đầu màn hình không làm thay đổi số dư công nợ hiện tại.'],
  };
}

function buildInventory(range: { from: string; to: string; label: string }, source: SourceResult): ReportPresentation {
  if (!source.ok) {
    const base = basePresentation('inventory', range, source.state, null);
    return {
      ...base,
      primary: { label: 'Giá trị tồn', value: source.message },
      metrics: [],
      trend: [],
      trendLabel: null,
      trendNote: 'Chưa có chuỗi diễn biến.',
      highlights: [source.message],
    };
  }
  const summary = record(source.data.summary);
  const projection = record(source.data.projectionState);
  const costingExceptions = numericValue(summary, 'costingExceptionCount') ?? 0;
  const stale = projection.quantityProjectionStale === true;
  const state: ReportState = costingExceptions > 0 || stale ? 'partial' : 'ready';
  const generatedAt = stringValue(source.data, 'generatedAt');
  const base = basePresentation('inventory', range, state, generatedAt);
  const highlights: string[] = [];
  if (costingExceptions > 0) highlights.push(`${integerText(summary, 'costingExceptionCount')} vị trí tồn cần đối soát giá vốn.`);
  if (stale) highlights.push('Số chiếu tồn kho đang chậm hơn sổ kho.');
  if (!highlights.length) highlights.push('Tồn lượng và giá trị tồn đã tải trong phạm vi kho được cấp quyền.');
  return {
    ...base,
    primary: { label: 'Giá trị tồn', value: moneyFromRow(summary, 'inventoryValueVnd') },
    metrics: [
      metric('Giá trị tồn', moneyFromRow(summary, 'inventoryValueVnd'), 'Giá trị tồn VND đã có giá vốn.'),
      metric('SKU đang có tồn', integerText(summary, 'stockedSkuCount'), 'Số SKU có tồn thực tế dương.'),
      metric('Vị trí đang giữ hàng', integerText(summary, 'reservedPositionCount'), 'Vị trí có lượng đang được giữ cho đơn.'),
      metric('Điểm cần đối soát giá vốn', integerText(summary, 'costingExceptionCount'), 'Không chuyển dữ liệu thiếu thành số 0.'),
    ],
    trend: [],
    trendLabel: null,
    trendNote: 'Nhóm Kho hiện hiển thị ảnh chụp tồn và luồng kỳ, không dựng chuỗi giá trị tồn giả.',
    highlights,
  };
}

function buildDeliveryCod(
  range: { from: string; to: string; label: string },
  logisticsSource: SourceResult,
  codSource: SourceResult,
): ReportPresentation {
  const logistics = logisticsSource.ok ? logisticsSource.data : {};
  const cod = codSource.ok ? codSource.data : {};
  const logisticsSummary = record(logistics.summary);
  const dataQuality = record(logistics.dataQuality);
  const codSnapshot = record(cod.currentSnapshot);
  const codExceptions = record(cod.exceptions);
  const qualityCount =
    rows(dataQuality.exceptions).reduce((total, row) => total + (numericValue(row, 'exceptionCount') ?? 0), 0)
    + rows(codExceptions.lifecycle).length
    + rows(codExceptions.currencyLineage).length;
  const state = sourceState([logisticsSource, codSource], qualityCount > 0);
  const generatedAt = generatedAtOf(logisticsSource, codSource);
  const base = basePresentation('delivery-cod', range, state, generatedAt);
  const custody = codSource.ok ? currencyRowsText(codSnapshot.custodyByCurrency, 'custodyRemainingAmount') : 'Chưa có dữ liệu';
  const highlights = failureHighlights([logisticsSource, codSource], ['Giao vận', 'COD']);
  if (rows(codSnapshot.pendingHandovers).length) highlights.push(`${rows(codSnapshot.pendingHandovers).length} lượt bàn giao COD đang chờ tiếp nhận.`);
  if (rows(codSnapshot.discrepancies).length) highlights.push(`${rows(codSnapshot.discrepancies).length} lượt bàn giao COD có chênh lệch.`);
  if (rows(codSnapshot.overduePromises).length) highlights.push(`${rows(codSnapshot.overduePromises).length} khoản hẹn thu đã quá hạn.`);
  if (qualityCount > 0) highlights.push('Có dữ liệu giao vận/COD cần đối soát trước khi kết luận.');
  if (!highlights.length) highlights.push('Giao vận và COD đã tải từ nguồn Công Ty trong kỳ đã chọn.');
  return {
    ...base,
    primary: { label: 'Tỷ lệ giao đủ đúng hẹn', value: logisticsSource.ok ? percentText(logisticsSummary, 'onTimeFullRatePercent') : 'Chưa có dữ liệu' },
    metrics: [
      metric('Giao đủ đúng hẹn', logisticsSource.ok ? percentText(logisticsSummary, 'onTimeFullRatePercent') : 'Chưa có dữ liệu', 'Chỉ tính các lượt giao đủ có giờ dự kiến.'),
      metric('Giao đủ', logisticsSource.ok ? integerText(logisticsSummary, 'deliveredFullCount') : 'Chưa có dữ liệu', 'Kết quả giao đủ trong kỳ.'),
      metric('Giao một phần', logisticsSource.ok ? integerText(logisticsSummary, 'deliveredPartialCount') : 'Chưa có dữ liệu', 'Kết quả giao một phần trong kỳ.'),
      metric('COD đang giữ', custody, 'Tiền mặt COD còn trong trách nhiệm bàn giao, giữ riêng từng loại tiền.'),
    ],
    trend: [],
    trendLabel: null,
    trendNote: 'Không gộp tỷ lệ giao hàng và số tiền COD vào cùng một biểu đồ.',
    highlights,
  };
}

function buildMcp(
  domain: 'mcp' | 'people',
  range: { from: string; to: string; label: string },
  source: SourceResult,
): ReportPresentation {
  if (!source.ok) {
    const base = basePresentation(domain, range, source.state, null);
    return {
      ...base,
      primary: { label: domain === 'mcp' ? 'Lượt ghé' : 'Hiệu suất', value: source.message },
      metrics: [],
      trend: [],
      trendLabel: null,
      trendNote: 'Chưa có chuỗi diễn biến.',
      highlights: [source.message],
    };
  }
  const summary = record(source.data.summary);
  const dataQuality = record(source.data.dataQuality);
  const unmapped = rows(dataQuality.unmappedActors);
  const mismatches = rows(dataQuality.counterMismatches);
  const state: ReportState = unmapped.length || mismatches.length ? 'partial' : 'ready';
  const generatedAt = stringValue(source.data, 'generatedAt');
  const base = basePresentation(domain, range, state, generatedAt);
  const highlights: string[] = [];
  if (unmapped.length) highlights.push(`${unmapped.length} mã nhân viên thị trường chưa khớp hồ sơ nhân viên Công Ty.`);
  if (mismatches.length) highlights.push(`${mismatches.length} phiên có bộ đếm cần đối soát với dữ liệu chi tiết.`);
  if (!highlights.length) highlights.push('Dữ liệu tuyến và lượt ghé đã tải theo phạm vi nhân viên được cấp quyền.');
  if (domain === 'mcp') {
    return {
      ...base,
      primary: { label: 'Điểm đã ghé', value: integerText(summary, 'visitedOutletCount') },
      metrics: [
        metric('Điểm kế hoạch', integerText(summary, 'plannedOutletCount'), 'Điểm trong kế hoạch tuyến.'),
        metric('Điểm đã ghé', integerText(summary, 'visitedOutletCount'), 'Điểm có trạng thái đã ghé.'),
        metric('Nhu cầu đặt hàng', integerText(summary, 'orderIntentCount'), 'Nhu cầu đặt hàng được ghi nhận trên MCP.'),
        metric('Đơn Công Ty', integerText(summary, 'coreSalesOrderCount'), 'Nhu cầu đã có liên kết đơn Công Ty.'),
      ],
      trend: [],
      trendLabel: null,
      trendNote: 'Màn hình này không suy diễn vị trí đúng/sai chỉ từ trạng thái ghi nhận điểm ghé.',
      highlights,
    };
  }
  return {
    ...base,
    primary: { label: 'Tỷ lệ ghé kế hoạch', value: percentText(summary, 'plannedVisitRatePercent') },
    metrics: [
      metric('Tỷ lệ ghé kế hoạch', percentText(summary, 'plannedVisitRatePercent'), 'Tỷ lệ điểm kế hoạch đã ghé.'),
      metric('Chuyển đổi nhu cầu', percentText(summary, 'orderIntentConversionPercent'), 'Nhu cầu đặt hàng trên số điểm đã ghé.'),
      metric('Phiên đã khớp nhân viên', integerText(summary, 'mappedEmployeeSessionCount'), 'Phiên có mã nhân viên khớp hồ sơ Công Ty.'),
      metric('Phiên chưa khớp nhân viên', integerText(summary, 'unmappedEmployeeSessionCount'), 'Phiên cần đối soát mã nhân viên.'),
    ],
    trend: [],
    trendLabel: null,
    trendNote: 'Hiệu suất dùng trực tiếp số liệu MCP đã tổng hợp; không tự chấm điểm nhân viên.',
    highlights,
  };
}

function buildDecisions(range: { from: string; to: string; label: string }): ReportPresentation {
  const base = basePresentation('decisions', range, 'unavailable', null);
  return {
    ...base,
    primary: { label: 'Đề xuất chính thức', value: 'Chưa có dữ liệu' },
    metrics: [],
    trend: [],
    trendLabel: null,
    trendNote: 'Chưa có nguồn đề xuất và cảnh báo chính thức để hiển thị.',
    highlights: ['Không dùng dữ liệu mẫu để thay cho đề xuất hoặc cảnh báo thực tế.'],
  };
}

export function reportDomainFromId(reportId: string): ReportDomain | null {
  const found = Object.values(reportDefinitions).find((definition) => definition.id === reportId);
  return found?.domain ?? null;
}

export async function loadReportPresentation(domain: ReportDomain, period: ReportPeriod): Promise<ReportPresentation> {
  const range = resolveReportRange(period);
  if (domain === 'decisions') return buildDecisions(range);
  if (domain === 'executive') {
    const source = await loadSource(withRange('/api/reporting/control-tower', range));
    return buildExecutive(range, source);
  }
  if (domain === 'sales-profit') {
    const [sales, margin] = await Promise.all([
      loadSource(withRange('/api/reporting/sales', range)),
      loadSource(withRange('/api/reporting/gross-margin', range)),
    ]);
    return buildSalesProfit(range, sales, margin);
  }
  if (domain === 'debt') {
    const source = await loadSource('/api/reporting/aging');
    return buildDebt(range, source);
  }
  if (domain === 'inventory') {
    const source = await loadSource(withRange('/api/reporting/inventory', range));
    return buildInventory(range, source);
  }
  if (domain === 'delivery-cod') {
    const [logistics, cod] = await Promise.all([
      loadSource(withRange('/api/reporting/logistics', range)),
      loadSource(withRange('/api/reporting/cod', range)),
    ]);
    return buildDeliveryCod(range, logistics, cod);
  }
  const source = await loadSource(withRange('/api/reporting/employee-mcp', range));
  return buildMcp(domain, range, source);
}
