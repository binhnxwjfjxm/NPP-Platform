import Link from 'next/link';
import { AdminIcon } from './admin-icons';
import { AdminShell } from './admin-shell';
import { loadControlTower } from '@/lib/control-tower';
import { approvalFixtures } from './approvals/approval-fixtures';
import { adminAlerts } from './alerts/alert-preview-data';
import { reportPreviews } from './reports/report-preview-data';

export const dynamic = 'force-dynamic';

type MetricRow = Record<string, unknown>;

function text(row: MetricRow | undefined | null, key: string, fallback = '—'): string {
  const value = row?.[key];
  return typeof value === 'string' && value.length ? value : fallback;
}

function exactDecimal(value: string): string {
  const [integer, fraction] = value.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped}${fraction ? `,${fraction}` : ''}`;
}

export default async function AdminOverviewPage() {
  const data = await loadControlTower().catch(() => null);
  const sales = data?.management.sales?.summary;
  const inventory = data?.management.inventory?.summary;
  const logistics = data?.management.logistics?.summary;
  const grossMargin = data?.management.grossMargin?.summary;

  const pendingApprovals = approvalFixtures.filter((item) => item.state === 'pending');
  const urgentApprovals = pendingApprovals.filter((item) => item.priority === 'critical');
  const activeAlerts = adminAlerts.filter((item) => item.status === 'active');
  const highAlerts = activeAlerts.filter((item) => item.severity === 'critical' || item.severity === 'high');
  const executiveReport = reportPreviews.find((item) => item.id === 'executive-overview');
  const priorityApproval = urgentApprovals[0] ?? pendingApprovals[0];
  const priorityAlert = activeAlerts.find((item) => item.severity === 'critical') ?? highAlerts[0] ?? activeAlerts[0];

  return (
    <AdminShell activeSection="overview" title="Tổng quan quản trị" subtitle="Tín hiệu ưu tiên, tình hình vận hành và các quyết định cần chú ý.">
      {!data ? <p className="warning compactWarning" role="alert">Dữ liệu tổng hợp tạm thời chưa sẵn sàng.</p> : null}
      {data?.warnings.length ? <p className="warning compactWarning" role="alert">Một số nguồn dữ liệu đang chưa đầy đủ.</p> : null}

      <section className="metricGrid appMetricGrid" aria-label="Chỉ số quản trị">
        <article className="card metricCard"><span className="iconBubble"><AdminIcon name="clipboard" /></span><div className="metricCopy"><span>Đơn bán hiệu lực</span><strong>{text(sales, 'effectiveOrderCount')}</strong></div></article>
        <article className="card metricCard"><span className="iconBubble"><AdminIcon name="warehouse" /></span><div className="metricCopy"><span>SKU đang có tồn</span><strong>{text(inventory, 'stockedSkuCount')}</strong></div></article>
        <article className="card metricCard"><span className="iconBubble"><AdminIcon name="exception" /></span><div className="metricCopy"><span>Giao thất bại</span><strong>{text(logistics, 'failedCount')}</strong></div></article>
        <article className="card metricCard"><span className="iconBubble"><AdminIcon name="coin" /></span><div className="metricCopy"><span>Lãi gộp VND</span><strong>{text(grossMargin, 'grossMarginVnd') === '—' ? '—' : exactDecimal(text(grossMargin, 'grossMarginVnd'))}</strong></div></article>
      </section>

      <p className="sectionEyebrow">Nhịp quản trị</p>
      <section className="overviewDecisionStrip" aria-label="Tóm tắt đề xuất và cảnh báo">
        <div><span>Chờ quyết định</span><strong>{pendingApprovals.length}</strong><small>{urgentApprovals.length} ưu tiên cao</small></div>
        <div><span>Cảnh báo mở</span><strong>{activeAlerts.length}</strong><small>{highAlerts.length} mức cao</small></div>
        <div><span>Điều hành</span><strong>{executiveReport?.current ?? '—'}</strong><small>{executiveReport?.delta ?? 'Chưa có so sánh'}</small></div>
      </section>
      <p className="adminPreviewNotice overviewPreviewNotice">Đề xuất, cảnh báo và báo cáo bên dưới đang dùng dữ liệu minh họa; các chỉ số vận hành phía trên vẫn lấy từ nguồn tổng hợp hiện có.</p>

      <p className="sectionEyebrow">Ưu tiên hôm nay</p>
      <section className="overviewFocusList" aria-label="Việc cần chú ý hôm nay">
        {priorityApproval ? <Link className="card overviewFocusItem" href={`/approvals/${priorityApproval.id}`}><span className="rowIcon"><AdminIcon name="check" size={19} /></span><span><small>Đề xuất</small><strong>{priorityApproval.title}</strong><em>{priorityApproval.impact}</em></span><AdminIcon name="chevronRight" size={17} /></Link> : null}
        {priorityAlert ? <Link className="card overviewFocusItem" href={`/alerts/${priorityAlert.id}`}><span className="rowIcon"><AdminIcon name="exception" size={19} /></span><span><small>Cảnh báo</small><strong>{priorityAlert.title}</strong><em>{priorityAlert.actual} · Ngưỡng {priorityAlert.threshold}</em></span><AdminIcon name="chevronRight" size={17} /></Link> : null}
      </section>

      <p className="sectionEyebrow">Trung tâm quản trị</p>
      <section className="adminOverviewActions" aria-label="Đi tới trung tâm quản trị">
        <Link className="card adminOverviewAction" href="/approvals"><span className="rowIcon"><AdminIcon name="check" size={20} /></span><span><strong>Đề xuất</strong><small>{pendingApprovals.length} đề xuất chờ quyết định · {urgentApprovals.length} ưu tiên cao</small></span><AdminIcon name="chevronRight" size={17} /></Link>
        <Link className="card adminOverviewAction" href="/alerts"><span className="rowIcon"><AdminIcon name="exception" size={20} /></span><span><strong>Cảnh báo</strong><small>{activeAlerts.length} cảnh báo đang hoạt động · {highAlerts.length} mức cao</small></span><AdminIcon name="chevronRight" size={17} /></Link>
        <Link className="card adminOverviewAction" href="/reports"><span className="rowIcon"><AdminIcon name="document" size={20} /></span><span><strong>Báo cáo</strong><small>Điều hành {executiveReport?.current ?? '—'} · {executiveReport?.delta ?? 'chưa có so sánh'}</small></span><AdminIcon name="chevronRight" size={17} /></Link>
      </section>
    </AdminShell>
  );
}
