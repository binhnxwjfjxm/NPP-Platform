import 'server-only';

import { CoreApiError, requestCore } from '../../lib/core-api';

export type ReportDomain =
  | 'executive'
  | 'sales'
  | 'profit'
  | 'debt'
  | 'inventory'
  | 'delivery-cod'
  | 'mcp'
  | 'people'
  | 'decisions';

export type ReportState = 'ready' | 'partial' | 'empty' | 'forbidden' | 'error' | 'unavailable';
type JsonRecord = Record<string, unknown>;
type SourceResult = { ok: true; data: JsonRecord } | { ok: false; state: 'forbidden' | 'error'; message: string };

export type ReportMetric = { label: string; value: string; note: string };
export type ReportTrendPoint = { label: string; value: number; display: string };
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

type ReportDefinition = Pick<ReportPresentation, 'id' | 'domain' | 'domainLabel' | 'title' | 'summary' | 'source'>;

export const reportDefinitions: Record<ReportDomain, ReportDefinition> = {
  executive: { id: 'executive-overview', domain: 'executive', domainLabel: 'Điều hành', title: 'Tổng quan điều hành', summary: 'Tổng hợp các chỉ số quản trị chính trong phạm vi quyền hiện tại.', source: 'Tổng hợp điều hành của Công Ty' },
  sales: { id: 'sales-summary', domain: 'sales', domainLabel: 'Kinh doanh', title: 'Báo cáo Kinh doanh', summary: 'Theo dõi doanh thu, sản lượng và cơ cấu bán hàng theo các chiều nghiệp vụ.', source: 'Kinh doanh của Công Ty' },
  profit: { id: 'profit-summary', domain: 'profit', domainLabel: 'Lợi nhuận', title: 'Báo cáo Lợi nhuận', summary: 'Theo dõi lãi gộp trên phần doanh thu đã đối chiếu được giá vốn.', source: 'Lợi nhuận của Công Ty' },
  debt: { id: 'debt-aging', domain: 'debt', domainLabel: 'Công nợ', title: 'Công nợ hiện tại', summary: 'Theo dõi tuổi nợ phải thu và phải trả theo số dư còn lại hiện tại.', source: 'Công nợ của Công Ty' },
  inventory: { id: 'inventory-overview', domain: 'inventory', domainLabel: 'Kho', title: 'Tồn kho và giá trị tồn', summary: 'Theo dõi tồn hiện tại, giá trị tồn và các điểm cần đối soát giá vốn.', source: 'Kho của Công Ty' },
  'delivery-cod': { id: 'delivery-cod-overview', domain: 'delivery-cod', domainLabel: 'Giao vận & COD', title: 'Giao vận và COD', summary: 'Theo dõi kết quả giao hàng, đúng hẹn và tiền COD đang trong quá trình bàn giao.', source: 'Giao vận và COD của Công Ty' },
  mcp: { id: 'mcp-market', domain: 'mcp', domainLabel: 'MCP / thị trường', title: 'MCP và thị trường', summary: 'Theo dõi lượt đi tuyến, điểm ghé, nhu cầu đặt hàng và chuyển đổi sang đơn Công Ty.', source: 'Hoạt động MCP đã đồng bộ về Công Ty' },
  people: { id: 'people-performance', domain: 'people', domainLabel: 'Nhân sự / hiệu suất', title: 'Hiệu suất nhân sự thị trường', summary: 'Theo dõi hiệu suất nhân viên theo dữ liệu tuyến và lượt ghé đã ghi nhận.', source: 'Hiệu suất nhân viên từ MCP' },
  decisions: { id: 'decisions-alerts', domain: 'decisions', domainLabel: 'Đề xuất & cảnh báo', title: 'Đề xuất và cảnh báo', summary: 'Theo dõi các đề xuất cần quyết định và cảnh báo quản trị đang mở.', source: 'Đề xuất và cảnh báo quản trị của Công Ty' },
};

