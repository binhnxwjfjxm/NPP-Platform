import 'server-only';

import { CoreApiError, requestCore } from '../../lib/core-api';
import { resolveReportRange, type ReportPeriod } from './report-data';

type JsonRecord = Record<string, unknown>;
export type SalesBusinessRow = { id: string; label: string; summary: string; facts: Array<{ label: string; value: string }> };
export type SalesBusinessSection = { key: string; title: string; rows: SalesBusinessRow[] };
export type SalesBusinessDetail = { sections: SalesBusinessSection[]; message: string | null };

function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function rows(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.filter(isRecord) : []; }
function text(row: JsonRecord, key: string, fallback = ''): string { const value = row[key]; if (typeof value === 'string' && value.trim()) return value.trim(); if (typeof value === 'number' && Number.isFinite(value)) return String(value); return fallback; }
function record(value: unknown): JsonRecord { return isRecord(value) ? value : {}; }
function numberText(value: unknown, digits = 2): string { const parsed = Number(value); return Number.isFinite(parsed) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(parsed) : 'Chưa có dữ liệu'; }
function money(row: JsonRecord, key: string): string { const currency = text(row, 'currencyCode'); const raw = row[key]; const formatted = numberText(raw, 2); return formatted === 'Chưa có dữ liệu' ? formatted : `${formatted}${currency ? ` ${currency}` : ''}`; }
function quantity(row: JsonRecord, key: string): string { const unit = record(row.unit); const name = text(unit, 'name', text(unit, 'code', 'ĐVT chưa xác định')); const formatted = numberText(row[key], 6); return formatted === 'Chưa có dữ liệu' ? formatted : `${formatted} ${name}`; }
function change(row: JsonRecord): string { const value = row.changePercent; if (value === null || value === undefined || value === '') { const state = text(row, 'comparisonState'); if (state === 'new') return 'Mới phát sinh'; if (state === 'inactive') return 'Không phát sinh kỳ này'; return 'Chưa có cơ sở so sánh'; } const parsed = Number(value); return Number.isFinite(parsed) ? `${parsed > 0 ? '+' : ''}${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(parsed)}%` : 'Chưa có cơ sở so sánh'; }

const DIMENSIONS = [
  ['customers', 'Khách hàng'],
  ['customerGroups', 'Loại khách'],
  ['channels', 'Kênh bán'],
  ['products', 'SKU / Sản phẩm'],
  ['productGroups', 'Nhóm hàng'],
  ['employees', 'Nhân viên bán hàng'],
] as const;

function section(key: string, title: string, value: unknown): SalesBusinessSection {
  return {
    key,
    title,
    rows: rows(value).map((row, index) => {
      const code = text(row, 'code'); const name = text(row, 'name', 'Không xác định'); const source = text(row, 'source'); const unit = record(row.unit);
      return {
        id: `${key}-${text(row, 'id', `${code}-${index}`)}-${text(row, 'currencyCode')}-${text(unit, 'code')}`,
        label: [code, name].filter(Boolean).join(' · '),
        summary: `${money(row, 'revenue')} · ${quantity(row, 'quantity')}`,
        facts: [
          { label: 'Doanh thu kỳ', value: money(row, 'revenue') },
          { label: 'Doanh thu kỳ trước', value: money(row, 'previousRevenue') },
          { label: 'Thay đổi doanh thu', value: change(row) },
          { label: 'Sản lượng kỳ', value: quantity(row, 'quantity') },
          { label: 'Sản lượng kỳ trước', value: quantity(row, 'previousQuantity') },
          { label: 'Tỷ trọng trong cùng tiền tệ và ĐVT', value: `${numberText(row.sharePercent, 2)}%` },
          { label: 'ĐVT', value: [text(unit, 'code'), text(unit, 'name')].filter(Boolean).join(' · ') || 'Không xác định' },
          { label: 'Tiền tệ', value: text(row, 'currencyCode', 'Không xác định') },
          ...(source && source !== 'order-snapshot' && source !== 'order-line-snapshot' && source !== 'snapshot' && source !== 'order-source' && source !== 'creator-user' ? [{ label: 'Nguồn chiều phân tích', value: source === 'legacy-current-master' ? 'Đơn cũ: tham chiếu danh mục hiện tại, không coi là ảnh chụp lịch sử' : 'Không xác định' }] : []),
        ],
      };
    }),
  };
}

export async function loadSalesBusinessDetail(period: ReportPeriod): Promise<SalesBusinessDetail> {
  const range = resolveReportRange(period); const query = new URLSearchParams({ from: range.from, to: range.to });
  try {
    const data = await requestCore<unknown>(`/api/reporting/sales?${query.toString()}`);
    if (!isRecord(data)) return { sections: [], message: 'Dữ liệu Kinh doanh chi tiết chưa sẵn sàng.' };
    const breakdowns = record(data.breakdowns);
    return { sections: DIMENSIONS.map(([key, title]) => section(key, title, breakdowns[key])), message: null };
  } catch (error) {
    if (error instanceof CoreApiError && error.statusCode === 403) return { sections: [], message: 'Tài khoản hiện tại không có quyền xem chi tiết Kinh doanh.' };
    return { sections: [], message: 'Không thể tải chi tiết Kinh doanh ở thời điểm hiện tại.' };
  }
}
