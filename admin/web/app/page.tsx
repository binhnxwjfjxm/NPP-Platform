import Link from 'next/link';
import { AdminIcon } from './admin-icons';
import { AdminShell } from './admin-shell';
import { loadControlTower } from '@/lib/control-tower';
import { loadProposals, type ProposalItem } from './approvals/proposal-data';
import { loadAlertCenter, type AdminAlert } from './alerts/alert-data';
import { normalizeReportPeriod, reportPeriods, resolveReportRange, type ReportPeriod } from './reports/report-data';
import styles from './overview.module.css';

export const dynamic = 'force-dynamic';

type MetricRow = Record<string, unknown>;

const familyLabels: Record<string, string> = {
  sales: 'Kinh doanh',
  purchasing: 'Mua hàng',
  inventory: 'Kho',
  aging: 'Công nợ',
  grossMargin: 'Lãi gộp',
  'gross-margin': 'Lãi gộp',
  employeeMcp: 'MCP',
  'employee-mcp': 'MCP',
  logistics: 'Giao vận',
  cod: 'COD',
};

function metricText(row: MetricRow | undefined | null, key: string, fallback = '—'): string {
  const value = row?.[key];
  if (typeof value === 'string' && value.length) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function exactDecimal(value: string): string {
  const [integer, fraction] = value.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped}${fraction ? `,${fraction}` : ''}`;
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed);
}

function overviewHref(period: ReportPeriod): string {
  return period === 'Tháng này' ? '/' : `/?period=${encodeURIComponent(period)}`;
}

function reportDetailHref(reportId: string, period: ReportPeriod): string {
  return `/reports/${reportId}?period=${encodeURIComponent(period)}`;
}

function proposalRank(item: ProposalItem): number {
  if (item.priority === 'critical') return 3;
  if (item.priority === 'high') return 2;
  return 1;
}

function alertRank(item: AdminAlert): number {
  if (item.severity === 'critical') return 3;
  if (item.severity === 'high') return 2;
  return 1;
}

export default async function AdminOverviewPage({ searchParams }: { searchParams?: { period?: string } }) {
  const period = normalizeReportPeriod(searchParams?.period);
  const range = resolveReportRange(period);
  const [controlResult, proposalResult, alertData] = await Promise.all([
    loadControlTower(range).then((data) => ({ data })).catch(() => ({ data: null })),
    loadProposals().then((data) => ({ data })).catch(() => ({ data: null })),
    loadAlertCenter(period),
  ]);

  const data = controlResult.data;
  const proposals = proposalResult.data;
  const sales = data?.management.sales?.summary;
  const inventory = data?.management.inventory?.summary;
  const logistics = data?.management.logistics?.summary;
  const grossMargin = data?.management.grossMargin?.summary;

  const pendingProposals = proposals?.filter((item) => item.status === 'pending') ?? [];
  const needsInfoProposals = proposals?.filter((item) => item.status === 'needs-info') ?? [];
  const urgentProposals = pendingProposals.filter((item) => item.priority === 'critical');
  const activeAlerts = alertData.message ? null : alertData.alerts.filter((item) => item.status !== 'resolved');
  const highAlerts = activeAlerts?.filter((item) => item.severity === 'critical' || item.severity === 'high') ?? [];

  const priorityProposal = [...pendingProposals]
    .sort((left, right) => proposalRank(right) - proposalRank(left) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  const priorityAlert = activeAlerts
    ? [...activeAlerts].sort((left, right) => alertRank(right) - alertRank(left) || Date.parse(right.detectedAt ?? '') - Date.parse(left.detectedAt ?? ''))[0]
    : undefined;

  const executiveReportState = !data ? 'Chưa sẵn sàng' : data.warnings.length ? 'Chưa đầy đủ' : 'Bình thường';
  const executiveReportNote = !data
    ? 'Chưa tải được số liệu điều hành'
    : data.warnings.length
      ? `${data.warnings.length} nguồn cần kiểm tra`
      : `Số liệu Công Ty đã sẵn sàng · ${period}`;

  const sourceWarnings = [
    !data ? 'Chưa tải được số liệu điều hành của Công Ty.' : null,
    data?.warnings.length
      ? `Một số số liệu chưa đầy đủ: ${[...new Set(data.warnings.map((item) => familyLabels[item.family] ?? item.family))].join(', ')}.`
      : null,
    proposals === null ? 'Chưa tải được danh sách Đề xuất.' : null,
    alertData.message,
  ].filter((item): item is string => Boolean(item));

  const hasIncompletePrioritySources = proposals === null || Boolean(alertData.message);
  const grossMarginValue = metricText(grossMargin, 'grossMarginVnd');

  return (
    <AdminShell activeSection="overview" title="Tổng quan quản trị" subtitle="Tín hiệu ưu tiên, tình hình vận hành và các quyết định cần chú ý.">
      {sourceWarnings.map((warning) => <p className="warning compactWarning" role="alert" key={warning}>{warning}</p>)}

      <nav className={styles.periodTabs} aria-label="Kỳ tổng quan">
        {reportPeriods.map((candidate) => (
          <Link key={candidate} className={`${styles.periodTab} ${period === candidate ? styles.periodActive : ''}`} href={overviewHref(candidate)}>
            {candidate}
          </Link>
        ))}
      </nav>
      <div className={styles.periodMeta} role="status">
        <strong>{period}</strong>
        <span>{formatDate(range.from)} – {formatDate(range.to)}</span>
      </div>

      <section className="metricGrid appMetricGrid" aria-label="Chỉ số quản trị">
        <Link className={`card metricCard ${styles.metricLink}`} href={reportDetailHref('sales-profit-summary', period)}><span className="iconBubble"><AdminIcon name="clipboard" /></span><div className="metricCopy"><span>Đơn bán hiệu lực</span><strong>{metricText(sales, 'effectiveOrderCount')}</strong></div></Link>
        <Link className={`card metricCard ${styles.metricLink}`} href={reportDetailHref('inventory-overview', period)}><span className="iconBubble"><AdminIcon name="warehouse" /></span><div className="metricCopy"><span>SKU đang có tồn</span><strong>{metricText(inventory, 'stockedSkuCount')}</strong></div></Link>
        <Link className={`card metricCard ${styles.metricLink}`} href={reportDetailHref('delivery-cod-overview', period)}><span className="iconBubble"><AdminIcon name="exception" /></span><div className="metricCopy"><span>Giao thất bại</span><strong>{metricText(logistics, 'failedCount')}</strong></div></Link>
        <Link className={`card metricCard ${styles.metricLink}`} href={reportDetailHref('sales-profit-summary', period)}><span className="iconBubble"><AdminIcon name="coin" /></span><div className="metricCopy"><span>Lãi gộp VND</span><strong>{grossMarginValue === '—' ? '—' : exactDecimal(grossMarginValue)}</strong></div></Link>
      </section>

      <p className="sectionEyebrow">Nhịp quản trị</p>
      <section className="overviewDecisionStrip" aria-label="Tóm tắt đề xuất và cảnh báo">
        <div><span>Chờ quyết định</span><strong>{proposals ? pendingProposals.length : '—'}</strong><small>{proposals ? `${urgentProposals.length} ưu tiên cao · ${needsInfoProposals.length} chờ bổ sung` : 'Chưa tải được'}</small></div>
        <div><span>Cảnh báo mở</span><strong>{activeAlerts ? activeAlerts.length : '—'}</strong><small>{activeAlerts ? `${highAlerts.length} mức cao` : 'Chưa tải được'}</small></div>
        <div><span>Điều hành</span><strong>{executiveReportState}</strong><small>{executiveReportNote}</small></div>
      </section>

      <p className="sectionEyebrow">Ưu tiên hôm nay</p>
      <section className="overviewFocusList" aria-label="Việc cần chú ý hôm nay">
        {priorityProposal ? <Link className="card overviewFocusItem" href={`/approvals/${encodeURIComponent(priorityProposal.id)}`}><span className="rowIcon"><AdminIcon name="check" size={19} /></span><span><small>Đề xuất</small><strong>{priorityProposal.title}</strong><em>{priorityProposal.impact}</em></span><AdminIcon name="chevronRight" size={17} /></Link> : null}
        {priorityAlert ? <Link className="card overviewFocusItem" href={`/alerts/${encodeURIComponent(priorityAlert.id)}?period=${encodeURIComponent(period)}`}><span className="rowIcon"><AdminIcon name="exception" size={19} /></span><span><small>Cảnh báo</small><strong>{priorityAlert.title}</strong><em>{priorityAlert.actual} · Ngưỡng {priorityAlert.threshold}</em></span><AdminIcon name="chevronRight" size={17} /></Link> : null}
        {!priorityProposal && !priorityAlert ? <div className={`card ${styles.empty}`}><strong>{hasIncompletePrioritySources ? 'Chưa xác định đầy đủ việc ưu tiên.' : 'Không có việc ưu tiên đang mở.'}</strong><span>{hasIncompletePrioritySources ? 'Một số nguồn chưa sẵn sàng; xem cảnh báo phía trên để kiểm tra.' : 'Các nguồn đã tải hiện không có Đề xuất chờ quyết định hoặc Cảnh báo mở.'}</span></div> : null}
      </section>

      <p className="sectionEyebrow">Trung tâm quản trị</p>
      <section className="adminOverviewActions" aria-label="Đi tới trung tâm quản trị">
        <Link className="card adminOverviewAction" href="/approvals"><span className="rowIcon"><AdminIcon name="check" size={20} /></span><span><strong>Đề xuất</strong><small>{proposals ? `${pendingProposals.length} chờ quyết định · ${urgentProposals.length} ưu tiên cao` : 'Chưa tải được trạng thái Đề xuất'}</small></span><AdminIcon name="chevronRight" size={17} /></Link>
        <Link className="card adminOverviewAction" href="/alerts"><span className="rowIcon"><AdminIcon name="exception" size={20} /></span><span><strong>Cảnh báo</strong><small>{activeAlerts ? `${activeAlerts.length} đang mở · ${highAlerts.length} mức cao` : 'Chưa tải được trạng thái Cảnh báo'}</small></span><AdminIcon name="chevronRight" size={17} /></Link>
        <Link className="card adminOverviewAction" href="/reports"><span className="rowIcon"><AdminIcon name="document" size={20} /></span><span><strong>Báo cáo</strong><small>Điều hành: {executiveReportState} · số liệu Công Ty</small></span><AdminIcon name="chevronRight" size={17} /></Link>
      </section>
    </AdminShell>
  );
}
