import 'server-only';

import { CoreApiError, requestCore } from '../../lib/core-api';
import {
  loadReportPresentation,
  resolveReportRange,
  type ReportDomain,
  type ReportMetric,
  type ReportPeriod,
  type ReportPresentation,
  type ReportState,
} from './report-data';

type JsonRecord = Record<string, unknown>;
type WarehouseOption = { value: string; label: string };
export type LotCPresentation = ReportPresentation & {
  warehouseFilter: { selectedId: string | null; options: WarehouseOption[] } | null;
};

type Source = { ok: true; data: JsonRecord } | { ok: false; state: 'forbidden' | 'error'; message: string };

function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function record(value: unknown): JsonRecord { return isRecord(value) ? value : {}; }
function rows(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.filter(isRecord) : []; }
function text(row: JsonRecord, key: string): string | null {
  const value = row[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}
function number(row: JsonRecord, key: string): number | null { const value = text(row, key); if (value === null) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function integer(row: JsonRecord, key: string): string { const value = number(row, key); return value === null ? 'Chưa có dữ liệu' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value); }
function percent(row: JsonRecord, key: string): string { const value = number(row, key); return value === null ? 'Chưa có dữ liệu' : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)}%`; }
function moneyValue(value: number | null, currency = 'VND'): string { return value === null ? 'Chưa có dữ liệu' : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)} ${currency}`; }
function money(row: JsonRecord, key: string, currency = 'VND'): string { return moneyValue(number(row, key), currency); }
function currencies(value: unknown, key: string): string {
  const values = rows(value).flatMap((row) => { const amount = number(row, key); const currency = text(row, 'currencyCode'); return amount === null || !currency ? [] : [moneyValue(amount, currency)]; });
  return values.length ? values.join(' · ') : 'Không có dữ liệu';
}
function bucket(value: unknown, name: string): string {
  const values = rows(value).filter((row) => text(row, 'ageBucket') === name).flatMap((row) => { const amount = number(row, 'remainingAmount'); const currency = text(row, 'currencyCode'); return amount === null || !currency ? [] : [moneyValue(amount, currency)]; });
  return values.length ? values.join(' · ') : 'Không phát sinh';
}
function metric(label: string, value: string, note: string): ReportMetric { return { label, value, note }; }
function query(path: string, values: Record<string, string | null | undefined>): string { const params = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); }); const qs = params.toString(); return qs ? `${path}?${qs}` : path; }
async function source(path: string): Promise<Source> {
  try { const data = await requestCore<unknown>(path); return isRecord(data) ? { ok: true, data } : { ok: false, state: 'error', message: 'Không thể tải dữ liệu.' }; }
  catch (error) { return error instanceof CoreApiError && error.statusCode === 403 ? { ok: false, state: 'forbidden', message: 'Không có quyền xem nhóm báo cáo này.' } : { ok: false, state: 'error', message: 'Không thể tải dữ liệu.' }; }
}
function options(value: unknown): WarehouseOption[] {
  const seen = new Set<string>();
  return rows(value).flatMap((row) => { const id = text(row, 'warehouseId'); if (!id || seen.has(id)) return []; seen.add(id); const code = text(row, 'warehouseCode'); const name = text(row, 'warehouseName'); return [{ value: id, label: [code, name].filter(Boolean).join(' · ') || 'Kho' }]; });
}
function state(base: LotCPresentation, result: Source): LotCPresentation {
  if (result.ok) return base;
  const current: ReportState = result.state;
  return { ...base, state: current, stateLabel: current === 'forbidden' ? 'Không có quyền' : 'Không thể tải dữ liệu', stateMessage: result.message, primary: { ...base.primary, value: result.message }, metrics: [], highlights: [result.message] };
}
function updated(value: unknown): string { if (typeof value !== 'string' || !value) return 'Chưa có dữ liệu'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date); }

