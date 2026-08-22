import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createIdempotencyKey } from '@npp/contracts';
import { AdminShell } from '../../admin-shell';
import { changeAlertStatus } from '../actions';
import { loadAlertById, type AlertSeverity, type AlertStatus } from '../alert-data';

const severityLabels: Record<AlertSeverity, string> = { critical: 'Nghiêm trọng', high: 'Cao', attention: 'Cần chú ý' };
const statusLabels: Record<AlertStatus, string> = { new: 'Mới', seen: 'Đã xem', handling: 'Đang xử lý', resolved: 'Đã giải quyết' };
const nextStatus: Partial<Record<AlertStatus, { value: 'seen' | 'handling' | 'resolved'; label: string }>> = {
  new: { value: 'seen', label: 'Đánh dấu đã xem' },
  seen: { value: 'handling', label: 'Bắt đầu xử lý' },
  handling: { value: 'resolved', label: 'Đánh dấu đã giải quyết' },
};

function dateTime(value: string | null) {
  if (!value) return 'Chưa có thời gian';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

export default async function AlertDetailPage({ params, searchParams }: { params: Promise<{ alertId: string }>; searchParams: Promise<{ period?: string }> }) {
  const [{ alertId }, { period }] = await Promise.all([params, searchParams]);
  const { data, alert } = await loadAlertById(alertId, period);
  if (!alert) notFound();
  const action = nextStatus[alert.status];
  const idempotencyKey = action ? createIdempotencyKey('admin-alert-status') : null;
  return <AdminShell activeSection="alerts" title="Chi tiết cảnh báo" subtitle="Tín hiệu, bằng chứng và lịch sử xử lý từ dữ liệu thật.">
    <Link className="approvalBackLink" href={`/alerts?period=${encodeURIComponent(data.period)}`}>← Trung tâm cảnh báo</Link>
    <section className="card alertDetailHero"><div className="alertListTopline"><span className={`alertSeverity is-${alert.severity}`}>{severityLabels[alert.severity]}</span><span className="alertStatus">{statusLabels[alert.status]}</span></div><span className="approvalDetailDomain">{alert.source} · {alert.routeName}</span><h2>{alert.title}</h2><p>{alert.entity} · {alert.employeeName}</p></section>
    <section className="card alertDetailSection"><h3>Tín hiệu cảnh báo</h3><div className="alertComparison"><div><small>Điều kiện cần kiểm tra</small><strong>{alert.threshold}</strong></div><span>→</span><div><small>Dữ liệu ghi nhận</small><strong>{alert.actual}</strong></div></div></section>
    <section className="card alertDetailSection"><h3>Bằng chứng hiện có</h3><div className="approvalEvidenceList">{alert.evidence.length ? alert.evidence.map((entry)=><div key={entry}>{entry}</div>) : <div>Chưa có bằng chứng bổ sung.</div>}</div></section>
    <section className="card alertDetailSection"><h3>Nhận định</h3><p>{alert.summary}</p></section>
    <section className="card alertDetailSection"><h3>Hướng rà soát</h3><p>{alert.recommendation}</p></section>
    <section className="card alertDetailSection"><h3>Lịch sử xử lý</h3><div className="approvalTimeline">{alert.history.length ? alert.history.map((event,index)=><div key={`${event.occurredAt}-${index}`}><span>{dateTime(event.occurredAt)}</span><strong>{statusLabels[event.status]}</strong><small>Được ghi nhận trong lịch sử quản trị</small></div>) : <div><span>{dateTime(alert.detectedAt)}</span><strong>Mới</strong><small>Tín hiệu được phát hiện từ dữ liệu MCP hiện tại.</small></div>}</div></section>
    {action && idempotencyKey ? <section className="approvalDecisionBar" aria-label="Cập nhật trạng thái cảnh báo"><form action={changeAlertStatus}><input type="hidden" name="alertId" value={alert.id}/><input type="hidden" name="status" value={action.value}/><input type="hidden" name="period" value={data.period}/><input type="hidden" name="from" value={data.from}/><input type="hidden" name="to" value={data.to}/><input type="hidden" name="idempotencyKey" value={idempotencyKey}/><button type="submit">{action.label}</button></form><small>Mỗi bước được lưu vào lịch sử quản trị và không sửa dữ liệu tác nghiệp MCP.</small></section> : null}
  </AdminShell>;
}
