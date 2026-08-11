import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '../../admin-shell';
import { adminAlerts, alertSeverityLabels } from '../alert-preview-data';

export default async function AlertDetailPage({ params }: { params: Promise<{ alertId: string }> }) {
  const { alertId } = await params;
  const alert = adminAlerts.find((item) => item.id === alertId);
  if (!alert) notFound();
  return <AdminShell activeSection="alerts" title="Chi tiết cảnh báo" subtitle="Thông tin rule, ngưỡng và tín hiệu thực tế.">
    <Link className="approvalBackLink" href="/alerts">← Trung tâm cảnh báo</Link>
    <p className="adminPreviewNotice">Bản xem trước frontend. Không có thao tác ghi nhận hoặc thay đổi rule nào được gửi tới backend.</p>
    <section className="card alertDetailHero"><div className="alertListTopline"><span className={`alertSeverity is-${alert.severity}`}>{alertSeverityLabels[alert.severity]}</span><span className="alertStatus">Đang hoạt động</span></div><span className="approvalDetailDomain">{alert.source} · {alert.ruleCode}</span><h2>{alert.title}</h2><p>{alert.entity}</p></section>
    <section className="card alertDetailSection"><h3>Tín hiệu cảnh báo</h3><div className="alertComparison"><div><small>Ngưỡng rule</small><strong>{alert.threshold}</strong></div><span>→</span><div><small>Giá trị thực tế</small><strong>{alert.actual}</strong></div></div></section>
    <section className="card alertDetailSection"><h3>Quy tắc liên quan</h3><dl className="approvalDefinitionList"><div><dt>Mã rule</dt><dd>{alert.ruleCode}</dd></div><div><dt>Tên rule</dt><dd>{alert.ruleName}</dd></div><div><dt>Phát hiện lúc</dt><dd>{alert.detectedAt}</dd></div><div><dt>Nguồn dữ liệu</dt><dd>{alert.source}</dd></div></dl></section>
    <section className="card alertDetailSection"><h3>Nhận định</h3><p>{alert.summary}</p></section>
    <section className="card alertDetailSection"><h3>Hướng rà soát</h3><p>{alert.recommendation}</p></section>
    <section className="card alertDetailSection"><h3>Lịch sử tín hiệu</h3><div className="approvalTimeline">{alert.timeline.map((event,index)=><div key={`${event.time}-${index}`}><span>{event.time}</span><strong>{event.title}</strong><small>{event.note}</small></div>)}</div></section>
  </AdminShell>;
}
