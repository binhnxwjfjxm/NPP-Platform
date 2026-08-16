import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '../../admin-shell';
import { reportDomainLabel, reportPreviews } from '../report-preview-data';
import styles from '../report-center.module.css';

export default function ReportDetailPage({params}:{params:{reportId:string}}){
 const item=reportPreviews.find(report=>report.id===params.reportId);
 if(!item) notFound();
 return <AdminShell activeSection="reports" title="Chi tiết báo cáo" subtitle="Bối cảnh quản trị của báo cáo đã chọn.">
  <Link className={styles.backLink} href={`/reports?tab=${item.domain}`}>← Quay lại báo cáo</Link>
  <section className={`card ${styles.detailHero}`}><span className={styles.sourceBadge}>{item.source}</span><h2>{item.title}</h2><p>{item.summary}</p></section>
  <section className={`card ${styles.detailSection}`}><h3>Tóm tắt kỳ báo cáo</h3><div className={styles.detailRows}><div><span>Nhóm báo cáo</span><strong>{reportDomainLabel[item.domain]}</strong></div><div><span>Kỳ</span><strong>{item.period}</strong></div><div><span>Kỳ hiện tại</span><strong>{item.current}</strong></div><div><span>Kỳ trước</span><strong>{item.previous}</strong></div><div><span>Biến động</span><strong>{item.delta}</strong></div></div></section>
  <section className={`card ${styles.detailSection}`}><h3>Chỉ số quản trị</h3><div className={styles.detailMetrics}>{item.metrics.map(metric=><div className={styles.detailMetric} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small></div>)}</div></section>
  <section className={`card ${styles.detailSection}`}><h3>Nhận định quản trị</h3><div className={styles.detailHighlights}>{item.highlights.map(highlight=><div key={highlight}>{highlight}</div>)}</div></section>
  <section className={`card ${styles.detailSection}`}><h3>Nguồn dữ liệu</h3><p>Báo cáo này được thiết kế để tổng hợp số liệu quản trị từ <strong>{item.source}</strong>. Nguồn chính thức sẽ được sử dụng khi kết nối số liệu thực tế.</p></section>
  <div className={styles.detailNote}>Dữ liệu đang hiển thị là dữ liệu minh họa và không dùng để ra quyết định thực tế.</div>
 </AdminShell>;
}
