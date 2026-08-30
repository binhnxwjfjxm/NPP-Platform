import Link from 'next/link';
import { AdminShell } from '../../admin-shell';
import { AdminKpiCard, AdminKpiGrid, AdminStatePanel, AdminStatusBadge } from '../../admin-ui-primitives';
import { normalizeReportPeriod } from '../report-data';
import { loadLotCPresentation } from '../report-lot-c-data';
import { loadSalesBusinessDetail } from '../report-sales-data';
import styles from '../report-center.module.css';

export default async function SalesReportDetailPage({ searchParams }: { searchParams?: { period?: string } }) {
  const period = normalizeReportPeriod(searchParams?.period);
  const [item, detail] = await Promise.all([loadLotCPresentation('sales', period, null), loadSalesBusinessDetail(period)]);
  const back = `/reports?${new URLSearchParams({ tab: 'sales', period }).toString()}`;
  return <AdminShell activeSection="reports" title="Chi tiết Kinh doanh" subtitle="Phân tích doanh thu và sản lượng theo các chiều nghiệp vụ." contentWidth="special">
    <Link className={styles.backLink} href={back}>← Quay lại Kinh doanh</Link>
    <section className={`card ${styles.detailHero}`}><AdminStatusBadge tone="info">{item.source}</AdminStatusBadge><h2>{item.title}</h2><p>{item.summary}</p></section>
    <AdminStatePanel className={styles.detailState} title={item.stateLabel} message={item.stateMessage} tone={item.state === 'ready' ? 'ok' : item.state === 'partial' ? 'partial' : item.state === 'forbidden' ? 'forbidden' : item.state === 'error' ? 'error' : 'empty'} />
    {item.metrics.length ? <AdminKpiGrid label="Chỉ số Kinh doanh" className={styles.detailKpis}>{item.metrics.map((metric) => <AdminKpiCard key={metric.label} label={metric.label} value={metric.value} note={metric.note} />)}</AdminKpiGrid> : null}
    {detail.message ? <AdminStatePanel title="Trạng thái chi tiết" message={detail.message} tone="partial" /> : null}
    {detail.sections.map((section) => <section className={`card ${styles.detailSection}`} key={section.key}><h3>{section.title}</h3>{section.rows.length ? <div className={styles.drilldownTree}>{section.rows.map((row) => <details className={styles.drilldownNode} key={row.id}><summary><span>{row.label}</span><small>{row.summary}</small></summary><div className={styles.drilldownBody}><div className={styles.detailRows}>{row.facts.map((fact) => <div key={`${row.id}-${fact.label}`}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}</div></div></details>)}</div> : <p>Không phát sinh dữ liệu trong chiều phân tích này.</p>}</section>)}
    <section className={`card ${styles.detailSection}`}><h3>Điểm cần chú ý</h3><div className={styles.detailHighlights}>{item.highlights.map((highlight, index) => <div key={`${index}-${highlight}`}>{highlight}</div>)}</div></section>
  </AdminShell>;
}
