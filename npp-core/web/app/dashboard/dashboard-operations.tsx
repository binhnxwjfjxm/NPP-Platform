'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ReportingDashboard } from '../../lib/reporting-dashboard-types';
import type { InventoryReportingDashboard } from '../../lib/inventory-reporting-types';
import type { LogisticsDashboard } from '../../lib/logistics-reporting-types';
import type { AgingDashboard, AgingBucketRow } from '../../lib/finance-reporting-types';
import styles from './dashboard.module.css';

type ApiEnvelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;

type DashboardReports = {
  sales?: ReportingDashboard;
  inventory?: InventoryReportingDashboard;
  logistics?: LogisticsDashboard;
  aging?: AgingDashboard;
};

export type DashboardStructureMetric = Readonly<{
  id: 'branches' | 'warehouses' | 'locations';
  label: string;
  total: number;
  active: number;
}>;

type DashboardOperationsProps = Readonly<{
  structureMetrics: readonly DashboardStructureMetric[];
  children: ReactNode;
}>;

const DECIMAL_SCALE = 1_000_000n;

async function requestCanonical<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: 'GET', cache: 'no-store' });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || !envelope.data) {
    throw new Error(envelope.error?.message || `Không tải được ${path}`);
  }
  return envelope.data;
}

function parseScaledDecimal(value: string | null | undefined): bigint | null {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return null;
  const [, sign, integer, fraction = ''] = match;
  const fractionScaled = fraction.padEnd(6, '0').slice(0, 6);
  const scaled = BigInt(integer) * DECIMAL_SCALE + BigInt(fractionScaled || '0');
  return sign === '-' ? -scaled : scaled;
}

function scaledToDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const integer = absolute / DECIMAL_SCALE;
  const fraction = String(absolute % DECIMAL_SCALE).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

function sumDecimals(values: readonly string[]) {
  let total = 0n;
  for (const value of values) {
    const parsed = parseScaledDecimal(value);
    if (parsed !== null) total += parsed;
  }
  return scaledToDecimal(total);
}

function toNumeric(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value: string | number | null | undefined) {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(numeric) : '—';
}

