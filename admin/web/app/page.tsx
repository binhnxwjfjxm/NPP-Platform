import Link from 'next/link';
import { AdminIcon } from './admin-icons';
import { AdminShell } from './admin-shell';
import { loadControlTower } from '@/lib/control-tower';

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

  return (
    <AdminShell activeSection="overview" title="Tổng quan quản trị" subtitle="Tín hiệu ưu tiên, tình hình vận hành và các quyết định cần chú ý.">
      {!data ? <p className="warning compactWarning" role="alert">Dữ liệu tổng hợp tạm thời chưa sẵn sàng.</p> : null}
      {data?.warnings.length ? <p className="warning compactWarning" role="alert">Một số nguồn dữ liệu đang chưa đầy đủ.</p> : null}

      <section className="metricGrid appMetricGrid" aria-label="KPI quản trị">
        <article className="card metricCard"><span className="iconBubble"><AdminIcon name="clipboard" /></span><div className="metricCopy"><span>Đơn bán hiệu lực</span><strong>{text(sales, 'effectiveOrderCount')}</strong></div></article>
        <article className="card metricCard"><span className="iconBubble"><AdminIcon name="warehouse" /></span><div className="metricCopy"><span>SKU đang có tồn</span><strong>{text(inventory, 'stockedSkuCount')}</strong></div></article>
        <article className="card metricCard"><span className="iconBubble"><AdminIcon name="exception" /></span><div className="metricCopy"><span>Giao thất bại</span><strong>{text(logistics, 'failedCount')}</strong></div></article>
        <article className="card metricCard"><span className="iconBubble"><AdminIcon name="coin" /></span><div className="metricCopy"><span>Lãi gộp VND</span><strong>{text(grossMargin, 'grossMarginVnd') === '—' ? '—' : exactDecimal(text(grossMargin, 'grossMarginVnd'))}</strong></div></article>
      </section>

      <p className="sectionEyebrow">Trung tâm quản trị</p>
      <section className="adminOverviewActions" aria-label="Đi tới trung tâm quản trị">
        <Link className="card adminOverviewAction" href="/approvals"><span className="rowIcon"><AdminIcon name="check" size={21} /></span><span><strong>Phê duyệt</strong><small>Các đề xuất cần quyết định quản lý</small></span><AdminIcon name="chevronRight" size={18} /></Link>
        <Link className="card adminOverviewAction" href="/alerts"><span className="rowIcon"><AdminIcon name="exception" size={21} /></span><span><strong>Cảnh báo</strong><small>Tín hiệu bất thường theo quy tắc</small></span><AdminIcon name="chevronRight" size={18} /></Link>
        <Link className="card adminOverviewAction" href="/reports"><span className="rowIcon"><AdminIcon name="document" size={21} /></span><span><strong>Báo cáo</strong><small>Tổng hợp quản trị Core và MCP</small></span><AdminIcon name="chevronRight" size={18} /></Link>
      </section>
    </AdminShell>
  );
}
