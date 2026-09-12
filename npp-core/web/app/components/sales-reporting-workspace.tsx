'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell } from './app-shell';
import { BusinessTableSequenceCell, BusinessTableSequenceHeader } from './business-table-sequence';
import type { SalesBreakdownKey, SalesBreakdownRow, SalesReportingDashboard } from '../../lib/sales-reporting-types';
import styles from './sales-reporting-workspace.module.css';

type ApiEnvelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;
type Filters = Readonly<{ from: string; to: string; warehouseId: string }>;
type DimensionOption = Readonly<{ key: SalesBreakdownKey; label: string }>;

const EMPTY_FILTERS: Filters = Object.freeze({ from: '', to: '', warehouseId: '' });
const DIMENSIONS: readonly DimensionOption[] = Object.freeze([
  Object.freeze({ key: 'customers', label: 'Khách hàng' }),
  Object.freeze({ key: 'customerGroups', label: 'Loại khách' }),
  Object.freeze({ key: 'channels', label: 'Kênh bán' }),
  Object.freeze({ key: 'products', label: 'Sản phẩm' }),
  Object.freeze({ key: 'productGroups', label: 'Nhóm hàng' }),
  Object.freeze({ key: 'employees', label: 'Nhân viên bán hàng' }),
]);

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
  return `${formatDecimal(value)} ${currencyCode === 'VND' ? '₫' : currencyCode}`;
}

function formatPercent(value: string | null | undefined) {
  if (value === null || value === undefined || String(value).trim() === '') return 'Chưa có cơ sở so sánh';
  return `${formatDecimal(value)}%`;
}

function rowChange(row: SalesBreakdownRow) {
  if (row.comparisonState === 'new') return 'Mới trong kỳ';
  if (row.comparisonState === 'inactive') return 'Không phát sinh kỳ này';
  return formatPercent(row.changePercent);
}

function metricLabel(dimension: SalesBreakdownKey) {
  if (dimension === 'products') return 'Sản lượng';
  if (dimension === 'customers') return 'Số đơn';
  if (dimension === 'productGroups') return 'Số sản phẩm';
  if (dimension === 'customerGroups') return 'Khách · đơn';
  return 'Đơn · khách';
}

function metricValue(row: SalesBreakdownRow, dimension: SalesBreakdownKey) {
  if (dimension === 'products') {
    const unit = row.unit?.name || row.unit?.code || 'ĐVT chưa xác định';
    return `${formatDecimal(row.quantity)} ${unit}`;
  }
  if (dimension === 'customers') return `${formatDecimal(row.documentCount)} đơn`;
  if (dimension === 'customerGroups') return `${formatDecimal(row.customerCount)} khách · ${formatDecimal(row.documentCount)} đơn`;
  if (dimension === 'productGroups') return `${formatDecimal(row.productCount)} sản phẩm`;
  return `${formatDecimal(row.documentCount)} đơn · ${formatDecimal(row.customerCount)} khách`;
}

function previousValue(row: SalesBreakdownRow, dimension: SalesBreakdownKey) {
  const revenue = formatMoney(row.previousRevenue, row.currencyCode);
  if (dimension !== 'products') return revenue;
  const unit = row.unit?.name || row.unit?.code || 'ĐVT chưa xác định';
  return `${revenue} · ${formatDecimal(row.previousQuantity)} ${unit}`;
}

