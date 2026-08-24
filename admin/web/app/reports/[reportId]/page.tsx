import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '../../admin-shell';
import {
  AdminKpiCard,
  AdminKpiGrid,
  AdminStatePanel,
  AdminStatusBadge,
  type AdminStateTone,
} from '../../admin-ui-primitives';
import { safeAdminReturnTo } from '../../../lib/admin-session';
import { normalizeReportPeriod, reportDomainFromId, type ReportState } from '../report-data';
import { loadLotCPresentation } from '../report-lot-c-data';
import { loadLotCDrilldown, type LotCDrilldownNode } from '../report-lot-c-drilldown';
import { McpSupervision, type McpReportSearchParams } from '../mcp-supervision';
import styles from '../report-center.module.css';

function DrilldownNodeView({ node, depth = 0 }: { node: LotCDrilldownNode; depth?: number }) {
  return (
    <details className={styles.drilldownNode} open={depth === 0}>
      <summary><span>{node.label}</span><small>{node.summary}</small></summary>
      <div className={styles.drilldownBody}>
        {node.facts.length > 0 ? (
          <div className={styles.detailRows}>
            {node.facts.map((fact) => <div key={`${node.id}-${fact.label}`}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}
          </div>
        ) : null}
        {node.href ? <Link className={styles.inlineLink} href={node.href}>Mở chi tiết</Link> : null}
        {node.children.length > 0 ? (
          <div className={styles.drilldownChildren}>{node.children.map((child) => <DrilldownNodeView key={child.id} node={child} depth={depth + 1} />)}</div>
        ) : null}
      </div>
    </details>
  );
}

function backDestination(domain: string, period: string, warehouseId?: string, returnTo?: string) {
  const safeReturnTo = safeAdminReturnTo(returnTo);
  if (returnTo && (safeReturnTo === '/' || safeReturnTo.startsWith('/?period='))) return { href: safeReturnTo, label: '← Quay lại Tổng quan' };
  const params = new URLSearchParams({ tab: domain });
  if (domain !== 'debt') params.set('period', period);
  if (warehouseId) params.set('warehouseId', warehouseId);
  return { href: `/reports?${params.toString()}`, label: '← Quay lại báo cáo' };
}

function stateTone(state: ReportState): AdminStateTone {
  if (state === 'ready') return 'ok';
  if (state === 'partial') return 'partial';
  if (state === 'forbidden') return 'forbidden';
  if (state === 'error') return 'error';
  return 'empty';
}

type DetailSearchParams = McpReportSearchParams & { period?: string; warehouseId?: string };

export default async function ReportDetailPage({ params, searchParams }: { params: { reportId: string }; searchParams?: DetailSearchParams }) {
  const domain = reportDomainFromId(params.reportId); if (!domain) notFound();
  const period = normalizeReportPeriod(searchParams?.period); const warehouseId = searchParams?.warehouseId;
  const back = backDestination(domain, period, warehouseId, searchParams?.returnTo);

  if (domain === 'mcp') {
    return <AdminShell activeSection="reports" title="Giám sát MCP" subtitle="Theo dõi nhân viên, tuyến, điểm bán, check-in GPS và các trường hợp cần chú ý.">
      <McpSupervision period={period} searchParams={searchParams} backHref={back.href} backLabel={back.label} />
    </AdminShell>;
  }

  const [item, drilldown] = await Promise.all([
    loadLotCPresentation(domain, period, warehouseId),
    loadLotCDrilldown(domain, period, warehouseId),
  ]);

  return (
    <AdminShell
      activeSection="reports"
      title="Chi tiết báo cáo"
      subtitle="Bối cảnh và số liệu quản trị của báo cáo đã chọn."
      contentWidth="special"
    >
      <Link className={styles.backLink} href={back.href}>{back.label}</Link>

      <section className={`card ${styles.detailHero}`}>
        <AdminStatusBadge tone="info">{item.source}</AdminStatusBadge>
        <h2>{item.title}</h2>
        <p>{item.summary}</p>
      </section>

      <AdminStatePanel
        className={styles.detailState}
        title={item.stateLabel}
        message={item.stateMessage}
        tone={stateTone(item.state)}
      />

      <section className={`card ${styles.detailSection}`}>
        <h3>Phạm vi số liệu</h3>
        <div className={styles.detailRows}>
          <div><span>Nhóm báo cáo</span><strong>{item.domainLabel}</strong></div>
          <div><span>Phạm vi thời gian</span><strong>{item.periodLabel}</strong></div>
          {item.warehouseFilter?.selectedId ? <div><span>Kho đang lọc</span><strong>{item.warehouseFilter.options.find((option) => option.value === item.warehouseFilter?.selectedId)?.label ?? 'Theo phạm vi đã chọn'}</strong></div> : null}
          {item.details.map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}
        </div>
      </section>

      {item.metrics.length > 0 ? (
        <AdminKpiGrid label="Chỉ số quản trị" className={styles.detailKpis}>
          {item.metrics.map((metric) => (
            <AdminKpiCard key={metric.label} label={metric.label} value={metric.value} note={metric.note} />
          ))}
        </AdminKpiGrid>
      ) : null}

      {drilldown ? (
        <section className={`card ${styles.detailSection}`}>
          <h3>{drilldown.title}</h3>
          {drilldown.description ? <p className={styles.drilldownDescription}>{drilldown.description}</p> : null}
          {drilldown.message ? <AdminStatePanel title="Trạng thái chi tiết" message={drilldown.message} tone="partial" /> : null}
          {drilldown.nodes.length > 0 ? <div className={styles.drilldownTree}>{drilldown.nodes.map((node) => <DrilldownNodeView key={node.id} node={node} />)}</div> : null}
        </section>
      ) : null}

      <section className={`card ${styles.detailSection}`}><h3>Điểm cần chú ý</h3><div className={styles.detailHighlights}>{item.highlights.map((highlight, index) => <div key={`${index}-${highlight}`}>{highlight}</div>)}</div></section>
      <section className={`card ${styles.detailSection}`}><h3>Nguồn số liệu</h3><p>Số liệu trên màn hình được lấy từ <strong>{item.source}</strong>. Khi một nguồn không tải được hoặc dữ liệu chưa đầy đủ, màn hình giữ trạng thái đó thay vì thay bằng số 0.</p></section>
    </AdminShell>
  );
}
