'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from './app-shell';
import { SalesReportingExportDialog } from './sales-reporting-export-dialog';
import {
  BusinessTableSequenceCell,
  BusinessTableSequenceHeader,
} from './business-table-sequence';
import type {
  SalesBreakdownKey,
  SalesBreakdownRow,
  SalesReportingDashboard,
  SalesReportingTrendRow,
} from '../../lib/sales-reporting-types';
import styles from './sales-reporting-workspace.module.css';

type ApiEnvelope<T> = Readonly<{
  data?: T;
  error?: { message?: string };
}>;

type Filters = Readonly<{
  from: string;
  to: string;
  warehouseId: string;
}>;

type DimensionOption = Readonly<{
  key: SalesBreakdownKey;
  label: string;
}>;

const EMPTY_FILTERS: Filters = Object.freeze({ from: '', to: '', warehouseId: '' });

const DIMENSIONS: readonly DimensionOption[] = Object.freeze([
  Object.freeze({ key: 'customers', label: 'Khách hàng' }),
  Object.freeze({ key: 'customerGroups', label: 'Loại khách' }),
  Object.freeze({ key: 'channels', label: 'Kênh bán' }),
  Object.freeze({ key: 'products', label: 'Sản phẩm' }),
  Object.freeze({ key: 'productGroups', label: 'Nhóm hàng' }),
  Object.freeze({ key: 'employees', label: 'Nhân viên bán hàng' }),
]);

type ComparisonFilter = 'all' | SalesBreakdownRow['comparisonState'];

const SAVED_VIEW_KEY = 'npp.sales-reporting.view.v1';

const PERIOD_PRESETS = Object.freeze([
  Object.freeze({ key: 'today', label: 'Hôm nay' }),
  Object.freeze({ key: 'last7', label: '7 ngày' }),
  Object.freeze({ key: 'thisMonth', label: 'Tháng này' }),
  Object.freeze({ key: 'previousMonth', label: 'Tháng trước' }),
] as const);

function isBreakdownKey(value: unknown): value is SalesBreakdownKey {
  return typeof value === 'string' && DIMENSIONS.some((item) => item.key === value);
}

function isComparisonFilter(value: unknown): value is ComparisonFilter {
  return value === 'all' || value === 'new' || value === 'inactive' || value === 'comparable';
}