async function requestReport(filters: Filters): Promise<SalesReportingDashboard> {
  const query = new URLSearchParams();
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.warehouseId) query.set('warehouseId', filters.warehouseId);
  const serialized = query.toString();
  const response = await fetch(`/api/reporting/sales${serialized ? `?${serialized}` : ''}`, { method: 'GET', cache: 'no-store' });
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

  const load = useCallback(async (filters: Filters, initialize = false) => {
    setBusy(true);
    setError('');
    try {
      const next = await requestReport(filters);
      const canonical = Object.freeze({ from: next.filters.from, to: next.filters.to, warehouseId: next.filters.warehouseId ?? '' });
      setReport(next);
      setApplied(canonical);
      if (initialize) setDraft(canonical);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được báo cáo bán hàng.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(EMPTY_FILTERS, true); }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(draft);
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    void load(EMPTY_FILTERS, true);
  }

  const selectedDimension = DIMENSIONS.find((item) => item.key === activeDimension) ?? DIMENSIONS[0];
  const rows = report?.breakdowns[activeDimension] ?? [];
  const revenueRows = report?.summary.revenues ?? [];
  const warehouses = report?.scopeWarehouses ?? [];
  const previousPeriod = report?.comparison.previous;
  const warnings = report?.dataQuality.warnings ?? [];
  const periodDescription = applied.from && applied.to ? `${applied.from} → ${applied.to}` : 'Mặc định tháng hiện tại theo giờ Việt Nam';

  const actions = (
    <div className={styles.headerActions}>
      <Link className={styles.headerLink} href="/sales/sales-orders">Mở đơn bán hàng</Link>
      <Link className={styles.headerLink} href="/sales/gross-margin">Xem báo cáo lãi gộp</Link>
    </div>
  );

  return (
    <AppShell kicker="Bán hàng · Báo cáo" title="Báo cáo bán hàng" subtitle="Theo dõi doanh thu, đơn đã chốt, khách mua và sản lượng theo đúng kỳ và phạm vi kho được cấp." actions={actions}>
      <div className={styles.workspace} data-testid="sales-reporting-workspace" aria-busy={busy}>
        <form className={styles.filters} onSubmit={applyFilters} aria-label="Bộ lọc Báo cáo bán hàng">
          <div className={styles.filterHeading}>
            <div><p className={styles.eyebrow}>Kỳ báo cáo</p><h2>Thời gian và kho</h2></div>
            <small>{periodDescription}</small>
          </div>
          <div className={styles.filterGrid}>
            <label><span>Từ ngày</span><input type="date" value={draft.from} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} /></label>
            <label><span>Đến ngày</span><input type="date" value={draft.to} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} /></label>
            <label>
              <span>Kho</span>
              <select value={draft.warehouseId} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, warehouseId: event.target.value }))}>
                <option value="">Tất cả kho được cấp quyền</option>
                {warehouses.map((warehouse) => <option key={warehouse.warehouseId} value={warehouse.warehouseId}>{warehouse.warehouseCode} — {warehouse.warehouseName}</option>)}
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

        {report ? <>
          <section className={styles.summaryGrid} aria-label="Tổng hợp bán hàng">
            <article className={styles.revenueCard}>
              <span className={styles.cardLabel}>Doanh thu</span>
              {revenueRows.length ? revenueRows.map((row) => <div className={styles.revenueLine} key={row.currencyCode}><strong>{formatMoney(row.revenue, row.currencyCode)}</strong><small>Kỳ trước {formatMoney(row.previousRevenue, row.currencyCode)} · {formatPercent(row.changePercent)}</small></div>) : <strong className={styles.cardValue}>0</strong>}
            </article>
            <article><span className={styles.cardLabel}>Đơn đã chốt</span><strong className={styles.cardValue}>{formatDecimal(report.summary.effectiveOrderCount)}</strong><small>Đơn đã xác nhận hoặc đã đóng trong kỳ.</small></article>
            <article><span className={styles.cardLabel}>Khách mua</span><strong className={styles.cardValue}>{formatDecimal(report.summary.buyerCount)}</strong><small>Khách có đơn bán hàng hiệu lực trong kỳ.</small></article>
            <article><span className={styles.cardLabel}>Mặt hàng đã bán</span><strong className={styles.cardValue}>{formatDecimal(report.summary.soldProductCount)}</strong><small>Sản lượng được giữ theo đúng từng sản phẩm và đơn vị tính.</small></article>
          </section>

          <section className={styles.panel} aria-labelledby="sales-analysis-title">
            <div className={styles.sectionHeading}>
              <div><p className={styles.eyebrow}>Phân tích</p><h2 id="sales-analysis-title">Xem theo {selectedDimension.label.toLowerCase()}</h2></div>
              {previousPeriod ? <small>Kỳ trước: {previousPeriod.from} → {previousPeriod.to}</small> : null}
            </div>
            <div className={styles.dimensionTabs} role="tablist" aria-label="Chiều phân tích Báo cáo bán hàng">
              {DIMENSIONS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={item.key === activeDimension} className={item.key === activeDimension ? styles.activeTab : styles.tab} onClick={() => setActiveDimension(item.key)}>{item.label}</button>)}
            </div>
            <div className={styles.analysisTableWrap}>
              <table>
                <thead><tr><BusinessTableSequenceHeader /><th>{selectedDimension.label}</th><th>Doanh thu</th><th>{metricLabel(activeDimension)}</th><th>Tỷ trọng</th><th>Kỳ trước</th><th>Thay đổi</th></tr></thead>
                <tbody>
                  {rows.map((row, rowIndex) => <tr key={`${activeDimension}-${row.id ?? row.code ?? row.name}-${row.currencyCode}-${row.unit?.id ?? row.unit?.code ?? ''}`}>
                    <BusinessTableSequenceCell rowIndex={rowIndex} />
                    <td><strong>{row.name}</strong><small>{[row.code, row.currencyCode].filter(Boolean).join(' · ')}</small></td>
                    <td>{formatMoney(row.revenue, row.currencyCode)}</td><td>{metricValue(row, activeDimension)}</td><td>{formatDecimal(row.sharePercent)}%</td><td>{previousValue(row, activeDimension)}</td><td><span className={styles.changeBadge}>{rowChange(row)}</span></td>
                  </tr>)}
                  {!busy && rows.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Không có dữ liệu cho chiều phân tích này trong kỳ.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="sales-trend-title">
            <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Xu hướng theo ngày</p><h2 id="sales-trend-title">Doanh thu theo ngày</h2></div><small>Giữ riêng từng loại tiền</small></div>
            <div className={styles.tableWrap}><table>
              <thead><tr><BusinessTableSequenceHeader /><th>Ngày</th><th>Tiền tệ</th><th>Doanh thu</th><th>Ngày tương ứng kỳ trước</th><th>Thay đổi</th></tr></thead>
              <tbody>
                {report.dailyTrend.map((row, rowIndex) => <tr key={`${row.businessDate}-${row.currencyCode}`}><BusinessTableSequenceCell rowIndex={rowIndex} /><td>{row.businessDate}</td><td>{row.currencyCode}</td><td>{formatMoney(row.revenue, row.currencyCode)}</td><td>{formatMoney(row.previousRevenue, row.currencyCode)}</td><td>{formatPercent(row.changePercent)}</td></tr>)}
                {!busy && report.dailyTrend.length === 0 ? <tr><td colSpan={6} className={styles.empty}>Không có doanh thu theo ngày trong kỳ.</td></tr> : null}
              </tbody>
            </table></div>
          </section>

          <div className={styles.twoColumns}>
            <section className={styles.panel} aria-label="Đối soát báo cáo">
              <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Đối soát</p><h2>Khớp với đơn bán hàng</h2></div><span className={styles.okBadge}>{report.reconciliation.ok ? 'Đã khớp' : 'Cần kiểm tra'}</span></div>
              <dl className={styles.factList}><div><dt>Đơn đã kiểm</dt><dd>{formatDecimal(report.reconciliation.checkedOrderCount)}</dd></div><div><dt>Chênh lệch</dt><dd>{formatDecimal(report.reconciliation.mismatchCount)}</dd></div></dl>
              <p className={styles.helperText}>Doanh thu được đối chiếu với phiên bản đơn đã xác nhận hoặc thay thế gần nhất trong đúng kỳ và phạm vi kho.</p>
            </section>
            <section className={styles.panel} aria-label="Cảnh báo chất lượng dữ liệu">
              <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Chất lượng dữ liệu</p><h2>Điểm cần lưu ý</h2></div><span>{warnings.length} cảnh báo</span></div>
              {warnings.length ? <ul className={styles.warningList}>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p className={styles.goodState}>Không có cảnh báo chất lượng dữ liệu trong kỳ đang xem.</p>}
            </section>
          </div>
          <p className={styles.lineage}>Số liệu lấy từ đơn bán hàng hiệu lực và các ảnh chụp nghiệp vụ đã lưu khi xác nhận. Báo cáo chỉ dùng phạm vi kho tài khoản hiện tại được cấp.</p>
        </> : null}
      </div>
    </AppShell>
  );
}
