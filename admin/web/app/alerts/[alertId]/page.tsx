import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createIdempotencyKey } from '@npp/contracts';
import { AdminShell } from '../../admin-shell';
import { AdminActionBar, AdminStatePanel, AdminStatusBadge, type AdminStatusTone } from '../../admin-ui-primitives';
import { safeAdminReturnTo } from '../../../lib/admin-session';
import { changeAlertStatus } from '../actions';
import { loadAlertById, type AlertSeverity, type AlertStatus } from '../alert-data';
import styles from './alert-detail.module.css';

const severityLabels: Record<AlertSeverity, string> = { critical: 'Nghiêm trọng', high: 'Cao', attention: 'Cần chú ý' };
const statusLabels: Record<AlertStatus, string> = { new: 'Mới', seen: 'Đã xem', handling: 'Đang xử lý', resolved: 'Đã giải quyết' };
const nextStatus: Partial<Record<AlertStatus, { value: 'seen' | 'handling' | 'resolved'; label: string }>> = { new: { value: 'seen', label: 'Đánh dấu đã xem' }, seen: { value: 'handling', label: 'Bắt đầu xử lý' }, handling: { value: 'resolved', label: 'Đánh dấu đã giải quyết' } };
function dateTime(value: string | null) { if (!value) return 'Chưa có thời gian'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date); }
function severityTone(severity: AlertSeverity): AdminStatusTone { if (severity === 'critical') return 'danger'; if (severity === 'high') return 'attention'; return 'info'; }
function statusTone(status: AlertStatus): AdminStatusTone { if (status === 'resolved') return 'success'; if (status === 'new') return 'danger'; if (status === 'handling') return 'attention'; return 'info'; }
function backDestination(period: string, returnTo?: string) {
  const safeReturnTo = safeAdminReturnTo(returnTo);
  if (returnTo && (safeReturnTo === '/' || safeReturnTo.startsWith('/?period='))) return { href: safeReturnTo, label: '← Quay lại Tổng quan' };
  if (returnTo && safeReturnTo.startsWith('/reports/')) return { href: safeReturnTo, label: '← Quay lại báo cáo' };
  return { href: `/alerts?period=${encodeURIComponent(period)}`, label: '← Trung tâm cảnh báo' };
}
export default async function AlertDetailPage({ params, searchParams }: { params: Promise<{ alertId: string }>; searchParams: Promise<{ period?: string; returnTo?: string }> }) {
  const [{ alertId }, { period, returnTo }] = await Promise.all([params, searchParams]); const { data, alert } = await loadAlertById(alertId, period); const back = backDestination(data.period, returnTo);
  if (!alert && data.message) return <AdminShell activeSection="alerts" title="Chi tiết cảnh báo" subtitle="Tín hiệu, bằng chứng và lịch sử xử lý từ dữ liệu thật." contentWidth="special"><Link className="approvalBackLink" href={back.href}>{back.label}</Link><AdminStatePanel title={data.message} message="Không thể xác định cảnh báo này cho đến khi nguồn dữ liệu sẵn sàng." tone={data.message.includes('không có quyền') ? 'forbidden' : 'error'} icon="info" /></AdminShell>;
  if (!alert) notFound(); const action = nextStatus[alert.status]; const idempotencyKey = action ? createIdempotencyKey('admin-alert-status') : null;
  return <AdminShell activeSection="alerts" title="Chi tiết cảnh báo" subtitle="Tín hiệu, bằng chứng và lịch sử xử lý từ dữ liệu thật." contentWidth="special">
    <Link className="approvalBackLink" href={back.href}>{back.label}</Link>
    <section className="card alertDetailHero"><div className="alertListTopline"><AdminStatusBadge tone={severityTone(alert.severity)}>{severityLabels[alert.severity]}</AdminStatusBadge><AdminStatusBadge tone={statusTone(alert.status)}>{statusLabels[alert.status]}</AdminStatusBadge></div><span className="approvalDetailDomain">{alert.domainLabel} · {alert.source}</span><h2>{alert.title}</h2><p>{alert.entity}{alert.context ? ` · ${alert.context}` : ''}</p></section>
    <section className="card alertDetailSection"><h3>Tín hiệu cảnh báo</h3><div className="alertComparison"><div><small>Điều kiện cần kiểm tra</small><strong>{alert.threshold}</strong></div><span>→</span><div><small>Dữ liệu ghi nhận</small><strong>{alert.actual}</strong></div></div></section>
    <section className="card alertDetailSection"><h3>Bằng chứng hiện có</h3><div className="approvalEvidenceList">{alert.evidence.length ? alert.evidence.map((entry)=><div key={entry}>{entry}</div>) : <div>Chưa có bằng chứng bổ sung.</div>}</div></section>
    <section className="card alertDetailSection"><h3>Nhận định</h3><p>{alert.summary}</p></section>
    <section className="card alertDetailSection"><h3>Hướng rà soát</h3><p>{alert.recommendation}</p></section>
    <section className="card alertDetailSection"><h3>Lịch sử xử lý</h3><div className="approvalTimeline">{alert.history.length ? alert.history.map((event,index)=><div key={`${event.occurredAt}-${index}`}><span>{dateTime(event.occurredAt)}</span><strong>{statusLabels[event.status]}</strong><small>Người thao tác: {event.actorLabel}</small></div>) : <div><span>{dateTime(alert.detectedAt)}</span><strong>Mới</strong><small>Tín hiệu được phát hiện từ dữ liệu {alert.source} hiện tại.</small></div>}</div></section>
    {action && idempotencyKey ? <AdminActionBar label="Cập nhật trạng thái cảnh báo" note="Mỗi bước được lưu vào lịch sử quản trị và không sửa dữ liệu tác nghiệp nguồn."><form action={changeAlertStatus} className={styles.lifecycleForm}><input type="hidden" name="alertId" value={alert.id}/><input type="hidden" name="status" value={action.value}/><input type="hidden" name="period" value={data.period}/><input type="hidden" name="from" value={data.from}/><input type="hidden" name="to" value={data.to}/><input type="hidden" name="idempotencyKey" value={idempotencyKey}/><button className={styles.lifecycleButton} type="submit">{action.label}</button></form></AdminActionBar> : null}
  </AdminShell>;
}
