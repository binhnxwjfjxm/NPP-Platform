import Link from 'next/link';
import { AdminIconTabs } from '../admin-icon-tabs';
import { AdminShell } from '../admin-shell';
import { adminAlerts, alertRulesPreview, alertSeverityLabels, type AlertDomain } from './alert-preview-data';

const domains = new Set<AlertDomain>(['sales','debt','inventory','delivery','mcp']);

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const activeTab = tab ?? 'all';
  const activeAlerts = adminAlerts.filter((item) => item.status === 'active');
  const filtered = domains.has(activeTab as AlertDomain) ? activeAlerts.filter((item) => item.domain === activeTab) : activeAlerts;
  const tabs = [
    { href:'/alerts', label:'Tổng hợp', icon:'exception' as const, active:activeTab==='all', badge:String(activeAlerts.length) },
    { href:'/alerts?tab=sales', label:'Kinh doanh', icon:'overview' as const, active:activeTab==='sales', badge:String(activeAlerts.filter(a=>a.domain==='sales').length) },
    { href:'/alerts?tab=debt', label:'Công nợ', icon:'coin' as const, active:activeTab==='debt', badge:String(activeAlerts.filter(a=>a.domain==='debt').length) },
    { href:'/alerts?tab=inventory', label:'Kho', icon:'warehouse' as const, active:activeTab==='inventory', badge:String(activeAlerts.filter(a=>a.domain==='inventory').length) },
    { href:'/alerts?tab=delivery', label:'Giao vận', icon:'truck' as const, active:activeTab==='delivery', badge:String(activeAlerts.filter(a=>a.domain==='delivery').length) },
    { href:'/alerts?tab=mcp', label:'MCP', icon:'mobile' as const, active:activeTab==='mcp', badge:String(activeAlerts.filter(a=>a.domain==='mcp').length) },
    { href:'/alerts?tab=rules', label:'Quy tắc', icon:'clipboard' as const, active:activeTab==='rules' },
    { href:'/alerts?tab=history', label:'Lịch sử', icon:'document' as const, active:activeTab==='history' },
  ];

  return <AdminShell activeSection="alerts" title="Trung tâm cảnh báo" subtitle="Theo dõi tín hiệu bất thường theo quy tắc quản trị.">
    <AdminIconTabs label="Nhóm cảnh báo" tabs={tabs} />
    <div className="alertSummaryStrip"><div><span>Đang hoạt động</span><strong>{activeAlerts.length}</strong></div><div><span>Nghiêm trọng / Cao</span><strong>{activeAlerts.filter(a=>a.severity==='critical'||a.severity==='high').length}</strong></div><div><span>Quy tắc đang hiển thị</span><strong>{alertRulesPreview.length}</strong></div></div>
    <p className="adminPreviewNotice">Dữ liệu minh họa để hoàn thiện trải nghiệm quản trị; chưa phải cảnh báo điều hành thực tế.</p>
    {activeTab === 'rules' ? <section className="alertRuleList" aria-label="Quy tắc cảnh báo minh họa">{alertRulesPreview.map(rule=><article className="card alertRuleCard" key={rule.code}><div><span className="alertRuleCode">{rule.code}</span><span className="alertSeverity is-attention">{rule.severity}</span></div><h2>{rule.name}</h2><p>{rule.domain} · {rule.condition}</p><small>Chỉ xem trước — chưa thể chỉnh sửa quy tắc.</small></article>)}</section> : activeTab === 'history' ? <section className="card alertEmpty"><strong>Lịch sử cảnh báo</strong><span>Lịch sử sẽ hiển thị khi có dữ liệu cảnh báo thực tế được ghi nhận.</span></section> : <section className="alertList" aria-label="Danh sách cảnh báo">{filtered.map(alert=><Link className="card alertListItem" href={`/alerts/${alert.id}`} key={alert.id}><div className="alertListTopline"><span className={`alertSeverity is-${alert.severity}`}>{alertSeverityLabels[alert.severity]}</span><span className="alertStatus">Đang hoạt động</span></div><h2>{alert.title}</h2><p className="alertEntity">{alert.entity}</p><div className="alertMetricGrid"><span><small>Quy tắc</small><strong>{alert.ruleCode}</strong></span><span><small>Ngưỡng</small><strong>{alert.threshold}</strong></span><span><small>Thực tế</small><strong>{alert.actual}</strong></span><span><small>Nguồn</small><strong>{alert.source}</strong></span></div><div className="alertListFooter"><span>{alert.detectedAt}</span><strong>Xem chi tiết →</strong></div></Link>)}</section>}
  </AdminShell>;
}
