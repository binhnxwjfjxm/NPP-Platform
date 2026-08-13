import Link from 'next/link';
import type { ReactNode } from 'react';
import type { DashboardReports, DashboardStructureMetric } from './dashboard-report-types';
import { DashboardSalesInventoryCards } from './dashboard-sales-inventory-cards';
import { DashboardLogisticsAgingCards } from './dashboard-logistics-aging-cards';
import { count, dateLabel, generatedLabel, money, percent, sumDecimals } from './dashboard-report-format';
import styles from './dashboard.module.css';

type Props = Readonly<{
  structureMetrics: readonly DashboardStructureMetric[];
  reports: DashboardReports;
  reportErrors: readonly string[];
  children: ReactNode;
}>;

function KpiIcon({ id }: { id: string }) {
  return <span className={styles.kpiIcon} aria-hidden="true"><strong>{id === 'logistics' ? '↗' : id === 'locations' ? '⌖' : '▦'}</strong></span>;
}

export function DashboardOperations({ structureMetrics, reports, reportErrors, children }: Props) {
  const receivableRows = reports.aging?.receivable.summary.filter((row) => row.currencyCode === 'VND') ?? [];
  const receivableTotal = sumDecimals(receivableRows.map((row) => row.remainingAmount));
  const latest = [reports.sales?.generatedAt, reports.inventory?.generatedAt, reports.logistics?.generatedAt, reports.aging?.generatedAt]
    .filter((value): value is string => Boolean(value)).sort().at(-1);
  const unavailable = 'Không khả dụng trong phạm vi hiện tại';
  const kpis = [
    ...structureMetrics.map((metric) => ({ id: metric.id, label: metric.label, value: count(metric.active), hint: `${count(metric.total)} tổng cộng` })),
    { id: 'orders', label: 'Đơn bán hiệu lực', value: reports.sales ? count(reports.sales.summary.effectiveOrderCount) : '—', hint: reports.sales ? `${dateLabel(reports.sales.filters.from)} → ${dateLabel(reports.sales.filters.to)}` : unavailable },
    { id: 'inventory', label: 'Giá trị tồn kho', value: reports.inventory ? money(reports.inventory.summary.inventoryValueVnd, true) : '—', hint: reports.inventory ? `${count(reports.inventory.summary.stockedSkuCount)} SKU có tồn` : unavailable },
    { id: 'logistics', label: 'Giao đủ đúng hạn', value: reports.logistics ? percent(reports.logistics.summary.onTimeFullRatePercent) : '—', hint: reports.logistics ? `${count(reports.logistics.summary.onTimeEligibleFullCount)} phiếu đủ điều kiện SLA` : unavailable },
    { id: 'receivable', label: 'Công nợ phải thu', value: reports.aging ? money(receivableTotal, true) : '—', hint: reports.aging ? 'Số dư VND hiện còn phải thu' : unavailable },
  ];
  const activity = [
    ['Đơn bán hiệu lực', count(reports.sales?.summary.effectiveOrderCount), 'Trong kỳ'],
    ['Đơn bán đã hủy', count(reports.sales?.summary.cancelledOrderCount), 'Sau xác nhận / trong kỳ'],
    ['SKU có tồn', count(reports.inventory?.summary.stockedSkuCount), 'Tồn hiện tại'],
    ['Ngoại lệ giá vốn', count(reports.inventory?.summary.costingExceptionCount), 'Cần đối soát'],
    ['Chuyến giao', count(reports.logistics?.summary.tripCount), 'Trong kỳ'],
    ['Phiếu giao đủ', count(reports.logistics?.summary.deliveredFullCount), 'Kết quả canonical'],
  ] as const;

  return <>
    <section className={styles.kpiSection} aria-labelledby="dashboard-kpi-title" data-testid="dashboard-kpi-strip">
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Nhịp vận hành</p><h2 id="dashboard-kpi-title">Chỉ số cần nhìn ngay</h2></div><Link href="/organization" className={styles.inlineLink}>Xem cơ cấu</Link></div>
      <div className={styles.kpiGrid}>{kpis.map((metric) => <article key={metric.id} className={styles.kpiCard} data-testid={`dashboard-metric-${metric.id}`}><KpiIcon id={metric.id} /><span className={styles.kpiCopy}><small>{metric.label}</small><strong>{metric.value}</strong><em>{metric.hint}</em></span></article>)}</div>
    </section>

    {children}

    <section className={styles.measurementSection} aria-labelledby="dashboard-measurement-title" data-testid="dashboard-measurements">
      <div className={styles.measurementHeading}>
        <div><p className={styles.eyebrow}>Đo lường vận hành</p><h2 id="dashboard-measurement-title">Theo dõi xu hướng và điểm cần chú ý</h2><p>Số liệu đọc theo đúng quyền và phạm vi của tài khoản hiện tại, không tạo nguồn dữ liệu riêng.</p></div>
        <div className={styles.measurementActions}><span>{generatedLabel(latest)}</span><form action="/dashboard" method="get"><button type="submit">Cập nhật</button></form></div>
      </div>
      {reportErrors.length ? <div className={styles.dataNotice} role="status" data-testid="dashboard-report-availability">Chưa hiển thị được nhóm: {reportErrors.join(', ')}. Hệ thống giữ nguyên phân quyền hiện tại; các nhóm còn lại vẫn hiển thị bình thường.</div> : null}
      <div className={styles.analyticsGrid}><DashboardSalesInventoryCards reports={reports} /><DashboardLogisticsAgingCards reports={reports} /></div>
      <div className={styles.activityStrip} aria-label="Tổng quan hoạt động">{activity.map(([label, value, hint]) => <div key={label} className={styles.activityItem}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div>
    </section>
  </>;
}