function vietnamTodayIso() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftIsoDate(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function presetRange(key: (typeof PERIOD_PRESETS)[number]['key']) {
  const today = vietnamTodayIso();
  if (key === 'today') return Object.freeze({ from: today, to: today });
  if (key === 'last7') return Object.freeze({ from: shiftIsoDate(today, -6), to: today });
  if (key === 'thisMonth') return Object.freeze({ from: `${today.slice(0, 7)}-01`, to: today });
  const firstCurrentMonth = `${today.slice(0, 7)}-01`;
  const previousMonthLast = shiftIsoDate(firstCurrentMonth, -1);
  return Object.freeze({ from: `${previousMonthLast.slice(0, 7)}-01`, to: previousMonthLast });
}

function formatDecimal(value: string | null | undefined) {
  const normalized = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized || '0';
  const [, sign, integer, fraction = ''] = match;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const trimmedFraction = fraction.replace(/0+$/, '').slice(0, 6);
  return `${sign}${grouped}${trimmedFraction ? `,${trimmedFraction}` : ''}`;
}

function formatMoney(value: string | null | undefined, currencyCode: string) {
  const suffix = currencyCode === 'VND' ? '₫' : currencyCode;
  return `${formatDecimal(value)} ${suffix}`;
}

function percent(value: string | null | undefined) {
  if (value === null || value === undefined || String(value).trim() === '') return 'Chưa có cơ sở so sánh';
  return `${formatDecimal(value)}%`;
}

function rowChange(row: SalesBreakdownRow) {
  if (row.comparisonState === 'new') return 'Mới trong kỳ';
  if (row.comparisonState === 'inactive') return 'Không phát sinh kỳ này';
  return percent(row.changePercent);
}

function metricLabel(dimension: SalesBreakdownKey) {
  if (dimension === 'products') return 'Sản lượng';
  if (dimension === 'customers') return 'Số đơn';
  if (dimension === 'customerGroups') return 'Khách · đơn';
  if (dimension === 'channels') return 'Đơn · khách';
  if (dimension === 'productGroups') return 'Số sản phẩm';
  return 'Đơn · khách';
}

function metricValue(row: SalesBreakdownRow, dimension: SalesBreakdownKey) {
  if (dimension === 'products') {
    const unit = row.unit?.name || row.unit?.code || 'ĐVT chưa xác định';
    return `${formatDecimal(row.quantity)} ${unit}`;
  }
  if (dimension === 'customers') return `${formatDecimal(row.documentCount)} đơn`;
  if (dimension === 'customerGroups') return `${formatDecimal(row.customerCount)} khách · ${formatDecimal(row.documentCount)} đơn`;
  if (dimension === 'channels') return `${formatDecimal(row.documentCount)} đơn · ${formatDecimal(row.customerCount)} khách`;
  if (dimension === 'productGroups') return `${formatDecimal(row.productCount)} sản phẩm`;
  return `${formatDecimal(row.documentCount)} đơn · ${formatDecimal(row.customerCount)} khách`;
}

function previousValue(row: SalesBreakdownRow, dimension: SalesBreakdownKey) {
  const revenue = formatMoney(row.previousRevenue, row.currencyCode);
  if (dimension !== 'products') return revenue;
  const unit = row.unit?.name || row.unit?.code || 'ĐVT chưa xác định';
  return `${revenue} · ${formatDecimal(row.previousQuantity)} ${unit}`;
}

function chartPoints(values: readonly number[], width: number, height: number, ceiling: number) {
  if (!values.length) return '';
  if (values.length === 1) return `0,${height - ((values[0] / ceiling) * height)} ${width},${height - ((values[0] / ceiling) * height)}`;
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value / ceiling) * height);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function TrendChart({ currencyCode, rows }: Readonly<{ currencyCode: string; rows: readonly SalesReportingTrendRow[] }>) {
  const currentValues = rows.map((row) => Number(row.revenue) || 0);
  const previousValues = rows.map((row) => Number(row.previousRevenue) || 0);
  const ceiling = Math.max(1, ...currentValues, ...previousValues);
  const width = 320;
  const height = 108;
  const latest = rows[rows.length - 1];

  return (
    <article className={styles.trendCard}>
      <div className={styles.trendCardHeading}>
        <div>
          <strong>{currencyCode}</strong>
          <small>{rows.length} ngày có dữ liệu</small>
        </div>
        <span>{latest ? formatMoney(latest.revenue, currencyCode) : '0'}</span>
      </div>
      <svg className={styles.trendChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Xu hướng doanh thu ${currencyCode}`}>
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} className={styles.chartAxis} />
        <polyline points={chartPoints(previousValues, width, height - 8, ceiling)} className={styles.chartPrevious} />
        <polyline points={chartPoints(currentValues, width, height - 8, ceiling)} className={styles.chartCurrent} />
      </svg>
      <div className={styles.chartLegend}>
        <span><i className={styles.legendCurrent} /> Kỳ này</span>
        <span><i className={styles.legendPrevious} /> Kỳ trước</span>
      </div>
    </article>
  );
}

async function requestReport(filters: Filters): Promise<SalesReportingDashboard> {
  const query = new URLSearchParams();
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.warehouseId) query.set('warehouseId', filters.warehouseId);
  const serialized = query.toString();
  const response = await fetch(`/api/reporting/sales${serialized ? `?${serialized}` : ''}`, {
    method: 'GET',
    cache: 'no-store',
  });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<SalesReportingDashboard>;
  if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không tải được báo cáo bán hàng.');
  return envelope.data;
}

export function SalesReportingWorkspace() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [report, setReport] = useState<SalesReportingDashboard | null>(null);
  const [activeDimension, setActiveDimension] = useState<SalesBreakdownKey>('customers');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [analysisSearch, setAnalysisSearch] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [comparisonFilter, setComparisonFilter] = useState<ComparisonFilter>('all');
  const [selectedRow, setSelectedRow] = useState<SalesBreakdownRow | null>(null);
  const [savedNotice, setSavedNotice] = useState('');

  const load = useCallback(async (filters: Filters, initialize = false) => {
    setBusy(true);
    setError('');
    try {
      const next = await requestReport(filters);
      const canonical = Object.freeze({
        from: next.filters.from,
        to: next.filters.to,
        warehouseId: next.filters.warehouseId ?? '',
      });
      setReport(next);
      setApplied(canonical);
      if (initialize) setDraft(canonical);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được báo cáo bán hàng.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(EMPTY_FILTERS, true);
  }, [load]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_VIEW_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        dimension?: unknown;
        analysisSearch?: unknown;
        currencyFilter?: unknown;
        comparisonFilter?: unknown;
      };
      if (isBreakdownKey(saved.dimension)) setActiveDimension(saved.dimension);
      if (typeof saved.analysisSearch === 'string') setAnalysisSearch(saved.analysisSearch.slice(0, 80));
      if (typeof saved.currencyFilter === 'string') setCurrencyFilter(saved.currencyFilter.slice(0, 16));
      if (isComparisonFilter(saved.comparisonFilter)) setComparisonFilter(saved.comparisonFilter);
    } catch {
      window.localStorage.removeItem(SAVED_VIEW_KEY);
    }
  }, []);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(draft);
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    void load(EMPTY_FILTERS, true);
  }

  function applyPreset(key: (typeof PERIOD_PRESETS)[number]['key']) {
    const range = presetRange(key);
    const next = Object.freeze({ ...draft, ...range });
    setDraft(next);
    void load(next);
  }

  function clearAnalysisFilters() {
    setAnalysisSearch('');
    setCurrencyFilter('');
    setComparisonFilter('all');
    setSelectedRow(null);
  }

  function saveView() {
    window.localStorage.setItem(SAVED_VIEW_KEY, JSON.stringify({
      dimension: activeDimension,
      analysisSearch,
      currencyFilter,
      comparisonFilter,
    }));
    setSavedNotice('Đã lưu chế độ xem trên thiết bị này');
    window.setTimeout(() => setSavedNotice(''), 2200);
  }

  const selectedDimension = DIMENSIONS.find((item) => item.key === activeDimension) ?? DIMENSIONS[0];
  const rows = report?.breakdowns[activeDimension] ?? [];
  const revenueRows = report?.summary.revenues ?? [];
  const warehouses = report?.scopeWarehouses ?? [];
  const currentPeriod = report?.comparison.current;
  const previousPeriod = report?.comparison.previous;
  const warnings = report?.dataQuality.warnings ?? [];
  const currencies = useMemo(
    () => Array.from(new Set(rows.map((row) => row.currencyCode).filter(Boolean))).sort(),
    [rows],
  );
  const filteredRows = useMemo(() => {
    const needle = analysisSearch.trim().toLocaleLowerCase('vi');
    return rows.filter((row) => {
      if (currencyFilter && row.currencyCode !== currencyFilter) return false;
      if (comparisonFilter !== 'all' && row.comparisonState !== comparisonFilter) return false;
      if (!needle) return true;
      return [row.code, row.name].filter(Boolean).some((value) => String(value).toLocaleLowerCase('vi').includes(needle));
    });
  }, [rows, analysisSearch, currencyFilter, comparisonFilter]);
  const trendSeries = useMemo(() => {
    const grouped = new Map<string, SalesReportingTrendRow[]>();
    for (const row of report?.dailyTrend ?? []) {
      const bucket = grouped.get(row.currencyCode) ?? [];
      bucket.push(row);
      grouped.set(row.currencyCode, bucket);
    }
    return Array.from(grouped.entries()).map(([currencyCode, values]) => ({ currencyCode, rows: values }));
  }, [report?.dailyTrend]);

  const periodDescription = useMemo(() => {
    if (!applied.from || !applied.to) return 'Mặc định tháng hiện tại theo giờ Việt Nam';
    return `${applied.from} → ${applied.to}`;
  }, [applied.from, applied.to]);

  const actions = (
    <div className={styles.headerActions}>
      <SalesReportingExportDialog
        dimension={activeDimension}
        filters={applied}
        disabled={busy || !report}
      />
      <Link className={styles.headerLink} href="/sales/sales-orders">Mở đơn bán hàng</Link>
      <Link className={styles.headerLink} href="/sales/gross-margin">Xem báo cáo lãi gộp</Link>
    </div>
  );

  return (
    <AppShell
      kicker="Bán hàng · Báo cáo"
      title="Báo cáo bán hàng"
      subtitle="Theo dõi doanh thu, đơn đã chốt, khách mua và sản lượng theo đúng kỳ và phạm vi kho được cấp."
      actions={actions}
    >
      <div className={styles.workspace} data-testid="sales-reporting-workspace" aria-busy={busy}>
        <form className={styles.filters} onSubmit={applyFilters} aria-label="Bộ lọc Báo cáo bán hàng">
          <div className={styles.filterHeading}>
            <div>
              <p className={styles.eyebrow}>Kỳ báo cáo</p>
              <h2>Thời gian và kho</h2>
            </div>
            <small>{periodDescription}</small>
          </div>

          <div className={styles.presetRow} aria-label="Chọn nhanh kỳ báo cáo">
            {PERIOD_PRESETS.map((preset) => (
              <button key={preset.key} type="button" onClick={() => applyPreset(preset.key)} disabled={busy}>
                {preset.label}
              </button>
            ))}
            <span>Tùy chọn: nhập ngày bên dưới</span>
          </div>

          <div className={styles.filterGrid}>
            <label>
              <span>Từ ngày</span>
              <input
                type="date"
                value={draft.from}
                disabled={busy}
                onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
              />
            </label>
            <label>
              <span>Đến ngày</span>
              <input
                type="date"
                value={draft.to}
                disabled={busy}
                onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
              />
            </label>
            <label>
              <span>Kho</span>
              <select
                value={draft.warehouseId}
                disabled={busy}
                onChange={(event) => setDraft((current) => ({ ...current, warehouseId: event.target.value }))}
              >
                <option value="">Tất cả kho được cấp quyền</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.warehouseId} value={warehouse.warehouseId}>
                    {warehouse.warehouseCode} — {warehouse.warehouseName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.filterActions}>
            <button type="button" className={styles.secondaryButton} onClick={resetFilters} disabled={busy}>Đặt lại</button>
            <button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? 'Đang cập nhật…' : 'Áp dụng'}</button>
          </div>
        </form>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {busy && !report ? <div className={styles.loading}>Đang tải báo cáo bán hàng…</div> : null}

        {report ? (
          <>
        <section className={styles.summaryGrid} aria-label="Tổng hợp bán hàng">
          <article className={styles.revenueCard}>
            <span className={styles.cardLabel}>Doanh thu</span>
            {revenueRows.length ? revenueRows.map((row) => (
              <div className={styles.revenueLine} key={row.currencyCode}>
                <strong>{formatMoney(row.revenue, row.currencyCode)}</strong>
                <small>Kỳ trước {formatMoney(row.previousRevenue, row.currencyCode)} · {percent(row.changePercent)}</small>
              </div>
            )) : <strong className={styles.cardValue}>0</strong>}
          </article>
          <article>
            <span className={styles.cardLabel}>Đơn đã chốt</span>
            <strong className={styles.cardValue}>{formatDecimal(report?.summary.effectiveOrderCount)}</strong>
            <small>Đơn đã xác nhận hoặc đã đóng trong kỳ.</small>
          </article>
          <article>
            <span className={styles.cardLabel}>Khách mua</span>
            <strong className={styles.cardValue}>{formatDecimal(report?.summary.buyerCount)}</strong>
            <small>Khách có đơn bán hàng hiệu lực trong kỳ.</small>
          </article>
          <article>
            <span className={styles.cardLabel}>Mặt hàng đã bán</span>
            <strong className={styles.cardValue}>{formatDecimal(report?.summary.soldProductCount)}</strong>
            <small>Sản lượng được giữ theo đúng từng sản phẩm và đơn vị tính.</small>
          </article>
        </section>

        <section className={styles.panel} aria-labelledby="sales-analysis-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Phân tích</p>
              <h2 id="sales-analysis-title">Xem theo {selectedDimension.label.toLowerCase()}</h2>
            </div>
            {currentPeriod && previousPeriod ? (
              <small>Kỳ trước: {previousPeriod.from} → {previousPeriod.to}</small>
            ) : null}
          </div>

          <div className={styles.dimensionTabs} role="tablist" aria-label="Chiều phân tích Báo cáo bán hàng">
            {DIMENSIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={item.key === activeDimension}
                className={item.key === activeDimension ? styles.activeTab : styles.tab}
                onClick={() => {
                  setActiveDimension(item.key);
                  setCurrencyFilter('');
                  setComparisonFilter('all');
                  setSelectedRow(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className={styles.analysisTools}>
            <label>
              <span>Tìm trong danh sách</span>
              <input
                type="search"
                value={analysisSearch}
                placeholder={`Mã hoặc tên ${selectedDimension.label.toLowerCase()}`}
                onChange={(event) => setAnalysisSearch(event.target.value.slice(0, 80))}
              />
            </label>
            <label>
              <span>Tiền tệ</span>
              <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)}>
                <option value="">Tất cả</option>
                {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </label>
            <label>
              <span>So với kỳ trước</span>
              <select value={comparisonFilter} onChange={(event) => setComparisonFilter(event.target.value as ComparisonFilter)}>
                <option value="all">Tất cả</option>
                <option value="comparable">Có thể so sánh</option>
                <option value="new">Mới trong kỳ</option>
                <option value="inactive">Không phát sinh kỳ này</option>
              </select>
            </label>
            <div className={styles.analysisToolActions}>
              <button type="button" onClick={clearAnalysisFilters}>Xóa lọc</button>
              <button type="button" onClick={saveView}>Lưu chế độ xem</button>
            </div>
          </div>
          {savedNotice ? <div className={styles.savedNotice} role="status">{savedNotice}</div> : null}

          <div className={styles.analysisTableWrap}>
            <table>
              <thead>
                <tr>
                  <BusinessTableSequenceHeader />
                  <th>{selectedDimension.label}</th>
                  <th>Doanh thu</th>
                  <th>{metricLabel(activeDimension)}</th>
                  <th>Tỷ trọng</th>
                  <th>Kỳ trước</th>
                  <th>Thay đổi</th>
                  <th>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, rowIndex) => (
                  <tr key={`${activeDimension}-${row.id ?? row.code ?? row.name}-${row.currencyCode}-${row.unit?.id ?? row.unit?.code ?? ''}`}>
                    <BusinessTableSequenceCell rowIndex={rowIndex} />
                    <td>
                      <strong>{row.name}</strong>
                      <small>{[row.code, row.currencyCode].filter(Boolean).join(' · ')}</small>
                    </td>
                    <td>{formatMoney(row.revenue, row.currencyCode)}</td>
                    <td>{metricValue(row, activeDimension)}</td>
                    <td>{formatDecimal(row.sharePercent)}%</td>
                    <td>{previousValue(row, activeDimension)}</td>
                    <td><span className={styles.changeBadge}>{rowChange(row)}</span></td>
                    <td>
                      <button type="button" className={styles.detailButton} onClick={() => setSelectedRow(row)}>
                        Xem
                      </button>
                    </td>
                  </tr>
                ))}
                {!busy && filteredRows.length === 0 ? (
                  <tr><td colSpan={8} className={styles.empty}>
                    {rows.length ? 'Không có dòng nào khớp bộ lọc phân tích.' : 'Không có dữ liệu cho chiều phân tích này trong kỳ.'}
                  </td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {selectedRow ? (
            <aside className={styles.detailPanel} aria-label={`Chi tiết ${selectedDimension.label.toLowerCase()}`}>
              <div className={styles.detailHeading}>
                <div>
                  <p className={styles.eyebrow}>Chi tiết</p>
                  <h3>{selectedRow.name}</h3>
                  <small>{[selectedRow.code, selectedRow.currencyCode].filter(Boolean).join(' · ')}</small>
                </div>
                <button type="button" onClick={() => setSelectedRow(null)} aria-label="Đóng chi tiết">Đóng</button>
              </div>
              <dl className={styles.detailGrid}>
                <div><dt>Doanh thu</dt><dd>{formatMoney(selectedRow.revenue, selectedRow.currencyCode)}</dd></div>
                <div><dt>Kỳ trước</dt><dd>{formatMoney(selectedRow.previousRevenue, selectedRow.currencyCode)}</dd></div>
                <div><dt>Thay đổi</dt><dd>{rowChange(selectedRow)}</dd></div>
                <div><dt>Tỷ trọng</dt><dd>{formatDecimal(selectedRow.sharePercent)}%</dd></div>
                <div><dt>Số đơn</dt><dd>{formatDecimal(selectedRow.documentCount)}</dd></div>
                <div><dt>Số khách</dt><dd>{formatDecimal(selectedRow.customerCount)}</dd></div>
                <div><dt>Số sản phẩm</dt><dd>{formatDecimal(selectedRow.productCount)}</dd></div>
                <div><dt>Sản lượng</dt><dd>{formatDecimal(selectedRow.quantity)} {selectedRow.unit?.name || selectedRow.unit?.code || ''}</dd></div>
              </dl>
            </aside>
          ) : null}
        </section>

        <section className={styles.panel} aria-labelledby="sales-trend-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Xu hướng theo ngày</p>
              <h2 id="sales-trend-title">Doanh thu theo ngày</h2>
            </div>
            <small>Giữ riêng từng loại tiền</small>
          </div>
          {trendSeries.length ? (
            <div className={styles.trendGrid}>
              {trendSeries.map((series) => (
                <TrendChart key={series.currencyCode} currencyCode={series.currencyCode} rows={series.rows} />
              ))}
            </div>
          ) : null}

          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <BusinessTableSequenceHeader />
                  <th>Ngày</th>
                  <th>Tiền tệ</th>
                  <th>Doanh thu</th>
                  <th>Doanh thu kỳ trước</th>
                  <th>Thay đổi</th>
                </tr>
              </thead>
              <tbody>
                {(report?.dailyTrend ?? []).map((row, rowIndex) => (
                  <tr key={`${row.businessDate}-${row.currencyCode}`}>
                    <BusinessTableSequenceCell rowIndex={rowIndex} />
                    <td>{row.businessDate}</td>
                    <td>{row.currencyCode}</td>
                    <td>{formatMoney(row.revenue, row.currencyCode)}</td>
                    <td>{formatMoney(row.previousRevenue, row.currencyCode)}</td>
                    <td>{percent(row.changePercent)}</td>
                  </tr>
                ))}
                {!busy && !(report?.dailyTrend.length) ? (
                  <tr><td colSpan={6} className={styles.empty}>Không có doanh thu theo ngày trong kỳ.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <div className={styles.twoColumns}>
          <section className={styles.panel} aria-label="Đối soát báo cáo">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Đối soát</p>
                <h2>Khớp với đơn bán hàng</h2>
              </div>
              <span className={styles.okBadge}>{report?.reconciliation.ok ? 'Đã khớp' : 'Cần kiểm tra'}</span>
            </div>
            <dl className={styles.factList}>
              <div><dt>Đơn đã kiểm</dt><dd>{formatDecimal(report?.reconciliation.checkedOrderCount)}</dd></div>
              <div><dt>Chênh lệch</dt><dd>{formatDecimal(report?.reconciliation.mismatchCount)}</dd></div>
            </dl>
            <p className={styles.helperText}>Doanh thu được đối chiếu với phiên bản đơn đã xác nhận hoặc thay thế gần nhất trong đúng kỳ và phạm vi kho.</p>
          </section>

          <section className={styles.panel} aria-label="Cảnh báo chất lượng dữ liệu">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Chất lượng dữ liệu</p>
                <h2>Điểm cần lưu ý</h2>
              </div>
              <span>{warnings.length} cảnh báo</span>
            </div>
            {warnings.length ? (
              <ul className={styles.warningList}>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            ) : (
              <p className={styles.goodState}>Không có cảnh báo chất lượng dữ liệu trong kỳ đang xem.</p>
            )}
          </section>
        </div>

        <p className={styles.lineage}>
          Số liệu lấy từ đơn bán hàng hiệu lực và các ảnh chụp nghiệp vụ đã lưu khi xác nhận. Báo cáo chỉ dùng phạm vi kho tài khoản hiện tại được cấp.
        </p>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