function filteredDebt(base: LotCPresentation, result: Source, selectedId: string | null, all: Source): LotCPresentation {
  const warehouseFilter = { selectedId, options: all.ok ? options(all.data.scopeWarehouses) : [] };
  if (!result.ok) return { ...state(base, result), warehouseFilter };
  const receivable = record(result.data.receivable); const payable = record(result.data.payable);
  return {
    ...base,
    periodLabel: 'Số dư hiện tại',
    details: [{ label: 'Phạm vi thời gian', value: 'Số dư hiện tại' }, { label: 'Múi giờ', value: 'Việt Nam (UTC+7)' }, { label: 'Cập nhật', value: updated(result.data.generatedAt) }],
    primary: { label: 'Phải thu 91+ ngày', value: bucket(receivable.summary, 'AGE_91_PLUS') },
    metrics: [
      metric('Phải thu 91+ ngày', bucket(receivable.summary, 'AGE_91_PLUS'), 'Số dư phải thu hiện tại theo tuổi chứng từ.'),
      metric('Phải thu 61–90 ngày', bucket(receivable.summary, 'AGE_61_90'), 'Số dư phải thu hiện tại theo tuổi chứng từ.'),
      metric('Phải trả quá hạn 91+ ngày', bucket(payable.summary, 'OVERDUE_91_PLUS'), 'Số dư phải trả hiện tại theo ngày đến hạn.'),
      metric('Phải trả chưa đến hạn', bucket(payable.summary, 'NOT_DUE'), 'Số dư phải trả chưa đến hạn.'),
    ],
    highlights: ['Tuổi nợ được giữ theo từng loại tiền; không cộng chéo các loại tiền.'],
    warehouseFilter,
  };
}
function filteredInventory(base: LotCPresentation, result: Source, selectedId: string | null, all: Source): LotCPresentation {
  const warehouseFilter = { selectedId, options: all.ok ? options(all.data.warehouseSummary) : [] };
  if (!result.ok) return { ...state(base, result), warehouseFilter };
  const summary = record(result.data.summary); const projection = record(result.data.projectionState); const partial = (number(summary, 'costingExceptionCount') ?? 0) > 0 || projection.quantityProjectionStale === true;
  return {
    ...base,
    state: partial ? 'partial' : 'ready', stateLabel: partial ? 'Dữ liệu chưa đầy đủ' : 'Bình thường', stateMessage: partial ? 'Có số liệu tồn hoặc giá vốn cần đối soát.' : 'Số liệu đã tải từ nguồn quản trị của Công Ty.',
    primary: { label: 'Giá trị tồn', value: money(summary, 'inventoryValueVnd') },
    metrics: [metric('Giá trị tồn', money(summary, 'inventoryValueVnd'), 'Giá trị tồn VND đã có giá vốn.'), metric('SKU đang có tồn', integer(summary, 'stockedSkuCount'), 'Số SKU có tồn thực tế dương.'), metric('Vị trí đang giữ hàng', integer(summary, 'reservedPositionCount'), 'Vị trí có lượng đang được giữ cho đơn.'), metric('Điểm cần đối soát giá vốn', integer(summary, 'costingExceptionCount'), 'Không chuyển dữ liệu thiếu thành số 0.')],
    highlights: partial ? ['Có số liệu tồn hoặc giá vốn cần đối soát.'] : ['Tồn lượng và giá trị tồn đã tải trong phạm vi kho được cấp quyền.'],
    warehouseFilter,
  };
}
function filteredDelivery(base: LotCPresentation, logistics: Source, cod: Source, selectedId: string | null, allCod: Source): LotCPresentation {
  const warehouseFilter = { selectedId, options: allCod.ok ? options(allCod.data.warehouses) : [] };
  if (!logistics.ok) return { ...state(base, logistics), warehouseFilter };
  if (!cod.ok) return { ...state(base, cod), warehouseFilter };
  const summary = record(logistics.data.summary); const snapshot = record(cod.data.currentSnapshot); const exceptions = record(cod.data.exceptions);
  const quality = rows(record(logistics.data.dataQuality).exceptions).length + rows(exceptions.lifecycle).length + rows(exceptions.currencyLineage).length;
  const highlights: string[] = [];
  if (rows(snapshot.pendingHandovers).length) highlights.push(`${rows(snapshot.pendingHandovers).length} lượt bàn giao COD đang chờ tiếp nhận.`);
  if (rows(snapshot.discrepancies).length) highlights.push(`${rows(snapshot.discrepancies).length} lượt bàn giao COD có chênh lệch.`);
  if (rows(snapshot.overduePromises).length) highlights.push(`${rows(snapshot.overduePromises).length} khoản hẹn thu đã quá hạn.`);
  if (!highlights.length) highlights.push('Giao vận và COD đã tải từ nguồn Công Ty trong kỳ đã chọn.');
  return {
    ...base,
    state: quality ? 'partial' : 'ready', stateLabel: quality ? 'Dữ liệu chưa đầy đủ' : 'Bình thường', stateMessage: quality ? 'Có dữ liệu giao vận/COD cần đối soát trước khi kết luận.' : 'Số liệu đã tải từ nguồn quản trị của Công Ty.',
    primary: { label: 'Tỷ lệ giao đủ đúng hẹn', value: percent(summary, 'onTimeFullRatePercent') },
    metrics: [metric('Giao đủ đúng hẹn', percent(summary, 'onTimeFullRatePercent'), 'Chỉ tính các lượt giao đủ có giờ dự kiến.'), metric('Giao đủ', integer(summary, 'deliveredFullCount'), 'Kết quả giao đủ trong kỳ.'), metric('Giao một phần', integer(summary, 'deliveredPartialCount'), 'Kết quả giao một phần trong kỳ.'), metric('COD đang giữ', currencies(snapshot.custodyByCurrency, 'custodyRemainingAmount'), 'Tiền COD còn trong trách nhiệm bàn giao, giữ riêng từng loại tiền.')],
    highlights,
    warehouseFilter,
  };
}

export async function loadLotCPresentation(domain: ReportDomain, period: ReportPeriod, warehouseId?: string | null): Promise<LotCPresentation> {
  const base = { ...(await loadReportPresentation(domain, period)), warehouseFilter: null } as LotCPresentation;
  if (!['debt', 'inventory', 'delivery-cod'].includes(domain)) return base;
  const range = resolveReportRange(period); const selectedId = warehouseId || null;
  if (domain === 'debt') {
    const [selected, all] = await Promise.all([source(query('/api/reporting/aging', { warehouseId: selectedId })), selectedId ? source('/api/reporting/aging') : Promise.resolve<Source | null>(null)]);
    return filteredDebt(base, selected, selectedId, all ?? selected);
  }
  if (domain === 'inventory') {
    const selectedPath = query('/api/reporting/inventory', { from: range.from, to: range.to, warehouseId: selectedId });
    const allPath = query('/api/reporting/inventory', { from: range.from, to: range.to });
    const [selected, all] = await Promise.all([source(selectedPath), selectedId ? source(allPath) : Promise.resolve<Source | null>(null)]);
    return filteredInventory(base, selected, selectedId, all ?? selected);
  }
  const values = { from: range.from, to: range.to, warehouseId: selectedId };
  const [logistics, cod, allCod] = await Promise.all([source(query('/api/reporting/logistics', values)), source(query('/api/reporting/cod', values)), selectedId ? source(query('/api/reporting/cod', { from: range.from, to: range.to })) : Promise.resolve<Source | null>(null)]);
  return filteredDelivery(base, logistics, cod, selectedId, allCod ?? cod);
}
