import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '../../admin-shell';
import {
  loadReportPresentation,
  normalizeReportPeriod,
  reportDomainFromId,
} from '../report-data';
import { loadReportDrilldown, type DrilldownNode } from '../report-drilldown';
import styles from '../report-center.module.css';

function DrilldownNodeView({ node, depth = 0 }: { node: DrilldownNode; depth?: number }) {
  return (
    <details className={styles.drilldownNode} open={depth === 0}>
      <summary>
        <span>{node.label}</span>
        <small>{node.summary}</small>
      </summary>
      <div className={styles.drilldownBody}>
        {node.facts.length > 0 ? (
          <div className={styles.detailRows}>
            {node.facts.map((fact) => (
              <div key={`${node.id}-${fact.label}`}><span>{fact.label}</span><strong>{fact.value}</strong></div>
            ))}
          </div>
        ) : null}
        {node.children.length > 0 ? (
          <div className={styles.drilldownChildren}>
            {node.children.map((child) => <DrilldownNodeView key={child.id} node={child} depth={depth + 1} />)}
          </div>
        ) : null}
      </div>
    </details>
  );
}

export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: { reportId: string };
  searchParams?: { period?: string };
}) {
  const domain = reportDomainFromId(params.reportId);
  if (!domain) notFound();

  const period = normalizeReportPeriod(searchParams?.period);
  const [item, drilldown] = await Promise.all([
    loadReportPresentation(domain, period),
    loadReportDrilldown(domain, period),
  ]);

  return (
    <AdminShell
      activeSection="reports"
      title="Chi tiết báo cáo"
      subtitle="Bối cảnh và số liệu quản trị của báo cáo đã chọn."
    >
      <Link
        className={styles.backLink}
        href={`/reports?tab=${item.domain}&period=${encodeURIComponent(period)}`}
      >
        ← Quay lại báo cáo
      </Link>

      <section className={`card ${styles.detailHero}`}>
        <span className={styles.sourceBadge}>{item.source}</span>
        <h2>{item.title}</h2>
        <p>{item.summary}</p>
        <div className={styles.detailNote}>
          <strong>{item.stateLabel}</strong>
          <span>{item.stateMessage}</span>
        </div>
      </section>

      <section className={`card ${styles.detailSection}`}>
        <h3>Phạm vi số liệu</h3>
        <div className={styles.detailRows}>
          <div><span>Nhóm báo cáo</span><strong>{item.domainLabel}</strong></div>
          <div><span>Kỳ hiển thị</span><strong>{item.periodLabel}</strong></div>
          {item.details.map((row) => (
            <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>
          ))}
        </div>
      </section>

      {item.metrics.length > 0 ? (
        <section className={`card ${styles.detailSection}`}>
          <h3>Chỉ số quản trị</h3>
          <div className={styles.detailMetrics}>
            {item.metrics.map((metric) => (
              <div className={styles.detailMetric} key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.note}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {drilldown ? (
        <section className={`card ${styles.detailSection}`}>
          <h3>{drilldown.title}</h3>
          {drilldown.description ? <p className={styles.drilldownDescription}>{drilldown.description}</p> : null}
          {drilldown.message ? <div className={styles.detailNote}>{drilldown.message}</div> : null}
          {drilldown.nodes.length > 0 ? (
            <div className={styles.drilldownTree}>
              {drilldown.nodes.map((node) => <DrilldownNodeView key={node.id} node={node} />)}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={`card ${styles.detailSection}`}>
        <h3>Điểm cần chú ý</h3>
        <div className={styles.detailHighlights}>
          {item.highlights.map((highlight, index) => (
            <div key={`${index}-${highlight}`}>{highlight}</div>
          ))}
        </div>
      </section>

      <section className={`card ${styles.detailSection}`}>
        <h3>Nguồn số liệu</h3>
        <p>
          Số liệu trên màn hình được lấy từ <strong>{item.source}</strong>.
          Khi một nguồn không tải được hoặc dữ liệu chưa đầy đủ, màn hình giữ trạng thái đó thay vì thay bằng số 0.
        </p>
      </section>
    </AdminShell>
  );
}