const PERIODS = ['Hôm nay', '7 ngày', 'Tháng này', 'Quý này'] as const;
export type ReportPeriod = (typeof PERIODS)[number];
export const reportPeriods: readonly ReportPeriod[] = PERIODS;
const FAMILY_LABELS: Record<string, string> = { sales: 'Kinh doanh', purchasing: 'Mua hàng', inventory: 'Kho', aging: 'Công nợ', grossMargin: 'Lãi gộp', employeeMcp: 'MCP', logistics: 'Giao vận', cod: 'COD' };
const STATE_LABELS: Record<ReportState, string> = { ready: 'Bình thường', partial: 'Dữ liệu chưa đầy đủ', empty: 'Không có dữ liệu', forbidden: 'Không có quyền', error: 'Không thể tải dữ liệu', unavailable: 'Chưa có dữ liệu' };

function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function record(value: unknown): JsonRecord { return isRecord(value) ? value : {}; }
function rows(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.filter(isRecord) : []; }
function stringValue(row: JsonRecord, key: string): string | null { const value = row[key]; if (typeof value === 'string' && value.trim()) return value.trim(); if (typeof value === 'number' && Number.isFinite(value)) return String(value); return null; }
function numericValue(row: JsonRecord, key: string): number | null { const value = row[key]; if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && value.trim()) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; } return null; }
function integerText(row: JsonRecord, key: string): string { const value = numericValue(row, key); return value === null ? 'Chưa có dữ liệu' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value); }
function percentText(row: JsonRecord, key: string): string { const value = numericValue(row, key); return value === null ? 'Chưa có dữ liệu' : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)}%`; }
function moneyText(value: number | null, currency = 'VND'): string { return value === null ? 'Chưa có dữ liệu' : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)} ${currency}`; }
function moneyFromRow(row: JsonRecord, key: string, currency = 'VND'): string { return moneyText(numericValue(row, key), currency); }
function metric(label: string, value: string, note: string): ReportMetric { return { label, value, note }; }
function currencyRowsText(value: unknown, amountKey: string): string { const parts = rows(value).flatMap((row) => { const amount = numericValue(row, amountKey); const currency = stringValue(row, 'currencyCode'); return amount === null || !currency ? [] : [moneyText(amount, currency)]; }); return parts.length ? parts.join(' · ') : 'Không có dữ liệu'; }
function bucketAmount(value: unknown, bucket: string): string { const parts = rows(value).filter((row) => stringValue(row, 'ageBucket') === bucket).flatMap((row) => { const amount = numericValue(row, 'remainingAmount'); const currency = stringValue(row, 'currencyCode'); return amount === null || !currency ? [] : [moneyText(amount, currency)]; }); return parts.length ? parts.join(' · ') : 'Không phát sinh'; }
function dateParts(now = new Date()): { year: number; month: number; day: number } { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now); const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value])); return { year: Number(mapped.year), month: Number(mapped.month), day: Number(mapped.day) }; }
function dateString(date: Date): string { return date.toISOString().slice(0, 10); }
export function normalizeReportPeriod(value: string | undefined): ReportPeriod { return PERIODS.includes(value as ReportPeriod) ? value as ReportPeriod : 'Tháng này'; }
export function resolveReportRange(period: ReportPeriod, now = new Date()): { from: string; to: string; label: string } { const { year, month, day } = dateParts(now); const today = new Date(Date.UTC(year, month - 1, day)); let start = new Date(today); if (period === '7 ngày') start.setUTCDate(start.getUTCDate() - 6); else if (period === 'Tháng này') start = new Date(Date.UTC(year, month - 1, 1)); else if (period === 'Quý này') start = new Date(Date.UTC(year, Math.floor((month - 1) / 3) * 3, 1)); return { from: dateString(start), to: dateString(today), label: period }; }
function withRange(path: string, range: { from: string; to: string }): string { const query = new URLSearchParams({ from: range.from, to: range.to }); return `${path}?${query.toString()}`; }
async function loadSource(path: string): Promise<SourceResult> { try { const data = await requestCore<unknown>(path); return isRecord(data) ? { ok: true, data } : { ok: false, state: 'error', message: 'Không thể tải dữ liệu.' }; } catch (error) { return error instanceof CoreApiError && error.statusCode === 403 ? { ok: false, state: 'forbidden', message: 'Không có quyền xem nhóm báo cáo này.' } : { ok: false, state: 'error', message: 'Không thể tải dữ liệu.' }; } }
function sourceState(results: SourceResult[], qualityPartial = false): ReportState { const successes = results.filter((result) => result.ok).length; if (successes === results.length) return qualityPartial ? 'partial' : 'ready'; if (successes > 0) return 'partial'; return results.every((result) => !result.ok && result.state === 'forbidden') ? 'forbidden' : 'error'; }
function failureHighlights(results: SourceResult[], labels: string[]): string[] { return results.flatMap((result, index) => result.ok ? [] : [`${labels[index]}: ${result.message}`]); }
function stateMessage(state: ReportState): string { if (state === 'ready') return 'Số liệu đã tải từ nguồn quản trị của Công Ty.'; if (state === 'partial') return 'Một phần số liệu cần đối soát; phần đã xác nhận vẫn được giữ nguyên.'; if (state === 'empty') return 'Không có dữ liệu trong phạm vi đang xem.'; if (state === 'forbidden') return 'Tài khoản hiện tại không có quyền xem nhóm báo cáo này.'; if (state === 'unavailable') return 'Nguồn dữ liệu chính thức cho nhóm này chưa được mở.'; return 'Không thể tải dữ liệu ở thời điểm hiện tại.'; }
function generatedAtOf(...sources: SourceResult[]): string | null { for (const source of sources) if (source.ok) { const value = stringValue(source.data, 'generatedAt'); if (value) return value; } return null; }
function detailRows(range: { from: string; to: string }, generatedAt: string | null) { return [{ label: 'Từ ngày', value: range.from }, { label: 'Đến ngày', value: range.to }, { label: 'Múi giờ', value: 'Việt Nam (UTC+7)' }, { label: 'Cập nhật', value: generatedAt ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(generatedAt)) : 'Chưa có dữ liệu' }]; }
function basePresentation(domain: ReportDomain, range: { from: string; to: string; label: string }, state: ReportState, generatedAt: string | null): Omit<ReportPresentation, 'primary' | 'metrics' | 'trend' | 'trendLabel' | 'trendNote' | 'highlights'> { return { ...reportDefinitions[domain], state, stateLabel: STATE_LABELS[state], stateMessage: stateMessage(state), periodLabel: range.label, generatedAt, details: detailRows(range, generatedAt) }; }
function warningHighlights(value: unknown): string[] { return rows(value).map((warning) => { const family = stringValue(warning, 'family') ?? 'dữ liệu'; return `${FAMILY_LABELS[family] ?? family}: chưa tải đủ số liệu.`; }); }

