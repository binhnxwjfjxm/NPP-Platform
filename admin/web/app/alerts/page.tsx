import Link from 'next/link';
import { AdminIconTabs } from '../admin-icon-tabs';
import { AdminShell } from '../admin-shell';
import { loadAlertCenter, type AlertDomain, type AlertSeverity, type AlertStatus } from './alert-data';

const severityLabels: Record<AlertSeverity, string> = { critical: 'Nghiêm trọng', high: 'Cao', attention: 'Cần chú ý' };
const statusLabels: Record<AlertStatus, string> = { new: 'Mới', seen: 'Đã xem', handling: 'Đang xử lý', resolved: 'Đã giải quyết' };
const validTabs = new Set(['all', 'sales', 'debt', 'inventory', 'delivery', 'mcp', 'rules', 'history']);
const domainTabs = new Set<AlertDomain>(['sales', 'debt', 'inventory', 'delivery', 'mcp']);

function dateTime(value: string | null) {
  if (!value) return 'Chưa có thời gian';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string }> }) {
  const { tab, period } = await searchParams;
  const activeTab = tab && validTabs.has(tab) ? tab : 'all';
  const data = await loadAlertCenter(period);
  const sourceReady = !data.message;
  const activeAlerts = sourceReady ? data.alerts.filter((item) => item.status !== 'resolved') : null;
  const selectedDomain = domainTabs.has(activeTab as AlertDomain) ? activeTab as AlertDomain : null;
  const selectedAccess = selectedDomain ? data.domainAccess[selectedDomain] : null;
  const visible = activeAlerts
    ? selectedDomain ? activeAlerts.filter((item) => item.domain === selectedDomain) : activeTab === 'all' ? activeAlerts : []
    : [];
  const openCount = activeAlerts ? String(activeAlerts.length) : undefined;
  const domainBadge = (domain: AlertDomain) => activeAlerts ? String(activeAlerts.filter((item) => item.domain === domain).length) : undefined;
  const tabs = [
    { href:`/alerts?period=${encodeURIComponent(data.period)}`, label:'Tổng hợp', icon:'exception' as const, active:activeTab==='all', badge:openCount },
    { href:`/alerts?tab=sales&period=${encodeURIComponent(data.period)}`, label:'Kinh doanh', icon:'overview' as const, active:activeTab==='sales', badge:domainBadge('sales') },
    { href:`/alerts?tab=debt&period=${encodeURIComponent(data.period)}`, label:'Công nợ', icon:'coin' as const, active:activeTab==='debt', badge:domainBadge('debt') },
    { href:`/alerts?tab=inventory&period=${encodeURIComponent(data.period)}`, label:'Kho', icon:'warehouse' as const, active:activeTab==='inventory', badge:domainBadge('inventory') },
    { href:`/alerts?tab=delivery&period=${encodeURIComponent(data.period)}`, label:'Giao vận', icon:'truck' as const, active:activeTab==='delivery', badge:domainBadge('delivery') },
    { href:`/alerts?tab=mcp&period=${encodeURIComponent(data.period)}`, label:'MCP', icon:'mobile' as const, active:activeTab==='mcp', badge:domainBadge('mcp') },
    { href:`/alerts?tab=rules&period=${encodeURIComponent(data.period)}`, label:'Quy tắc', icon:'clipboard' as const, active:activeTab==='rules' },
    { href:`/alerts?tab=history&period=${encodeURIComponent(data.period)}`, label:'Lịch sử', icon:'document' as const, active:activeTab==='history' },
  ];
  const history = sourceReady
    ? data.alerts.flatMap((alert) => alert.history.map((event) => ({ alert, event }))).sort((a,b) => Date.parse(b.event.occurredAt) - Date.parse(a.event.occurredAt))
    : [];
  const highCount = activeAlerts ? activeAlerts.filter((alert) => alert.severity === 'critical' || alert.severity === 'high').length : null;

  return <AdminShell activeSection="alerts" title="Trung tâm cảnh báo" subtitle="Theo dõi tín hiệu bất thường từ dữ liệu quản trị thật.">
    <AdminIconTabs label="Nhóm cảnh báo" tabs={tabs} />
    <div className="alertSummaryStrip" aria-label="Tóm tắt cảnh báo"><div><span>Đang hoạt động</span><strong>{activeAlerts ? activeAlerts.length : '—'}</strong></div><div><span>Mức cao</span><strong>{highCount ?? '—'}</strong></div><div><span>Quy tắc đang áp dụng</span><strong>{sourceReady ? data.rules.length : '—'}</strong></div></div>
    {data.message ? <p className="warning compactWarning" role="alert">{data.message}</p> : null}
    {!sourceReady ? <div className="card alertEmpty" role="alert"><strong>Chưa thể hiển thị cảnh báo.</strong><span>Dữ liệu hiện không sẵn sàng hoặc tài khoản chưa có quyền xem.</span></div>
    : selectedDomain && selectedAccess && !selectedAccess.available ? <div className="card alertEmpty" role="status"><strong>Chưa thể mở nhóm cảnh báo này.</strong><span>{selectedAccess.message ?? 'Nguồn dữ liệu hiện chưa sẵn sàng.'}</span></div>
    : activeTab === 'rules' ? <section className="alertRuleList" aria-label="Quy tắc cảnh báo">{data.rules.length ? data.rules.map(rule=><article className="card alertRuleCard" key={rule.code}><div><span className={`alertSeverity is-${rule.severity}`}>{severityLabels[rule.severity]}</span><span className="alertStatus">{rule.domainLabel}</span></div><h2>{rule.name}</h2><p>{rule.metric} · {rule.threshold}</p><small>Quy tắc dùng dữ liệu chính thức; màn hình này chỉ hiển thị.</small></article>) : <div className="card alertEmpty"><strong>Chưa có quy tắc cảnh báo.</strong><span>Quy tắc chỉ xuất hiện khi nguồn chính thức đã được mở.</span></div>}</section>
    : activeTab === 'history' ? <section className="alertList" aria-label="Lịch sử cảnh báo">{history.length ? history.map(({alert,event},index)=><Link className="card alertListItem" href={`/alerts/${encodeURIComponent(alert.id)}?period=${encodeURIComponent(data.period)}`} key={`${alert.id}-${event.occurredAt}-${index}`}><div className="alertListTopline"><span className={`alertSeverity is-${alert.severity}`}>{severityLabels[alert.severity]}</span><span className="alertStatus">{statusLabels[event.status]}</span></div><h2>{alert.title}</h2><p className="alertEntity">{alert.domainLabel} · {alert.entity}</p><div className="alertListFooter"><span>{dateTime(event.occurredAt)} · {event.actorLabel}</span><strong>Xem chi tiết →</strong></div></Link>) : <div className="card alertEmpty"><strong>Chưa có lịch sử xử lý</strong><span>Lịch sử sẽ xuất hiện khi cảnh báo được cập nhật trạng thái.</span></div>}</section>
    : <section className="alertList" aria-label="Danh sách cảnh báo">{visible.length ? visible.map(alert=><Link className="card alertListItem" href={`/alerts/${encodeURIComponent(alert.id)}?period=${encodeURIComponent(data.period)}`} key={alert.id}><div className="alertListTopline"><span className={`alertSeverity is-${alert.severity}`}>{severityLabels[alert.severity]}</span><span className="alertStatus">{statusLabels[alert.status]}</span></div><h2>{alert.title}</h2><p className="alertEntity">{alert.domainLabel} · {alert.entity}{alert.context ? ` · ${alert.context}` : ''}</p><div className="alertMetricGrid"><span><small>Quy tắc</small><strong>{alert.ruleName}</strong></span><span><small>Điều kiện</small><strong>{alert.threshold}</strong></span><span><small>Dữ liệu ghi nhận</small><strong>{alert.actual}</strong></span><span><small>Nguồn</small><strong>{alert.source}</strong></span></div><div className="alertListFooter"><span>{dateTime(alert.detectedAt)}</span><strong>Xem chi tiết →</strong></div></Link>) : <div className="card alertEmpty"><strong>Không có cảnh báo đang mở</strong><span>Không phát hiện tín hiệu cần rà soát trong nhóm đang xem.</span></div>}</section>}
  </AdminShell>;
}
