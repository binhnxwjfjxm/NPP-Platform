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

function nonZero(value: string): boolean { return value !== '—' && !/^0(?:\.0+)?$/.test(value); }

export default async function AdminOverviewPage() {
  const data = await loadControlTower().catch(() => null);
  const nppOperationsUrl = (process.env.NPP_OPERATIONS_URL?.trim() || 'https://npp-platform.vercel.app').replace(/\/$/, '');

  const sales = data?.management.sales?.summary;
  const inventory = data?.management.inventory?.summary;
  const logistics = data?.management.logistics?.summary;
  const grossMargin = data?.management.grossMargin?.summary;
  const employeeMcp = data?.management.employeeMcp?.summary;
  const cod = data?.management.cod;
  const aging = data?.management.aging;

  const inventoryExceptions = text(inventory, 'costingExceptionCount');
  const failedDeliveries = text(logistics, 'failedCount');
  const rescheduledDeliveries = text(logistics, 'rescheduledCount');
  const pendingDeliveryResults = text(logistics, 'pendingResultCount');
  const codNeedsAttention = Boolean(cod && (
    cod.hasPendingHandovers || cod.hasDiscrepancies || cod.hasOverduePromises || cod.hasLifecycleExceptions || cod.hasCurrencyLineageExceptions
  ));
  const needAttention = !data || data.warnings.length > 0 || codNeedsAttention || nonZero(inventoryExceptions) || nonZero(failedDeliveries) || nonZero(rescheduledDeliveries) || nonZero(pendingDeliveryResults);
  const grossMarginVnd = text(grossMargin, 'grossMarginVnd');

  return (
    <AdminShell
      activeSection="overview"
      kicker="Phase 8.7 · Control Tower"
      title="Tổng quan điều hành"
      subtitle={data ? `Kỳ ${data.filters.from} → ${data.filters.to} · ${data.timezone}` : 'Tổng hợp quản lý từ các contract báo cáo NPP canonical.'}
    >
      {!data ? <p className="warning compactWarning" role="alert">Control Tower tạm thời chưa tải được. NPP Operations vẫn là màn nghiệp vụ chi tiết.</p> : null}
      {data?.warnings.length ? <p className="warning compactWarning" role="alert">Một số nguồn đang thiếu: {data.warnings.map((item) => item.family).join(', ')}.</p> : null}

      <section className="card managementHero" aria-label="Tình trạng cần quản lý">
        <span className="managementHeroIcon"><AdminIcon name="exception" size={28} /></span>
        <div className="managementHeroCopy">
          <p>Control Tower</p>
          <h2>{needAttention ? 'Có tín hiệu cần quản lý xem' : 'Chưa có cảnh báo nổi bật trong dữ liệu đã tải'}</h2>
          <span>Admin chỉ tổng hợp và cảnh báo; xử lý chi tiết mở lại đúng màn NPP Operations.</span>
        </div>
        <a className="managementHeroAction" href={`${nppOperationsUrl}/operations/audit-history`}>
          Xem audit <AdminIcon name="chevronRight" size={18} />
        </a>
      </section>

      <section className="metricGrid appMetricGrid" aria-label="KPI quản lý">
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="clipboard" /></span>
          <div className="metricCopy"><span>Đơn bán hiệu lực</span><strong>{text(sales, 'effectiveOrderCount')}</strong></div>
        </article>
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="warehouse" /></span>
          <div className="metricCopy"><span>SKU đang có tồn</span><strong>{text(inventory, 'stockedSkuCount')}</strong></div>
        </article>
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="exception" /></span>
          <div className="metricCopy"><span>Lần giao thất bại</span><strong>{failedDeliveries}</strong></div>
        </article>
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="coin" /></span>
          <div className="metricCopy"><span>Lãi gộp VND</span><strong>{grossMarginVnd === '—' ? '—' : exactDecimal(grossMarginVnd)}</strong></div>
        </article>
      </section>

      <p className="sectionEyebrow">Cảnh báo & drill-down</p>
      <section className="card dashboardCard priorityListCard">
        <div className="managementList">
          <a className="managementRow" href={`${nppOperationsUrl}/accounting/cod-reporting`}>
            <span className="rowIcon"><AdminIcon name="coin" size={20} /></span>
            <span className="rowLabel">COD / bàn giao / đối soát</span>
            <span className={codNeedsAttention ? 'rowValue' : 'rowValue isUnavailable'}>{cod ? (codNeedsAttention ? 'Cần xem' : 'Ổn') : '—'}</span>
            <AdminIcon className="rowChevron" name="chevronRight" size={19} />
          </a>
          <a className="managementRow" href={`${nppOperationsUrl}/inventory/reporting`}>
            <span className="rowIcon"><AdminIcon name="warehouse" size={20} /></span>
            <span className="rowLabel">Ngoại lệ giá vốn / tồn kho</span>
            <span className={nonZero(inventoryExceptions) ? 'rowValue' : 'rowValue isUnavailable'}>{inventoryExceptions}</span>
            <AdminIcon className="rowChevron" name="chevronRight" size={19} />
          </a>
          <a className="managementRow" href={`${nppOperationsUrl}/logistics/reporting`}>
            <span className="rowIcon"><AdminIcon name="exception" size={20} /></span>
            <span className="rowLabel">Giao thất bại / dời lịch / thiếu kết quả</span>
            <span className="rowValue">{failedDeliveries} / {rescheduledDeliveries} / {pendingDeliveryResults}</span>
            <AdminIcon className="rowChevron" name="chevronRight" size={19} />
          </a>
          <a className="managementRow" href={`${nppOperationsUrl}/accounting/aging`}>
            <span className="rowIcon"><AdminIcon name="tag" size={20} /></span>
            <span className="rowLabel">Công nợ theo currency / tuổi nợ</span>
            <span className="rowValue">{aging ? `${aging.receivableSummary.length + aging.payableSummary.length} nhóm` : '—'}</span>
            <AdminIcon className="rowChevron" name="chevronRight" size={19} />
          </a>
          <a className="managementRow" href={`${nppOperationsUrl}/access/employees/performance`}>
            <span className="rowIcon"><AdminIcon name="user" size={20} /></span>
            <span className="rowLabel">Phiên MCP / order intent</span>
            <span className="rowValue">{text(employeeMcp, 'sessionCount')} / {text(employeeMcp, 'orderIntentCount')}</span>
            <AdminIcon className="rowChevron" name="chevronRight" size={19} />
          </a>
          <a className="managementRow" href={`${nppOperationsUrl}/operations/import-export-history`}>
            <span className="rowIcon"><AdminIcon name="clipboard" size={20} /></span>
            <span className="rowLabel">Lịch sử import / export canonical</span>
            <span className="rowValue isUnavailable">Mở NPP</span>
            <AdminIcon className="rowChevron" name="chevronRight" size={19} />
          </a>
        </div>
      </section>
    </AdminShell>
  );
}