function buildExecutive(range: { from: string; to: string; label: string }, source: SourceResult): ReportPresentation {
  if (!source.ok) return { ...basePresentation('executive', range, source.state, null), primary: { label: 'Tổng quan', value: source.message }, metrics: [], trend: [], trendLabel: null, trendNote: 'Chưa có chuỗi diễn biến.', highlights: [source.message] };
  const management = record(source.data.management), sales = record(management.sales), grossMargin = record(management.grossMargin), inventory = record(management.inventory), logistics = record(management.logistics);
  const salesSummary = record(sales.summary), grossSummary = record(grossMargin.summary), inventorySummary = record(inventory.summary), logisticsSummary = record(logistics.summary);
  const warnings = warningHighlights(source.data.warnings); const qualityPartial = (numericValue(grossSummary, 'missingCostCount') ?? 0) > 0 || (numericValue(grossSummary, 'costAnomalyCount') ?? 0) > 0 || record(inventory.projectionState).quantityProjectionStale === true;
  const highlights = [...warnings]; if ((numericValue(grossSummary, 'missingCostCount') ?? 0) > 0) highlights.push('Một phần doanh thu chưa có giá vốn để tính lãi gộp.'); if ((numericValue(grossSummary, 'costAnomalyCount') ?? 0) > 0) highlights.push('Có dòng giá vốn cần đối soát.'); if (!highlights.length) highlights.push('Các nguồn quản trị trong phạm vi quyền hiện tại đã phản hồi.');
  const revenue = currencyRowsText(sales.currencyTotals, 'totalValue');
  return { ...basePresentation('executive', range, warnings.length || qualityPartial ? 'partial' : 'ready', stringValue(source.data, 'generatedAt')), primary: { label: 'Doanh thu kỳ', value: revenue }, metrics: [metric('Đơn hiệu lực', integerText(salesSummary, 'effectiveOrderCount'), 'Đơn đã xác nhận hoặc hoàn tất.'), metric('Lãi gộp', moneyFromRow(grossSummary, 'grossMarginVnd'), 'Phần doanh thu VND có giá vốn đối chiếu được.'), metric('Giá trị tồn', moneyFromRow(inventorySummary, 'inventoryValueVnd'), 'Giá trị tồn đã có giá vốn.'), metric('Giao đủ', integerText(logisticsSummary, 'deliveredFullCount'), 'Số kết quả giao đủ trong kỳ.')], trend: [], trendLabel: null, trendNote: 'Tổng quan điều hành không gộp các chuỗi khác đơn vị vào một biểu đồ.', highlights };
}

