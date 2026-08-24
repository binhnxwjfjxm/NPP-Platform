import Link from 'next/link';
import { AdminIconTabs } from '../admin-icon-tabs';
import { AdminShell } from '../admin-shell';
import {
  AdminFilterChip,
  AdminKpiCard,
  AdminKpiGrid,
  AdminStatePanel,
  AdminStatusBadge,
  AdminToolbar,
  type AdminStateTone,
} from '../admin-ui-primitives';
import {
  normalizeReportPeriod,
  reportPeriods,
  resolveReportRange,
  type ReportDomain,
  type ReportState,
} from './report-data';
import { loadLotCPresentation } from './report-lot-c-data';
import styles from './report-center.module.css';

const tabs = [
  { key: 'executive', label: 'Điều hành', icon: 'overview' as const },
  { key: 'sales-profit', label: 'Kinh doanh & lợi nhuận', icon: 'tag' as const },
  { key: 'debt', label: 'Công nợ', icon: 'coin' as const },
  { key: 'inventory', label: 'Kho', icon: 'warehouse' as const },
  { key: 'delivery-cod', label: 'Giao vận & COD', icon: 'truck' as const },
  { key: 'mcp', label: 'MCP / thị trường', icon: 'mobile' as const },
  { key: 'people', label: 'Nhân sự / hiệu suất', icon: 'user' as const },
  { key: 'decisions', label: 'Đề xuất & cảnh báo', icon: 'document' as const },
];

const warehouseFilterDomains = new Set<ReportDomain>(['debt', 'inventory', 'delivery-cod']);

function reportHref(tab: ReportDomain, period: string, warehouseId?: string | null): string {
  const params = new URLSearchParams();
  if (tab !== 'executive') params.set('tab', tab);
  if (tab !== 'debt' && period !== 'Tháng này') params.set('period', period);
  if (warehouseId && warehouseFilterDomains.has(tab)) params.set('warehouseId', warehouseId);
  const query = params.toString();
  return query ? `/reports?${query}` : '/reports';
}

function stateTone(state: ReportState): AdminStateTone {
  if (state === 'ready') return 'ok';
  if (state === 'partial') return 'partial';
  if (state === 'forbidden') return 'forbidden';
  if (state === 'error') return 'error';
  return 'empty';
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: { tab?: string; period?: string; warehouseId?: string };
}) {
  const selected = tabs.some((tab) => tab.key === searchParams?.tab)
    ? searchParams?.tab as ReportDomain
    : 'executive';
  const period = normalizeReportPeriod(searchParams?.period);
  const warehouseId = warehouseFilterDomains.has(selected) ? searchParams?.warehouseId ?? null : null;
  const item = await loadLotCPresentation(selected, period, warehouseId);
  const tabItems = tabs.map((tab) => ({
    href: reportHref(tab.key as ReportDomain, period, warehouseId),
    label: tab.label,
    icon: tab.icon,
    active: selected === tab.key,
  }));
  const trendMax = item.trend.reduce((max, point) => Math.max(max, point.value), 0);
  const detailParams = new URLSearchParams();
  if (selected !== 'debt') detailParams.set('period', period);
  if (warehouseId) detailParams.set('warehouseId', warehouseId);
  const detailQuery = detailParams.toString();
  const exportParams = new URLSearchParams({ report: selected });
  if (selected !== 'debt') {
    const range = resolveReportRange(period);
    exportParams.set('from', range.from);
    exportParams.set('to', range.to);
  }
  if (warehouseId) exportParams.set('warehouseId', warehouseId);
  const exportHref = `/reports/export?${exportParams.toString()}`;

  return (
    <AdminShell
      activeSection="reports"
      title="Báo cáo quản trị"
      subtitle="Theo dõi số liệu quản trị từ Công Ty và MCP trong phạm vi quyền hiện tại."
    >
      <AdminIconTabs label="Nhóm báo cáo quản trị" tabs={tabItems} />

      <AdminToolbar
        label="Kỳ và phạm vi báo cáo"
        actions={<a className={styles.toolbarAction} href={exportHref}>Xuất Excel</a>}
      >
        <span className={styles.toolbarLabel}>Kỳ xem</span>
        {selected === 'debt' ? (
          <AdminStatusBadge tone="info">Số dư hiện tại</AdminStatusBadge>
        ) : (
          reportPeriods.map((candidate) => (
            <AdminFilterChip
              key={candidate}
              href={reportHref(selected, candidate, warehouseId)}
              label={candidate}
              active={period === candidate}
            />
          ))
        )}
        {item.warehouseFilter && item.warehouseFilter.options.length > 0 ? (
          <>
            <span className={styles.toolbarLabel}>Kho</span>
            <AdminFilterChip
              href={reportHref(selected, period, null)}
              label="Tất cả kho"
              active={!item.warehouseFilter.selectedId}
            />
            {item.warehouseFilter.options.map((option) => (
              <AdminFilterChip
                key={option.value}
                href={reportHref(selected, period, option.value)}
                label={option.label}
                active={item.warehouseFilter?.selectedId === option.value}
              />
            ))}
          </>
        ) : null}
      </AdminToolbar>

      <AdminStatePanel
        className={styles.reportState}
        title={item.stateLabel}
        message={item.stateMessage}
        tone={stateTone(item.state)}
      />

      <section className={`card ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>{item.domainLabel} · {item.periodLabel}</span>
          <h2>{item.title}</h2>
          <p>{item.summary}</p>
        </div>
        <div className={styles.comparison}>
          <small>{item.primary.label}</small>
          <strong>{item.primary.value}</strong>
          <span className={styles.delta}>{item.stateLabel}</span>
          <small>Phạm vi thời gian</small>
          <b>{item.periodLabel}</b>
        </div>
      </section>

      {item.metrics.length > 0 ? (
        <AdminKpiGrid label="Chỉ số quản trị" className={styles.reportKpis}>
          {item.metrics.map((metric) => (
            <AdminKpiCard key={metric.label} label={metric.label} value={metric.value} note={metric.note} />
          ))}
        </AdminKpiGrid>
      ) : null}

      <section className={`card ${styles.trend}`}>
        <div className={styles.sectionHeading}>
          <div><span>Xu hướng kỳ</span><h3>Diễn biến từ số liệu thật</h3></div>
          {item.trendLabel ? <strong>{item.trendLabel}</strong> : null}
        </div>
        {item.trend.length > 0 ? (
          <>
            <div className={styles.sparkBars} aria-label={item.trendLabel ?? 'Diễn biến kỳ'}>
              {item.trend.map((point) => {
                const height = trendMax > 0 ? Math.max(8, Math.round((point.value / trendMax) * 100)) : 8;
                return <span key={`${point.label}-${point.display}`} style={{ height: `${height}%` }} title={`${point.label}: ${point.display}`} />;
              })}
            </div>
            <p className={styles.detailNote}>{item.trendNote}</p>
          </>
        ) : <p className={styles.detailNote}>{item.trendNote}</p>}
      </section>

      <section className={`card ${styles.highlights}`}>
        <div className={styles.sectionHeading}><div><span>Điểm cần chú ý</span><h3>Trạng thái dữ liệu</h3></div></div>
        {item.highlights.map((highlight, index) => (
          <div className={styles.highlightRow} key={`${index}-${highlight}`}><span>{index + 1}</span><p>{highlight}</p></div>
        ))}
      </section>

      <Link className={`card ${styles.detailLink}`} href={`/reports/${item.id}${detailQuery ? `?${detailQuery}` : ''}`}>
        <span>Xem báo cáo chi tiết</span><strong>→</strong>
      </Link>
    </AdminShell>
  );
}
