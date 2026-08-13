import Link from 'next/link';
import type { DashboardReports } from './dashboard-report-types';
import { dateLabel, money, numeric } from './dashboard-report-format';
import styles from './dashboard.module.css';

export function DashboardSalesInventoryCards({ reports }: { reports: DashboardReports }) {
  const salesVnd = reports.sales?.currencyTotals.find((row) => row.currencyCode === 'VND');
  const salesTrend = (reports.sales?.dailyTrend ?? [])
    .filter((row) => row.currencyCode === 'VND')
    .slice(-7);
  const trendMax = Math.max(1, ...salesTrend.map((row) => numeric(row.totalValue)));
  const trendPoints = salesTrend.map((row, index) => {
    const x = salesTrend.length <= 1 ? 300 : 28 + (index * 544) / (salesTrend.length - 1);
    const y = 192 - (numeric(row.totalValue) / trendMax) * 150;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const warehouses = reports.inventory?.warehouseSummary.slice(0, 6) ?? [];
  const warehouseMax = Math.max(1, ...warehouses.map((row) => numeric(row.inventoryValueVnd)));
  const unavailable = 'Không khả dụng trong phạm vi hiện tại';

  return (
    <>
      <article className={styles.analyticsCard}>
        <div className={styles.cardHeading}>
          <div><small>Bán hàng</small><h3>Giá trị đơn bán theo ngày</h3></div>
          <Link href="/sales/reporting">Xem báo cáo</Link>
        </div>
        <div className={styles.chartMeta}>
          <strong>{salesVnd ? money(salesVnd.totalValue) : '—'}</strong>
          <span>VND · {reports.sales ? `${dateLabel(reports.sales.filters.from)} → ${dateLabel(reports.sales.filters.to)}` : unavailable}</span>
        </div>
        {salesTrend.length ? (
          <div className={styles.lineChart}>
            <svg viewBox="0 0 600 220" role="img" aria-label="Xu hướng giá trị đơn bán VND 7 ngày gần nhất">
              {[42, 79, 117, 154, 192].map((y) => <line key={y} x1="28" y1={y} x2="572" y2={y} className={styles.chartGridLine} />)}
              <polyline points={trendPoints} className={styles.trendLine} />
              {salesTrend.map((row, index) => {
                const x = salesTrend.length <= 1 ? 300 : 28 + (index * 544) / (salesTrend.length - 1);
                const y = 192 - (numeric(row.totalValue) / trendMax) * 150;
                return <circle key={`${row.businessDate}-${index}`} cx={x} cy={y} r="4" className={styles.trendPoint} />;
              })}
            </svg>
            <div className={styles.chartAxisLabels}>
              {salesTrend.map((row) => <span key={row.businessDate}>{dateLabel(row.businessDate)}</span>)}
            </div>
          </div>
        ) : <div className={styles.chartEmpty}>Chưa có dữ liệu bán hàng được phép hiển thị trong kỳ.</div>}
      </article>

      <article className={styles.analyticsCard}>
        <div className={styles.cardHeading}>
          <div><small>Tồn kho</small><h3>Giá trị tồn theo kho</h3></div>
          <Link href="/inventory/reporting">Xem báo cáo</Link>
        </div>
        <div className={styles.chartMeta}>
          <strong>{reports.inventory ? money(reports.inventory.summary.inventoryValueVnd) : '—'}</strong>
          <span>Giá trị tồn hiện tại · VND</span>
        </div>
        {warehouses.length ? (
          <div className={styles.barChart} aria-label="Giá trị tồn kho VND theo kho">
            {warehouses.map((row) => {
              const ratio = Math.min(100, Math.max(0, (numeric(row.inventoryValueVnd) / warehouseMax) * 100));
              return (
                <div key={row.warehouseId} className={styles.barColumn} title={`${row.warehouseName}: ${money(row.inventoryValueVnd)}`}>
                  <span className={styles.barValueLabel}>{money(row.inventoryValueVnd, true)}</span>
                  <div className={styles.barTrack}><span className={styles.barFill} style={{ height: `${ratio}%` }} /></div>
                  <strong>{row.warehouseCode}</strong>
                </div>
              );
            })}
          </div>
        ) : <div className={styles.chartEmpty}>Chưa có dữ liệu tồn kho được phép hiển thị.</div>}
      </article>
    </>
  );
}