function salesTrend(data: JsonRecord): { points: ReportTrendPoint[]; label: string | null; note: string } {
  const trendRows = rows(data.dailyTrend); const currencies = [...new Set(trendRows.map((row) => stringValue(row, 'currencyCode')).filter((value): value is string => Boolean(value)))];
  if (!trendRows.length) return { points: [], label: null, note: 'Không có dữ liệu diễn biến trong kỳ.' };
  if (currencies.length !== 1) return { points: [], label: null, note: 'Có nhiều loại tiền nên không nối các giá trị khác loại tiền vào cùng một biểu đồ.' };
  const currency = currencies[0];
  const points = trendRows.flatMap((row) => { const value = numericValue(row, 'revenue') ?? numericValue(row, 'totalValue'); const day = stringValue(row, 'businessDate'); return value === null || !day ? [] : [{ label: day, value, display: moneyText(value, currency) }]; });
  return { points, label: `Doanh thu ${currency}`, note: points.length ? 'Giá trị từng ngày được hiển thị trực tiếp bên dưới biểu đồ để đọc được trên điện thoại.' : 'Không có dữ liệu diễn biến trong kỳ.' };
}

function buildSales(range: { from: string; to: string; label: string }, source: SourceResult): ReportPresentation {
  if (!source.ok) return { ...basePresentation('sales', range, source.state, null), primary: { label: 'Kinh doanh', value: source.message }, metrics: [], trend: [], trendLabel: null, trendNote: 'Chưa có chuỗi diễn biến.', highlights: [source.message] };
  const summary = record(source.data.summary); const quality = record(source.data.dataQuality); const qualityWarnings = Array.isArray(quality.warnings) ? quality.warnings.filter((item): item is string => typeof item === 'string') : [];
  const revenues = summary.revenues; const currentRevenue = currencyRowsText(revenues, 'revenue'); const previousRevenue = currencyRowsText(revenues, 'previousRevenue'); const trend = salesTrend(source.data);
  const comparison = record(source.data.comparison), previous = record(comparison.previous); const previousLabel = stringValue(previous, 'from') && stringValue(previous, 'to') ? `${stringValue(previous, 'from')} đến ${stringValue(previous, 'to')}` : 'kỳ liền trước cùng độ dài';
  const highlights = [...qualityWarnings]; if (!highlights.length) highlights.push('Doanh thu đã đối chiếu khớp tổng dòng hàng với tổng phiên bản đơn bán.'); highlights.push('Chi tiết có 6 chiều: Khách hàng, Loại khách, Kênh bán, SKU / Sản phẩm, Nhóm hàng và Nhân viên bán hàng.');
  return { ...basePresentation('sales', range, qualityWarnings.length ? 'partial' : 'ready', stringValue(source.data, 'generatedAt')), primary: { label: 'Doanh thu kỳ', value: currentRevenue }, metrics: [metric('So kỳ trước', previousRevenue, `Kỳ so sánh: ${previousLabel}.`), metric('Đơn hiệu lực', integerText(summary, 'effectiveOrderCount'), 'Đơn đã xác nhận hoặc hoàn tất.'), metric('Khách mua', integerText(summary, 'buyerCount'), 'Khách có đơn hiệu lực trong kỳ.'), metric('Đơn đã hủy', integerText(summary, 'cancelledOrderCount'), 'Không tính vào doanh thu và sản lượng.')], trend: trend.points, trendLabel: trend.label, trendNote: trend.note, highlights };
}

