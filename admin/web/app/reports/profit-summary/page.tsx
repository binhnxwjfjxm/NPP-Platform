import Link from 'next/link';
import { AdminShell } from '../../admin-shell';
import { AdminKpiCard, AdminKpiGrid, AdminStatePanel, AdminStatusBadge } from '../../admin-ui-primitives';
import { normalizeReportPeriod } from '../report-data';
import { loadLotCPresentation } from '../report-lot-c-data';
import styles from '../report-center.module.css';

export default async function ProfitReportDetailPage({ searchParams }: { searchParams?: { period?: string } }) {
  const period = normalizeReportPeriod(searchParams?.period);
  const item = await loadLotCPresentation('profit', period, null);
  const back = `/reports?${new URLSearchParams({ tab: 'profit', period }).toString()}`;
  return <AdminShell activeSection="reports" title="Chi tiết Lợi nhuận" subtitle="Lãi gộp chỉ trên phần doanh thu đã đối chiếu được giá vốn." contentWidth="special">
    <Link className={styles.backLink} href={back}>← Quay lại Lợi nhuận</Link>
    <section className={`card ${styles.detailHero}`}><AdminStatusBadge tone="info">{item.source}</AdminStatusBadge><h2>{item.title}</h2><p>{item.summary}</p></section>
    <AdminStatePanel className={styles.detailState} title={item.stateLabel} message={item.stateMessage} tone={item.state === 'ready' ? 'ok' : item.state === 'partial' ? 'partial' : item.state === 'forbidden' ? 'forbidden' : item.state === 'error' ? 'error' : 'empty'} />
    {item.metrics.length ? <AdminKpiGrid label="Chỉ số Lợi nhuận" className={styles.detailKpis}>{item.metrics.map((metric) => <AdminKpiCard key={metric.label} label={metric.label} value={metric.value} note={metric.note} />)}</AdminKpiGrid> : null}
    <section className={`card ${styles.detailSection}`}><h3>Nguyên tắc đối soát</h3><p>Chỉ doanh thu có liên kết xuất kho và giá vốn hợp lệ mới được tính lãi gộp. Dòng chưa đủ điều kiện được giữ ở trạng thái cần đối soát, không thay bằng số 0 và không trộn ngoại tệ vào VND.</p></section>
    <section className={`card ${styles.detailSection}`}><h3>Điểm cần chú ý</h3><div className={styles.detailHighlights}>{item.highlights.map((highlight, index) => <div key={`${index}-${highlight}`}>{highlight}</div>)}</div></section>
  </AdminShell>;
}
