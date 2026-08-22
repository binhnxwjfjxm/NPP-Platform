import Link from 'next/link';
import { AdminIconTabs } from '../admin-icon-tabs';
import { AdminShell } from '../admin-shell';
import { loadAlertCenter, type AlertSeverity, type AlertStatus } from './alert-data';

const severityLabels: Record<AlertSeverity, string> = { critical: 'Nghiêm trọng', high: 'Cao', attention: 'Cần chú ý' };
const statusLabels: Record<AlertStatus, string> = { new: 'Mới', seen: 'Đã xem', handling: 'Đang xử lý', resolved: 'Đã giải quyết' };

function dateTime(value: string | null) {
  if (!value) return 'Chưa có thời gian';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string }> }) {
  const { tab, period } = await searchParams;
  const activeTab = tab ?? 'all';
  const data = await loadAlertCenter(period);
  const activeAlerts = data.alerts.filter((item) => item.status !== 'resolved');
  const visible = activeTab === 'mcp' || activeTab === 'all' ? activeAlerts : [];
  const tabs = [
    { href:`/alerts?period=${encodeURIComponent(data.period)}`, label:'Tổng hợp', icon:'exception' as const, active:activeTab==='all', badge:String(activeAlerts.length) },
    { href:`/alerts?tab=sales&period=${encodeURIComponent(data.period)}`, label:'Kinh doanh', icon:'overview' as const, active:activeTab==='sales', badge:'0' },
    { href:`/alerts?tab=debt&period=${encodeURIComponent(data.period)}`, label:'Công nợ', icon:'coin' as const, active:activeTab==='debt', badge:'0' },
    { href:`/alerts?tab=inventory&period=${encodeURIComponent(data.period)}`, label:'Kho', icon:'warehouse' as const, active:activeTab==='inventory', badge:'0' },
    { href:`/alerts?tab=delivery&period=${encodeURIComponent(data.period)}`, label:'Giao vận', icon:'truck' as const, active:activeTab==='delivery', badge:'0' },
    { href:`/alerts?tab=mcp&period=${encodeURIComponent(data.period)}`, label:'MCP', icon:'mobile' as const, active:activeTab==='mcp', badge:String(activeAlerts.length) },
    { href:`/alerts?tab=rules&period=${encodeURIComponent(data.period)}`, label:'Quy tắc', icon:'clipboard' as const, active:activeTab==='rules' },
    { href:`/alerts?tab=history&period=${encodeURIComponent(data.period)}`, label:'Lịch sử', icon:'document' as const, active:activeTab==='history' },
  ];
  const history = data.alerts.flatMap((alert) => alert.history.map((event) => ({ alert, event }))).sort((a,b) => Date.parse(b.event.occurredAt) - Date.parse(a.event.occurredAt));

  return <AdminShell activeSection="alerts" title="Trung tâm cảnh báo" subtitle="Theo dõi tín hiệu bất thường từ dữ liệu quản trị thật.">
    <AdminIconTabs label="Nhóm cảnh báo" tabs={tabs} />
    <div className="alertSummaryStrip"><div><span>Đang hoạt động</span><strong>{activeAlerts.length}</strong></div><div><span>Mức cao</span><strong>{activeAlerts.filter(a=>a.severity==='critical'||a.severity==='high').length}</strong></div><div><span>Quy tắc đang áp dụng</span><strong>{data.rules.length}</strong></div></div>
    {data.message ? <p className="warning compactWarning" role="alert">{data.message}</p> : null}
    {activeTab === 'rules' ? <section className="alertRuleList" aria-label="Quy tắc cảnh báo">{data.rules.map(rule=><article className="card alertRuleCard" key={rule.code}><div><span className={`alertSeverity is-${rule.severity}`}>{severityLabels[rule.severity]}</span></div><h2>{rule.name}</h2><p>{rule.metric} · {rule.threshold}</p><small>Quy tắc được quản lý phía máy chủ; màn hình này chỉ đọc.</small></article>)}</section>
    : activeTab === 'history' ? <section className="alertList" aria-label="Lịch sử cảnh báo">{history.length ? history.map(({alert,event},index)=><Link className="card alertListItem" href={`/alerts/${encodeURIComponent(alert.id)}?period=${encodeURIComponent(data.period)}`} key={`${alert.id}-${event.occurredAt}-${index}`}><div className="alertListTopline"><span className={`alertSeverity is-${alert.severity}`}>{severityLabels[alert.severity]}</span><span className="alertStatus">{statusLabels[event.status]}</span></div><h2>{alert.title}</h2><p className="alertEntity">{alert.entity}</p><div className="alertListFooter"><span>{dateTime(event.occurredAt)}</span><strong>Xem chi tiết →</strong></div></Link>) : <div className="card alertEmpty"><strong>Chưa có lịch sử xử lý</strong><span>Lịch sử sẽ xuất hiện khi cảnh báo được ghi nhận trạng thái.</span></div>}</section>
    : <section className="alertList" aria-label="Danh sách cảnh báo">{visible.length ? visible.map(alert=><Link className="card alertListItem" href={`/alerts/${encodeURIComponent(alert.id)}?period=${encodeURIComponent(data.period)}`} key={alert.id}><div className="alertListTopline"><span className={`alertSeverity is-${alert.severity}`}>{severityLabels[alert.severity]}</span><span className="alertStatus">{statusLabels[alert.status]}</span></div><h2>{alert.title}</h2><p className="alertEntity">{alert.entity} · {alert.employeeName}</p><div className="alertMetricGrid"><span><small>Quy tắc</small><strong>{alert.ruleName}</strong></span><span><small>Ngưỡng</small><strong>{alert.threshold}</strong></span><span><small>Thực tế</small><strong>{alert.actual}</strong></span><span><small>Nguồn</small><strong>{alert.source}</strong></span></div><div className="alertListFooter"><span>{dateTime(alert.detectedAt)}</span><strong>Xem chi tiết →</strong></div></Link>) : <div className="card alertEmpty"><strong>Không có cảnh báo đang mở</strong><span>Không phát hiện tín hiệu MCP cần rà soát trong kỳ đang xem.</span></div>}</section>}
  </AdminShell>;
}