function buildProfit(range: { from: string; to: string; label: string }, source: SourceResult): ReportPresentation {
  if (!source.ok) return { ...basePresentation('profit', range, source.state, null), primary: { label: 'Lợi nhuận', value: source.message }, metrics: [], trend: [], trendLabel: null, trendNote: 'Lợi nhuận không dùng chuỗi doanh thu của Báo cáo Kinh doanh.', highlights: [source.message] };
  const summary = record(source.data.summary); const missing = (numericValue(summary, 'missingLineageCount') ?? 0) + (numericValue(summary, 'missingCostCount') ?? 0) + (numericValue(summary, 'costAnomalyCount') ?? 0) + (numericValue(summary, 'nonVndCount') ?? 0);
  const highlights: string[] = []; if ((numericValue(summary, 'missingLineageCount') ?? 0) > 0) highlights.push(`${integerText(summary, 'missingLineageCount')} dòng thiếu liên kết xuất kho.`); if ((numericValue(summary, 'missingCostCount') ?? 0) > 0) highlights.push(`${integerText(summary, 'missingCostCount')} dòng chưa có giá vốn.`); if ((numericValue(summary, 'costAnomalyCount') ?? 0) > 0) highlights.push(`${integerText(summary, 'costAnomalyCount')} dòng giá vốn cần đối soát.`); if ((numericValue(summary, 'nonVndCount') ?? 0) > 0) highlights.push(`${integerText(summary, 'nonVndCount')} dòng ngoại tệ không trộn vào lãi gộp VND.`); if (!highlights.length) highlights.push('Phần doanh thu dùng để đọc lãi gộp đã có giá vốn đối chiếu được.');
  return { ...basePresentation('profit', range, missing ? 'partial' : 'ready', stringValue(source.data, 'generatedAt')), primary: { label: 'Lãi gộp', value: moneyFromRow(summary, 'grossMarginVnd') }, metrics: [metric('Doanh thu thuần có thể so sánh', moneyFromRow(summary, 'netRevenueVnd'), 'Chỉ phần VND có dữ liệu giá vốn hợp lệ.'), metric('Giá vốn', moneyFromRow(summary, 'cogsVnd'), 'Giá vốn đã tính và đối chiếu.'), metric('Tỷ lệ lãi gộp', percentText(summary, 'grossMarginPercent'), 'Không tính các dòng chưa đủ điều kiện.'), metric('Dòng cần đối soát', new Intl.NumberFormat('vi-VN').format(missing), 'Không thay dữ liệu thiếu bằng số 0.')], trend: [], trendLabel: null, trendNote: 'Báo cáo Lợi nhuận chỉ trình bày phần đã đối chiếu được giá vốn; không trộn với xu hướng doanh thu.', highlights };
}

function buildDebt(range: { from: string; to: string; label: string }, source: SourceResult): ReportPresentation {
  const debtRange = { ...range, label: 'Số dư hiện tại' }; if (!source.ok) return { ...basePresentation('debt', debtRange, source.state, null), primary: { label: 'Công nợ', value: source.message }, metrics: [], trend: [], trendLabel: null, trendNote: 'Công nợ dùng số dư hiện tại.', highlights: [source.message] };
  const receivable = record(source.data.receivable), payable = record(source.data.payable); return { ...basePresentation('debt', debtRange, 'ready', stringValue(source.data, 'generatedAt')), primary: { label: 'Phải thu 91+ ngày', value: bucketAmount(receivable.summary, 'AGE_91_PLUS') }, metrics: [metric('Phải thu 91+ ngày', bucketAmount(receivable.summary, 'AGE_91_PLUS'), 'Số dư phải thu hiện tại theo tuổi chứng từ.'), metric('Phải thu 61–90 ngày', bucketAmount(receivable.summary, 'AGE_61_90'), 'Số dư phải thu hiện tại theo tuổi chứng từ.'), metric('Phải trả quá hạn 91+ ngày', bucketAmount(payable.summary, 'OVERDUE_91_PLUS'), 'Số dư phải trả hiện tại theo ngày đến hạn.'), metric('Phải trả chưa đến hạn', bucketAmount(payable.summary, 'NOT_DUE'), 'Số dư phải trả chưa đến hạn.')], trend: [], trendLabel: null, trendNote: 'Công nợ hiện dùng số dư hiện tại; không dựng lịch sử giả.', highlights: ['Tuổi nợ được giữ theo từng loại tiền; không cộng chéo các loại tiền.'] };
}

