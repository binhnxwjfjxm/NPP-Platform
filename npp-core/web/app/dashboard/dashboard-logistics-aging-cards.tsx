import Link from 'next/link';
import type { AgingBucketRow } from '../../lib/finance-reporting-types';
import type { DashboardReports } from './dashboard-report-types';
import { count, money, numeric, percent, sumDecimals } from './dashboard-report-format';
import styles from './dashboard.module.css';

function agingLabel(bucket: string) {
  return ({
    AGE_0_30: '0–30 ngày',
    AGE_31_60: '31–60 ngày',
    AGE_61_90: '61–90 ngày',
    AGE_91_PLUS: 'Trên 90 ngày',
  } as Record<string, string>)[bucket] ?? bucket;
}

export function DashboardLogisticsAgingCards({ reports }: { reports: DashboardReports }) {
  const onTimeRaw = reports.logistics?.summary.onTimeFullRatePercent;
  const onTime = onTimeRaw ? Math.min(100, Math.max(0, numeric(onTimeRaw))) : null;
  const donut = onTime === null
    ? 'var(--dashboard-chart-neutral)'
    : `conic-gradient(var(--dashboard-positive) 0 ${onTime}%, var(--dashboard-warning) ${onTime}% 100%)`;

  const receivableRows = reports.aging?.receivable.summary.filter((row) => row.currencyCode === 'VND') ?? [];
  const receivableTotal = sumDecimals(receivableRows.map((row) => row.remainingAmount));
  const receivableNumeric = Math.max(0, numeric(receivableTotal));

  return (
    <>
      <article className={styles.analyticsCard}>
        <div className={styles.cardHeading}>
          <div><small>Giao hàng</small><h3>Giao đủ đúng hạn</h3></div>
          <Link href="/logistics/reporting">Chi tiết</Link>
        </div>
        <div className={styles.donutLayout}>
          <div className={styles.donut} style={{ background: donut }} aria-label={`Tỷ lệ giao đủ đúng hạn ${percent(onTimeRaw)}`}>
            <div><strong>{percent(onTimeRaw)}</strong><span>đúng hạn</span></div>
          </div>
          <div className={styles.donutLegend}>
            <p><span className={styles.legendPositive} />Đúng hạn <strong>{count(reports.logistics?.summary.onTimeFullCount)}</strong></p>
            <p><span className={styles.legendWarning} />Trễ <strong>{count(reports.logistics?.summary.lateFullCount)}</strong></p>
            <p><span className={styles.legendNeutral} />Thiếu SLA <strong>{count(reports.logistics?.summary.fullWithoutPlanCount)}</strong></p>
          </div>
        </div>
        <div className={styles.cardFootMetric}>
          <span>Phiếu giao đủ</span><strong>{count(reports.logistics?.summary.deliveredFullCount)}</strong>
        </div>
      </article>

      <article className={styles.analyticsCard}>
        <div className={styles.cardHeading}>
          <div><small>Công nợ</small><h3>Tuổi khoản phải thu</h3></div>
          <Link href="/accounting/aging">Chi tiết</Link>
        </div>
        <div className={styles.chartMeta}>
          <strong>{reports.aging ? money(receivableTotal) : '—'}</strong>
          <span>Số dư VND hiện còn phải thu</span>
        </div>
        <div className={styles.agingList}>
          {receivableRows.map((row: AgingBucketRow) => {
            const ratio = receivableNumeric > 0
              ? Math.min(100, Math.max(0, (numeric(row.remainingAmount) / receivableNumeric) * 100))
              : 0;
            return (
              <div key={row.ageBucket} className={styles.agingRow}>
                <div><span>{agingLabel(row.ageBucket)}</span><strong>{money(row.remainingAmount, true)}</strong></div>
                <div className={styles.agingTrack}><span style={{ width: `${ratio}%` }} /></div>
                <small>{count(row.documentCount)} chứng từ · {ratio.toFixed(1).replace('.', ',')}%</small>
              </div>
            );
          })}
          {!receivableRows.length ? <div className={styles.chartEmpty}>Không có dữ liệu khoản phải thu VND được phép hiển thị.</div> : null}
        </div>
      </article>
    </>
  );
}