function formatVnd(value: string | null | undefined) {
  const numeric = toNumeric(value);
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(numeric)} ₫`;
}

function formatVndCompact(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = toNumeric(value);
  if (!numeric) return '0 ₫';
  return `${new Intl.NumberFormat('vi-VN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(numeric)} ₫`;
}

function formatPercent(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  return normalized ? `${normalized.replace('.', ',')}%` : '—';
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}` : value;
}

function formatGeneratedAt(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function agingLabel(bucket: string) {
  return ({
    AGE_0_30: '0–30 ngày',
    AGE_31_60: '31–60 ngày',
    AGE_61_90: '61–90 ngày',
    AGE_91_PLUS: 'Trên 90 ngày',
  } as Record<string, string>)[bucket] ?? bucket;
}

function metricIcon(id: string) {
  const glyphs: Record<string, ReactNode> = {
    branches: <><path d="M5 20V7h6v13M11 20V4h8v16M3 20h18" /><path d="M7 10h2M7 14h2M14 8h2M14 12h2M14 16h2" /></>,
    warehouses: <><path d="m3 9 9-5 9 5v11H3z" /><path d="M7 13h10M8 20v-7h8v7" /></>,
    locations: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.4" /></>,
    orders: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8 8h8M8 12h6M8 16h4" /></>,
    inventory: <><path d="m4 8 8-4 8 4-8 4z" /><path d="m4 8v8l8 4 8-4V8M12 12v8" /></>,
    logistics: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
    receivable: <><path d="M4 7h16v11H4z" /><path d="M7 10h5M7 14h7M17 10v4" /></>,
  };
  return glyphs[id] ?? glyphs.orders;
}

function MetricGlyph({ id }: { id: string }) {
  return (
    <span className={styles.kpiIcon} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {metricIcon(id)}
      </svg>
    </span>
  );
}

export function DashboardOperations({ structureMetrics, children }: DashboardOperationsProps) {
  const [reports, setReports] = useState<DashboardReports>({});
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [sales, inventory, logistics, aging] = await Promise.allSettled([
      requestCanonical<ReportingDashboard>('/api/reporting/sales'),
      requestCanonical<InventoryReportingDashboard>('/api/reporting/inventory'),
      requestCanonical<LogisticsDashboard>('/api/reporting/logistics'),
      requestCanonical<AgingDashboard>('/api/reporting/aging'),
    ]);

    const next: DashboardReports = {};
    const nextErrors: string[] = [];

    if (sales.status === 'fulfilled') next.sales = sales.value;
    else nextErrors.push('bán hàng');
    if (inventory.status === 'fulfilled') next.inventory = inventory.value;
    else nextErrors.push('tồn kho');
    if (logistics.status === 'fulfilled') next.logistics = logistics.value;
    else nextErrors.push('giao hàng');
    if (aging.status === 'fulfilled') next.aging = aging.value;
    else nextErrors.push('công nợ');

    setReports(next);
    setErrors(nextErrors);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const salesVnd = reports.sales?.currencyTotals.find((row) => row.currencyCode === 'VND');
  const receivableVndRows = useMemo(
    () => reports.aging?.receivable.summary.filter((row) => row.currencyCode === 'VND') ?? [],
    [reports.aging],
  );
  const receivableTotal = useMemo(
    () => sumDecimals(receivableVndRows.map((row) => row.remainingAmount)),
    [receivableVndRows],
  );

  const salesTrend = useMemo(
    () => (reports.sales?.dailyTrend ?? [])
      .filter((row) => row.currencyCode === 'VND')
      .slice(-7),
    [reports.sales],
  );
  const trendValues = salesTrend.map((row) => toNumeric(row.totalValue));
  const trendMax = Math.max(1, ...trendValues);
  const trendPoints = salesTrend.map((row, index) => {
    const x = salesTrend.length <= 1 ? 300 : 28 + (index * 544) / (salesTrend.length - 1);
    const y = 192 - (toNumeric(row.totalValue) / trendMax) * 150;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const warehouseValues = reports.inventory?.warehouseSummary.slice(0, 6) ?? [];
  const warehouseMax = Math.max(1, ...warehouseValues.map((row) => toNumeric(row.inventoryValueVnd)));

  const onTimeRate = toNumeric(reports.logistics?.summary.onTimeFullRatePercent);
  const onTimeDisplay = reports.logistics?.summary.onTimeFullRatePercent ? clampPercent(onTimeRate) : null;
  const donutBackground = onTimeDisplay === null
    ? 'var(--dashboard-chart-neutral)'
    : `conic-gradient(var(--dashboard-positive) 0 ${onTimeDisplay}%, var(--dashboard-warning) ${onTimeDisplay}% 100%)`;

  const agingTotalNumeric = Math.max(0, toNumeric(receivableTotal));
  const generatedAt = [
    reports.sales?.generatedAt,
    reports.inventory?.generatedAt,
    reports.logistics?.generatedAt,
    reports.aging?.generatedAt,
  ].filter(Boolean).sort().at(-1);

  const kpis = [
    ...structureMetrics.map((metric) => ({
      id: metric.id,
      label: metric.label,
      value: formatCount(metric.active),
      hint: `${formatCount(metric.total)} tổng cộng`,
    })),
    {
      id: 'orders',
      label: 'Đơn bán hiệu lực',
      value: reports.sales ? formatCount(reports.sales.summary.effectiveOrderCount) : '—',
      hint: reports.sales ? `${formatDateLabel(reports.sales.filters.from)} → ${formatDateLabel(reports.sales.filters.to)}` : 'Đang cập nhật kỳ báo cáo',
    },
    {
      id: 'inventory',
      label: 'Giá trị tồn kho',
      value: reports.inventory ? formatVndCompact(reports.inventory.summary.inventoryValueVnd) : '—',
      hint: reports.inventory ? `${formatCount(reports.inventory.summary.stockedSkuCount)} SKU có tồn` : 'Đang cập nhật tồn kho',
    },
    {
      id: 'logistics',
      label: 'Giao đủ đúng hạn',
      value: reports.logistics ? formatPercent(reports.logistics.summary.onTimeFullRatePercent) : '—',
      hint: reports.logistics ? `${formatCount(reports.logistics.summary.onTimeEligibleFullCount)} phiếu đủ điều kiện SLA` : 'Đang cập nhật giao hàng',
    },
    {
      id: 'receivable',
      label: 'Công nợ phải thu',
      value: reports.aging ? formatVndCompact(receivableTotal) : '—',
      hint: reports.aging ? 'Số dư VND hiện còn phải thu' : 'Đang cập nhật công nợ',
    },
  ];

  const activityItems = [
    { label: 'Đơn bán hiệu lực', value: formatCount(reports.sales?.summary.effectiveOrderCount), hint: 'Trong kỳ' },
    { label: 'Đơn bán đã hủy', value: formatCount(reports.sales?.summary.cancelledOrderCount), hint: 'Sau xác nhận / trong kỳ' },
    { label: 'SKU có tồn', value: formatCount(reports.inventory?.summary.stockedSkuCount), hint: 'Tồn hiện tại' },
    { label: 'Ngoại lệ giá vốn', value: formatCount(reports.inventory?.summary.costingExceptionCount), hint: 'Cần đối soát' },
    { label: 'Chuyến giao', value: formatCount(reports.logistics?.summary.tripCount), hint: 'Trong kỳ' },
    { label: 'Phiếu giao đủ', value: formatCount(reports.logistics?.summary.deliveredFullCount), hint: 'Kết quả canonical' },
  ];

  return (
    <>
      <section className={styles.kpiSection} aria-labelledby="dashboard-kpi-title" data-testid="dashboard-kpi-strip">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Nhịp vận hành</p>
            <h2 id="dashboard-kpi-title">Chỉ số cần nhìn ngay</h2>
          </div>
          <Link href="/organization" className={styles.inlineLink}>Xem cơ cấu</Link>
        </div>
        <div className={styles.kpiGrid}>
          {kpis.map((metric) => (
            <article key={metric.id} className={styles.kpiCard} data-testid={`dashboard-metric-${metric.id}`}>
              <MetricGlyph id={metric.id} />
              <span className={styles.kpiCopy}>
                <small>{metric.label}</small>
                <strong>{metric.value}</strong>
                <em>{metric.hint}</em>
              </span>
            </article>
          ))}
        </div>
      </section>

      {children}

      <section className={styles.measurementSection} aria-labelledby="dashboard-measurement-title" data-testid="dashboard-measurements">
        <div className={styles.measurementHeading}>
          <div>
            <p className={styles.eyebrow}>Đo lường vận hành</p>
            <h2 id="dashboard-measurement-title">Theo dõi xu hướng và điểm cần chú ý</h2>
            <p>Đọc trực tiếp các reporting read-model canonical; không tạo nguồn số liệu riêng cho Dashboard.</p>
          </div>
          <div className={styles.measurementActions}>
            <span>{generatedAt ? `Cập nhật ${formatGeneratedAt(generatedAt)}` : loading ? 'Đang tải số liệu…' : 'Chưa có thời điểm cập nhật'}</span>
            <button type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Đang cập nhật…' : 'Cập nhật'}</button>
          </div>
        </div>

        {errors.length ? (
          <div className={styles.dataNotice} role="status">
            Chưa cập nhật được nhóm: {errors.join(', ')}. Các nhóm còn lại vẫn hiển thị theo nguồn canonical hiện có.
          </div>
        ) : null}

        <div className={styles.analyticsGrid}>
          <article className={`${styles.analyticsCard} ${styles.salesTrendCard}`}>
            <div className={styles.cardHeading}>
              <div><small>Bán hàng</small><h3>Giá trị đơn bán theo ngày</h3></div>
              <Link href="/sales/reporting">Xem báo cáo</Link>
            </div>
            <div className={styles.chartMeta}>
              <strong>{salesVnd ? formatVnd(salesVnd.totalValue) : '—'}</strong>
              <span>VND · {reports.sales ? `${formatDateLabel(reports.sales.filters.from)} → ${formatDateLabel(reports.sales.filters.to)}` : 'kỳ hiện tại'}</span>
            </div>
            {salesTrend.length ? (
              <div className={styles.lineChart}>
                <svg viewBox="0 0 600 220" role="img" aria-label="Xu hướng giá trị đơn bán VND 7 ngày gần nhất">
                  {[42, 79, 117, 154, 192].map((y) => <line key={y} x1="28" y1={y} x2="572" y2={y} className={styles.chartGridLine} />)}
                  <polyline points={trendPoints} className={styles.trendLine} />
                  {salesTrend.map((row, index) => {
                    const x = salesTrend.length <= 1 ? 300 : 28 + (index * 544) / (salesTrend.length - 1);
                    const y = 192 - (toNumeric(row.totalValue) / trendMax) * 150;
                    return <circle key={`${row.businessDate}-${index}`} cx={x} cy={y} r="4" className={styles.trendPoint} />;
                  })}
                </svg>
                <div className={styles.chartAxisLabels}>
                  {salesTrend.map((row) => <span key={row.businessDate}>{formatDateLabel(row.businessDate)}</span>)}
                </div>
              </div>
            ) : <div className={styles.chartEmpty}>Chưa có đơn bán VND trong kỳ.</div>}
          </article>

          <article className={styles.analyticsCard}>
            <div className={styles.cardHeading}>
              <div><small>Tồn kho</small><h3>Giá trị tồn theo kho</h3></div>
              <Link href="/inventory/reporting">Xem báo cáo</Link>
            </div>
            <div className={styles.chartMeta}>
              <strong>{reports.inventory ? formatVnd(reports.inventory.summary.inventoryValueVnd) : '—'}</strong>
              <span>Giá trị tồn hiện tại · VND</span>
            </div>
            {warehouseValues.length ? (
              <div className={styles.barChart} aria-label="Giá trị tồn kho VND theo kho">
                {warehouseValues.map((row) => {
                  const ratio = clampPercent((toNumeric(row.inventoryValueVnd) / warehouseMax) * 100);
                  return (
                    <div key={row.warehouseId} className={styles.barColumn} title={`${row.warehouseName}: ${formatVnd(row.inventoryValueVnd)}`}>
                      <span className={styles.barValueLabel}>{formatVndCompact(row.inventoryValueVnd)}</span>
                      <div className={styles.barTrack}><span className={styles.barFill} style={{ height: `${ratio}%` }} /></div>
                      <strong>{row.warehouseCode}</strong>
                    </div>
                  );
                })}
              </div>
            ) : <div className={styles.chartEmpty}>Chưa có giá trị tồn kho để hiển thị.</div>}
          </article>

          <article className={styles.analyticsCard}>
            <div className={styles.cardHeading}>
              <div><small>Giao hàng</small><h3>Giao đủ đúng hạn</h3></div>
              <Link href="/logistics/reporting">Chi tiết</Link>
            </div>
            <div className={styles.donutLayout}>
              <div className={styles.donut} style={{ background: donutBackground }} aria-label={`Tỷ lệ giao đủ đúng hạn ${formatPercent(reports.logistics?.summary.onTimeFullRatePercent)}`}>
                <div><strong>{formatPercent(reports.logistics?.summary.onTimeFullRatePercent)}</strong><span>đúng hạn</span></div>
              </div>
              <div className={styles.donutLegend}>
                <p><span className={styles.legendPositive} />Đúng hạn <strong>{formatCount(reports.logistics?.summary.onTimeFullCount)}</strong></p>
                <p><span className={styles.legendWarning} />Trễ <strong>{formatCount(reports.logistics?.summary.lateFullCount)}</strong></p>
                <p><span className={styles.legendNeutral} />Thiếu SLA <strong>{formatCount(reports.logistics?.summary.fullWithoutPlanCount)}</strong></p>
              </div>
            </div>
            <div className={styles.cardFootMetric}>
              <span>Phiếu giao đủ</span><strong>{formatCount(reports.logistics?.summary.deliveredFullCount)}</strong>
            </div>
          </article>

          <article className={styles.analyticsCard}>
            <div className={styles.cardHeading}>
              <div><small>Công nợ</small><h3>Tuổi khoản phải thu</h3></div>
              <Link href="/accounting/aging">Chi tiết</Link>
            </div>
            <div className={styles.chartMeta}>
              <strong>{reports.aging ? formatVnd(receivableTotal) : '—'}</strong>
              <span>Số dư VND hiện còn phải thu</span>
            </div>
            <div className={styles.agingList}>
              {receivableVndRows.map((row: AgingBucketRow) => {
                const ratio = agingTotalNumeric > 0 ? clampPercent((toNumeric(row.remainingAmount) / agingTotalNumeric) * 100) : 0;
                return (
                  <div key={row.ageBucket} className={styles.agingRow}>
                    <div><span>{agingLabel(row.ageBucket)}</span><strong>{formatVndCompact(row.remainingAmount)}</strong></div>
                    <div className={styles.agingTrack}><span style={{ width: `${ratio}%` }} /></div>
                    <small>{formatCount(row.documentCount)} chứng từ · {ratio.toFixed(1).replace('.', ',')}%</small>
                  </div>
                );
              })}
              {!receivableVndRows.length ? <div className={styles.chartEmpty}>Không có khoản phải thu VND đang mở.</div> : null}
            </div>
          </article>
        </div>

        <div className={styles.activityStrip} aria-label="Tổng quan hoạt động">
          {activityItems.map((item) => (
            <div key={item.label} className={styles.activityItem}>
              <span>{item.label}</span><strong>{item.value}</strong><small>{item.hint}</small>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