function buildInventory(range: { from: string; to: string; label: string }, source: SourceResult): ReportPresentation {
  if (!source.ok) return { ...basePresentation('inventory', range, source.state, null), primary: { label: 'Giá trị tồn', value: source.message }, metrics: [], trend: [], trendLabel: null, trendNote: 'Chưa có chuỗi diễn biến.', highlights: [source.message] };
  const summary = record(source.data.summary), projection = record(source.data.projectionState); const partial = (numericValue(summary, 'costingExceptionCount') ?? 0) > 0 || projection.quantityProjectionStale === true; const highlights = partial ? ['Có số liệu tồn hoặc giá vốn cần đối soát.'] : ['Tồn lượng và giá trị tồn đã tải trong phạm vi kho được cấp quyền.'];
  return { ...basePresentation('inventory', range, partial ? 'partial' : 'ready', stringValue(source.data, 'generatedAt')), primary: { label: 'Giá trị tồn', value: moneyFromRow(summary, 'inventoryValueVnd') }, metrics: [metric('Giá trị tồn', moneyFromRow(summary, 'inventoryValueVnd'), 'Giá trị tồn VND đã có giá vốn.'), metric('SKU đang có tồn', integerText(summary, 'stockedSkuCount'), 'Số SKU có tồn thực tế dương.'), metric('Vị trí đang giữ hàng', integerText(summary, 'reservedPositionCount'), 'Vị trí có lượng đang được giữ cho đơn.'), metric('Điểm cần đối soát giá vốn', integerText(summary, 'costingExceptionCount'), 'Không chuyển dữ liệu thiếu thành số 0.')], trend: [], trendLabel: null, trendNote: 'Nhóm Kho không dựng chuỗi giá trị tồn giả.', highlights };
}

function buildDeliveryCod(range: { from: string; to: string; label: string }, logisticsSource: SourceResult, codSource: SourceResult): ReportPresentation {
  const logistics = logisticsSource.ok ? logisticsSource.data : {}, cod = codSource.ok ? codSource.data : {}; const summary = record(logistics.summary), snapshot = record(cod.currentSnapshot), exceptions = record(cod.exceptions), quality = record(logistics.dataQuality);
  const qualityCount = rows(quality.exceptions).reduce((total, row) => total + (numericValue(row, 'exceptionCount') ?? 0), 0) + rows(exceptions.lifecycle).length + rows(exceptions.currencyLineage).length; const state = sourceState([logisticsSource, codSource], qualityCount > 0); const highlights = failureHighlights([logisticsSource, codSource], ['Giao vận', 'COD']); if (rows(snapshot.pendingHandovers).length) highlights.push(`${rows(snapshot.pendingHandovers).length} lượt bàn giao COD đang chờ tiếp nhận.`); if (rows(snapshot.discrepancies).length) highlights.push(`${rows(snapshot.discrepancies).length} lượt bàn giao COD có chênh lệch.`); if (!highlights.length) highlights.push('Giao vận và COD đã tải từ nguồn Công Ty trong kỳ đã chọn.');
  return { ...basePresentation('delivery-cod', range, state, generatedAtOf(logisticsSource, codSource)), primary: { label: 'Tỷ lệ giao đủ đúng hẹn', value: logisticsSource.ok ? percentText(summary, 'onTimeFullRatePercent') : 'Chưa có dữ liệu' }, metrics: [metric('Giao đủ đúng hẹn', logisticsSource.ok ? percentText(summary, 'onTimeFullRatePercent') : 'Chưa có dữ liệu', 'Chỉ tính các lượt giao đủ có giờ dự kiến.'), metric('Giao đủ', logisticsSource.ok ? integerText(summary, 'deliveredFullCount') : 'Chưa có dữ liệu', 'Kết quả giao đủ trong kỳ.'), metric('Giao một phần', logisticsSource.ok ? integerText(summary, 'deliveredPartialCount') : 'Chưa có dữ liệu', 'Kết quả giao một phần trong kỳ.'), metric('COD đang giữ', codSource.ok ? currencyRowsText(snapshot.custodyByCurrency, 'custodyRemainingAmount') : 'Chưa có dữ liệu', 'Giữ riêng từng loại tiền.')], trend: [], trendLabel: null, trendNote: 'Không gộp tỷ lệ giao hàng và số tiền COD vào cùng một biểu đồ.', highlights };
}

