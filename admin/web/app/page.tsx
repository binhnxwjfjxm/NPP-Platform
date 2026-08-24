import Link from 'next/link';
import { AdminIcon } from './admin-icons';
import { AdminShell } from './admin-shell';
import {
  AdminFilterChip,
  AdminKpiCard,
  AdminKpiGrid,
  AdminStatePanel,
  AdminStatusBadge,
  AdminToolbar,
} from './admin-ui-primitives';
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
  const params = new URLSearchParams({ period, returnTo: overviewHref(period) });
  return `/reports/${reportId}?${params.toString()}`;
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

  const reportWarningFamilies = new Set(data?.warnings.map((item) => item.family) ?? []);
  const executiveReportState = !data ? 'Chưa sẵn sàng' : data.warnings.length ? 'Chưa đầy đủ' : 'Bình thường';
  const executiveReportNote = !data
    ? 'Chưa tải được số liệu điều hành'
    : data.warnings.length
      ? `${reportWarningFamilies.size} nguồn cần kiểm tra`
      : `Số liệu Công Ty đã sẵn sàng · ${period}`;

  const sourceWarnings = [
    !data ? 'Chưa tải được số liệu điều hành của Công Ty.' : null,
    data?.warnings.length
      ? `Một số số liệu chưa đầy đủ: ${[...new Set(data.warnings.map((item) => familyLabels[item.family] ?? item.family))].join(', ')}.`
      : null,
    proposals === null ? 'Chưa tải được danh sách Đề xuất.' : null,
    alertData.message,
  ].filter((item): item is string => Boolean(item));
  const affectedSourceKeys = new Set<string>();
  if (!data) affectedSourceKeys.add('control-tower');
  else reportWarningFamilies.forEach((family) => affectedSourceKeys.add(`report:${family}`));
  if (proposals === null) affectedSourceKeys.add('proposals');
  if (alertData.message) affectedSourceKeys.add('alerts');
  const affectedSourceCount = affectedSourceKeys.size;

  const hasIncompletePrioritySources = proposals === null || Boolean(alertData.message);
  const grossMarginValue = metricText(grossMargin, 'grossMarginVnd');
  const returnTo = encodeURIComponent(overviewHref(period));

  return (
    <AdminShell activeSection="overview" title="Tổng quan quản trị" subtitle="Tín hiệu ưu tiên, tình hình vận hành và các quyết định cần chú ý.">
      <AdminToolbar
        label="Kỳ tổng quan"
        actions={<AdminStatusBadge tone="info">{formatDate(range.from)} – {formatDate(range.to)}</AdminStatusBadge>}
      >
        {reportPeriods.map((candidate) => (
          <AdminFilterChip
            key={candidate}
            href={overviewHref(candidate)}
            label={candidate}
            active={period === candidate}
          />
        ))}
      </AdminToolbar>

      {sourceWarnings.length ? (
        <AdminStatePanel
          className={styles.sourceState}
          title="Một số nguồn cần kiểm tra"
          message={sourceWarnings.join(' ')}
          tone="partial"
          icon="info"
        />
      ) : null}

      <AdminKpiGrid label="Chỉ số quản trị">
        <AdminKpiCard label="Đơn bán hiệu lực" value={metricText(sales, 'effectiveOrderCount')} icon="clipboard" href={reportDetailHref('sales-profit-summary', period)} />
        <AdminKpiCard label="SKU đang có tồn" value={metricText(inventory, 'stockedSkuCount')} icon="warehouse" href={reportDetailHref('inventory-overview', period)} />
        <AdminKpiCard label="Giao thất bại" value={metricText(logistics, 'failedCount')} icon="exception" href={reportDetailHref('delivery-cod-overview', period)} />
        <AdminKpiCard label="Lãi gộp VND" value={grossMarginValue === '—' ? '—' : exactDecimal(grossMarginValue)} icon="coin" href={reportDetailHref('sales-profit-summary', period)} />
      </AdminKpiGrid>

      <p className="sectionEyebrow">Nhịp quản trị</p>
      <AdminKpiGrid label="Tóm tắt đề xuất, cảnh báo và điều hành">
        <AdminKpiCard
          label="Chờ quyết định"
          value={proposals ? pendingProposals.length : '—'}
          note={proposals ? `${urgentProposals.length} ưu tiên cao · ${needsInfoProposals.length} chờ bổ sung` : 'Chưa tải được'}
          icon="check"
          href="/approvals"
          tone={urgentProposals.length ? 'attention' : 'neutral'}
        />
        <AdminKpiCard
          label="Cảnh báo mở"
          value={activeAlerts ? activeAlerts.length : '—'}
          note={activeAlerts ? `${highAlerts.length} mức cao` : 'Chưa tải được'}
          icon="exception"
          href="/alerts"
          tone={highAlerts.length ? 'attention' : 'neutral'}
        />
        <AdminKpiCard
          label="Điều hành"
          value={executiveReportState}
          note={executiveReportNote}
          icon="overview"
          href="/reports"
          tone={!data || data.warnings.length ? 'attention' : 'success'}
        />
        <AdminKpiCard
          label="Nguồn cần kiểm tra"
          value={affectedSourceCount}
          note={affectedSourceCount ? 'Có nguồn chưa sẵn sàng hoặc chưa đầy đủ' : 'Các nguồn đang sẵn sàng'}
          icon="info"
          tone={affectedSourceCount ? 'attention' : 'success'}
        />
      </AdminKpiGrid>

      <p className="sectionEyebrow">Ưu tiên hôm nay</p>
      <section className="overviewFocusList" aria-label="Việc cần chú ý hôm nay">
        {priorityProposal ? <Link className="card overviewFocusItem" href={`/approvals/${encodeURIComponent(priorityProposal.id)}?returnTo=${returnTo}`}><span className="rowIcon"><AdminIcon name="check" size={19} /></span><span><small>Đề xuất</small><strong>{priorityProposal.title}</strong><em>{priorityProposal.impact}</em></span><AdminIcon name="chevronRight" size={17} /></Link> : null}
        {priorityAlert ? <Link className="card overviewFocusItem" href={`/alerts/${encodeURIComponent(priorityAlert.id)}?period=${encodeURIComponent(period)}&returnTo=${returnTo}`}><span className="rowIcon"><AdminIcon name="exception" size={19} /></span><span><small>Cảnh báo</small><strong>{priorityAlert.title}</strong><em>{priorityAlert.actual} · Ngưỡng {priorityAlert.threshold}</em></span><AdminIcon name="chevronRight" size={17} /></Link> : null}
        {!priorityProposal && !priorityAlert ? (
          <AdminStatePanel
            className={styles.focusState}
            title={hasIncompletePrioritySources ? 'Chưa xác định đầy đủ việc ưu tiên.' : 'Không có việc ưu tiên đang mở.'}
            message={hasIncompletePrioritySources ? 'Một số nguồn chưa sẵn sàng; xem trạng thái nguồn ở phía trên để kiểm tra.' : 'Các nguồn đã tải hiện không có Đề xuất chờ quyết định hoặc Cảnh báo mở.'}
            tone={hasIncompletePrioritySources ? 'partial' : 'ok'}
          />
        ) : null}
      </section>
    </AdminShell>
  );
}
