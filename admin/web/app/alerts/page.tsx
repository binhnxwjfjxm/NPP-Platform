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
  type AdminStatusTone,
} from '../admin-ui-primitives';
import { reportPeriods } from '../reports/report-data';
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

function alertHref(tab: string, period: string): string {
  const params = new URLSearchParams();
  if (tab !== 'all') params.set('tab', tab);
  if (period !== 'Tháng này') params.set('period', period);
  const query = params.toString();
  return query ? `/alerts?${query}` : '/alerts';
}

function severityTone(severity: AlertSeverity): AdminStatusTone {
  if (severity === 'critical') return 'danger';
  if (severity === 'high') return 'attention';
  return 'info';
}

function statusTone(status: AlertStatus): AdminStatusTone {
  if (status === 'resolved') return 'success';
  if (status === 'new') return 'danger';
  if (status === 'handling') return 'attention';
  return 'info';
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
    { href: alertHref('all', data.period), label: 'Tổng hợp', icon: 'exception' as const, active: activeTab === 'all', badge: openCount },
    { href: alertHref('sales', data.period), label: 'Kinh doanh', icon: 'overview' as const, active: activeTab === 'sales', badge: domainBadge('sales') },
    { href: alertHref('debt', data.period), label: 'Công nợ', icon: 'coin' as const, active: activeTab === 'debt', badge: domainBadge('debt') },
    { href: alertHref('inventory', data.period), label: 'Kho', icon: 'warehouse' as const, active: activeTab === 'inventory', badge: domainBadge('inventory') },
    { href: alertHref('delivery', data.period), label: 'Giao vận', icon: 'truck' as const, active: activeTab === 'delivery', badge: domainBadge('delivery') },
    { href: alertHref('mcp', data.period), label: 'MCP', icon: 'mobile' as const, active: activeTab === 'mcp', badge: domainBadge('mcp') },
    { href: alertHref('rules', data.period), label: 'Quy tắc', icon: 'clipboard' as const, active: activeTab === 'rules' },
    { href: alertHref('history', data.period), label: 'Lịch sử', icon: 'document' as const, active: activeTab === 'history' },
  ];
  const history = sourceReady
    ? data.alerts.flatMap((alert) => alert.history.map((event) => ({ alert, event }))).sort((a, b) => Date.parse(b.event.occurredAt) - Date.parse(a.event.occurredAt))
    : [];
  const highCount = activeAlerts ? activeAlerts.filter((alert) => alert.severity === 'critical' || alert.severity === 'high').length : null;

  return <AdminShell activeSection="alerts" title="Trung tâm cảnh báo" subtitle="Theo dõi tín hiệu bất thường từ dữ liệu quản trị thật.">
    <AdminIconTabs label="Nhóm cảnh báo" tabs={tabs} />

    <AdminToolbar label="Kỳ cảnh báo">
      {reportPeriods.map((candidate) => (
        <AdminFilterChip
          key={candidate}
          href={alertHref(activeTab, candidate)}
          label={candidate}
          active={data.period === candidate}
        />
      ))}
    </AdminToolbar>

    <AdminKpiGrid label="Tóm tắt cảnh báo">
      <AdminKpiCard label="Đang hoạt động" value={activeAlerts ? activeAlerts.length : '—'} note="Chưa giải quyết" icon="exception" />
      <AdminKpiCard label="Mức cao" value={highCount ?? '—'} note="Nghiêm trọng hoặc cao" icon="info" tone={highCount && highCount > 0 ? 'attention' : 'neutral'} />
      <AdminKpiCard label="Quy tắc đang áp dụng" value={sourceReady ? data.rules.length : '—'} note="Nguồn dữ liệu chính thức" icon="clipboard" />
      <AdminKpiCard label="Kỳ đang xem" value={data.period} note="Phạm vi cảnh báo" icon="document" />
    </AdminKpiGrid>

    {!sourceReady ? (
      <AdminStatePanel
        title="Chưa thể hiển thị cảnh báo"
        message={data.message ?? 'Dữ liệu hiện không sẵn sàng.'}
        tone={data.message?.includes('không có quyền') ? 'forbidden' : 'error'}
      />
    ) : selectedDomain && selectedAccess && !selectedAccess.available ? (
      <AdminStatePanel
        title="Chưa thể mở nhóm cảnh báo này"
        message={selectedAccess.message ?? 'Nguồn dữ liệu hiện chưa sẵn sàng.'}
        tone="partial"
      />
    ) : activeTab === 'rules' ? (
      <section className="alertRuleList" aria-label="Quy tắc cảnh báo">
        {data.rules.length ? data.rules.map((rule) => (
          <article className="card alertRuleCard" key={rule.code}>
            <div>
              <AdminStatusBadge tone={severityTone(rule.severity)}>{severityLabels[rule.severity]}</AdminStatusBadge>
              <AdminStatusBadge>{rule.domainLabel}</AdminStatusBadge>
            </div>
            <h2>{rule.name}</h2>
            <p>{rule.metric} · {rule.threshold}</p>
            <small>Quy tắc dùng dữ liệu chính thức; màn hình này chỉ hiển thị.</small>
          </article>
        )) : <AdminStatePanel title="Chưa có quy tắc cảnh báo" message="Quy tắc chỉ xuất hiện khi nguồn chính thức đã được mở." tone="empty" />}
      </section>
    ) : activeTab === 'history' ? (
      <section className="alertList" aria-label="Lịch sử cảnh báo">
        {history.length ? history.map(({ alert, event }, index) => (
          <Link className="card alertListItem" href={`/alerts/${encodeURIComponent(alert.id)}?period=${encodeURIComponent(data.period)}`} key={`${alert.id}-${event.occurredAt}-${index}`}>
            <div className="alertListTopline">
              <AdminStatusBadge tone={severityTone(alert.severity)}>{severityLabels[alert.severity]}</AdminStatusBadge>
              <AdminStatusBadge tone={statusTone(event.status)}>{statusLabels[event.status]}</AdminStatusBadge>
            </div>
            <h2>{alert.title}</h2>
            <p className="alertEntity">{alert.domainLabel} · {alert.entity}</p>
            <div className="alertListFooter"><span>{dateTime(event.occurredAt)} · {event.actorLabel}</span><strong>Xem chi tiết →</strong></div>
          </Link>
        )) : <AdminStatePanel title="Chưa có lịch sử xử lý" message="Lịch sử sẽ xuất hiện khi cảnh báo được cập nhật trạng thái." tone="empty" />}
      </section>
    ) : (
      <section className="alertList" aria-label="Danh sách cảnh báo">
        {visible.length ? visible.map((alert) => (
          <Link className="card alertListItem" href={`/alerts/${encodeURIComponent(alert.id)}?period=${encodeURIComponent(data.period)}`} key={alert.id}>
            <div className="alertListTopline">
              <AdminStatusBadge tone={severityTone(alert.severity)}>{severityLabels[alert.severity]}</AdminStatusBadge>
              <AdminStatusBadge tone={statusTone(alert.status)}>{statusLabels[alert.status]}</AdminStatusBadge>
            </div>
            <h2>{alert.title}</h2>
            <p className="alertEntity">{alert.domainLabel} · {alert.entity}{alert.context ? ` · ${alert.context}` : ''}</p>
            <div className="alertMetricGrid">
              <span><small>Quy tắc</small><strong>{alert.ruleName}</strong></span>
              <span><small>Điều kiện</small><strong>{alert.threshold}</strong></span>
              <span><small>Dữ liệu ghi nhận</small><strong>{alert.actual}</strong></span>
              <span><small>Nguồn</small><strong>{alert.source}</strong></span>
            </div>
            <div className="alertListFooter"><span>{dateTime(alert.detectedAt)}</span><strong>Xem chi tiết →</strong></div>
          </Link>
        )) : <AdminStatePanel title="Không có cảnh báo đang mở" message="Không phát hiện tín hiệu cần rà soát trong nhóm đang xem." tone="ok" />}
      </section>
    )}
  </AdminShell>;
}