function buildMcp(domain: 'mcp' | 'people', range: { from: string; to: string; label: string }, source: SourceResult): ReportPresentation {
  if (!source.ok) return { ...basePresentation(domain, range, source.state, null), primary: { label: domain === 'mcp' ? 'Lượt ghé' : 'Hiệu suất', value: source.message }, metrics: [], trend: [], trendLabel: null, trendNote: 'Chưa có chuỗi diễn biến.', highlights: [source.message] };
  const summary = record(source.data.summary), quality = record(source.data.dataQuality), unmapped = rows(quality.unmappedActors), mismatches = rows(quality.counterMismatches); const highlights: string[] = []; if (unmapped.length) highlights.push(`${unmapped.length} mã nhân viên thị trường chưa khớp hồ sơ nhân viên Công Ty.`); if (mismatches.length) highlights.push(`${mismatches.length} phiên có bộ đếm cần đối soát với dữ liệu chi tiết.`); if (!highlights.length) highlights.push('Dữ liệu tuyến và lượt ghé đã tải theo phạm vi nhân viên được cấp quyền.'); const base = basePresentation(domain, range, unmapped.length || mismatches.length ? 'partial' : 'ready', stringValue(source.data, 'generatedAt'));
  if (domain === 'mcp') return { ...base, primary: { label: 'Điểm đã ghé', value: integerText(summary, 'visitedOutletCount') }, metrics: [metric('Điểm kế hoạch', integerText(summary, 'plannedOutletCount'), 'Điểm trong kế hoạch tuyến.'), metric('Điểm đã ghé', integerText(summary, 'visitedOutletCount'), 'Điểm có trạng thái đã ghé.'), metric('Nhu cầu đặt hàng', integerText(summary, 'orderIntentCount'), 'Nhu cầu đặt hàng được ghi nhận trên MCP.'), metric('Đơn Công Ty', integerText(summary, 'coreSalesOrderCount'), 'Nhu cầu đã có liên kết đơn Công Ty.')], trend: [], trendLabel: null, trendNote: 'Màn hình này không suy diễn vị trí đúng/sai chỉ từ trạng thái ghi nhận điểm ghé.', highlights };
  return { ...base, primary: { label: 'Tỷ lệ ghé kế hoạch', value: percentText(summary, 'plannedVisitRatePercent') }, metrics: [metric('Tỷ lệ ghé kế hoạch', percentText(summary, 'plannedVisitRatePercent'), 'Tỷ lệ điểm kế hoạch đã ghé.'), metric('Chuyển đổi nhu cầu', percentText(summary, 'orderIntentConversionPercent'), 'Nhu cầu đặt hàng trên số điểm đã ghé.'), metric('Phiên đã khớp nhân viên', integerText(summary, 'mappedEmployeeSessionCount'), 'Phiên có mã nhân viên khớp hồ sơ Công Ty.'), metric('Phiên chưa khớp nhân viên', integerText(summary, 'unmappedEmployeeSessionCount'), 'Phiên cần đối soát mã nhân viên.')], trend: [], trendLabel: null, trendNote: 'Hiệu suất dùng trực tiếp số liệu MCP đã tổng hợp; không tự chấm điểm nhân viên.', highlights };
}

function buildDecisions(range: { from: string; to: string; label: string }, proposalSource: SourceResult, alertSource: SourceResult): ReportPresentation {
  const proposals = proposalSource.ok ? rows(proposalSource.data.proposals) : [], alerts = alertSource.ok ? rows(alertSource.data.alerts) : []; const pending = proposals.filter((row) => stringValue(row, 'status') === 'pending').length, needsInfo = proposals.filter((row) => stringValue(row, 'status') === 'needs-info').length, openAlerts = alerts.filter((row) => stringValue(row, 'status') !== 'resolved').length, highAlerts = alerts.filter((row) => stringValue(row, 'status') !== 'resolved' && ['critical', 'high'].includes(stringValue(row, 'severity') ?? '')).length; const baseState = sourceState([proposalSource, alertSource]); const state: ReportState = baseState === 'ready' && pending + needsInfo + openAlerts === 0 ? 'empty' : baseState; const highlights = failureHighlights([proposalSource, alertSource], ['Đề xuất', 'Cảnh báo']); if (proposalSource.ok) highlights.push(`${pending} đề xuất chờ quyết định · ${needsInfo} đề xuất chờ bổ sung.`); if (alertSource.ok) highlights.push(`${openAlerts} cảnh báo đang mở · ${highAlerts} cảnh báo mức cao.`);
  return { ...basePresentation('decisions', range, state, generatedAtOf(proposalSource, alertSource)), primary: { label: 'Việc đang mở', value: proposalSource.ok && alertSource.ok ? String(pending + openAlerts) : 'Chưa đầy đủ' }, metrics: [metric('Đề xuất chờ quyết định', proposalSource.ok ? String(pending) : 'Chưa có dữ liệu', 'Đề xuất đang chờ quản lý ra quyết định.'), metric('Đề xuất chờ bổ sung', proposalSource.ok ? String(needsInfo) : 'Chưa có dữ liệu', 'Đề xuất đã yêu cầu bổ sung thông tin.'), metric('Cảnh báo đang mở', alertSource.ok ? String(openAlerts) : 'Chưa có dữ liệu', 'Cảnh báo chưa ở trạng thái đã giải quyết.'), metric('Cảnh báo mức cao', alertSource.ok ? String(highAlerts) : 'Chưa có dữ liệu', 'Cảnh báo nghiêm trọng hoặc mức cao đang mở.')], trend: [], trendLabel: null, trendNote: 'Đề xuất và cảnh báo là hai luồng khác nhau nên không gộp thành chuỗi diễn biến giả.', highlights };
}

export function reportDomainFromId(reportId: string): ReportDomain | null { if (reportId === 'sales-profit-summary') return 'sales'; return Object.values(reportDefinitions).find((definition) => definition.id === reportId)?.domain ?? null; }
export async function loadReportPresentation(domain: ReportDomain, period: ReportPeriod): Promise<ReportPresentation> {
  const range = resolveReportRange(period);
  if (domain === 'decisions') { const [proposals, alerts] = await Promise.all([loadSource('/api/management-proposals'), loadSource(withRange('/api/reporting/admin-alerts', range))]); return buildDecisions(range, proposals, alerts); }
  if (domain === 'executive') return buildExecutive(range, await loadSource(withRange('/api/reporting/control-tower', range)));
  if (domain === 'sales') return buildSales(range, await loadSource(withRange('/api/reporting/sales', range)));
  if (domain === 'profit') return buildProfit(range, await loadSource(withRange('/api/reporting/gross-margin', range)));
  if (domain === 'debt') return buildDebt(range, await loadSource('/api/reporting/aging'));
  if (domain === 'inventory') return buildInventory(range, await loadSource(withRange('/api/reporting/inventory', range)));
  if (domain === 'delivery-cod') { const [logistics, cod] = await Promise.all([loadSource(withRange('/api/reporting/logistics', range)), loadSource(withRange('/api/reporting/cod', range))]); return buildDeliveryCod(range, logistics, cod); }
  return buildMcp(domain, range, await loadSource(withRange('/api/reporting/employee-mcp', range)));
}
