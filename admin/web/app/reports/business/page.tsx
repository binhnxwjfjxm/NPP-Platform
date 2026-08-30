import Link from 'next/link';
import { AdminShell } from '../../admin-shell';
import { AdminFilterChip, AdminKpiCard, AdminKpiGrid, AdminStatePanel, AdminToolbar } from '../../admin-ui-primitives';
import { reportPeriods } from '../report-data';
import { loadBusinessReport, type BusinessBreakdownKey, type BusinessRow } from '../business-report-data';
import styles from '../report-center.module.css';

const dimensions: Array<[BusinessBreakdownKey, string]> = [
  ['customerGroups', 'Loại khách'], ['customers', 'Khách hàng'], ['products', 'SKU / Sản phẩm'], ['productGroups', 'Nhóm hàng'], ['channels', 'Kênh bán'], ['employees', 'Nhân viên bán hàng'],
];
function text(value: unknown, fallback = '0'): string { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function money(value: unknown, currency: string): string { const parsed = Number(value); return Number.isFinite(parsed) ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(parsed)} ${currency}` : `0 ${currency}`; }
function quantity(value: unknown, unit: { code?: string; name?: string }): string { const parsed = Number(value); const label = unit.name || unit.code || 'ĐVT chưa xác định'; return Number.isFinite(parsed) ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 }).format(parsed)} ${label}` : `0 ${label}`; }
function change(row: BusinessRow): string { if (row.changePercent !== null && row.changePercent !== '') { const parsed = Number(row.changePercent); if (Number.isFinite(parsed)) return `${parsed > 0 ? '+' : ''}${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(parsed)}%`; } if (row.comparisonState === 'new') return 'Mới phát sinh'; if (row.comparisonState === 'inactive') return 'Không phát sinh kỳ này'; return 'Chưa có cơ sở so sánh'; }

export default async function BusinessReportPage({ searchParams }: { searchParams?: { period?: string } }) {
  const report = await loadBusinessReport(searchParams?.period);
  const revenues = Array.isArray(report.summary.revenues) ? report.summary.revenues as Record<string, unknown>[] : [];
  const quantities = Array.isArray(report.summary.quantities) ? report.summary.quantities as Record<string, unknown>[] : [];
  const periodHref = (period: string) => `/reports/business?${new URLSearchParams({ period }).toString()}`;
  const exportHref = `/reports/export?${new URLSearchParams({ report: 'sales-profit', from: report.from, to: report.to }).toString()}`;
  const tone = report.state === 'ready' ? 'ok' : report.state === 'partial' ? 'partial' : report.state === 'forbidden' ? 'forbidden' : 'error';
  return <AdminShell activeSection="reports" title="Báo cáo Kinh doanh" subtitle="Doanh thu, sản lượng và cơ cấu bán hàng từ cùng một nguồn số liệu đã đối soát." contentWidth="special">
    <div className={styles.detailRows}><div><span>Điều hướng</span><strong><Link href="/reports">Báo cáo quản trị</Link> · <Link href="/reports/profit">Lợi nhuận</Link></strong></div></div>
    <AdminToolbar label="Kỳ Báo cáo Kinh doanh" actions={<a className={styles.toolbarAction} href={exportHref}>Xuất Excel Kinh doanh</a>}>
      {reportPeriods.map((period) => <AdminFilterChip key={period} href={periodHref(period)} label={period} active={report.period === period} />)}
    </AdminToolbar>
    <AdminStatePanel title={report.state === 'ready' ? 'Số liệu đã đối soát' : report.state === 'partial' ? 'Có dữ liệu lịch sử cần lưu ý' : 'Không thể tải số liệu'} message={report.message ?? 'Doanh thu dòng hàng khớp tổng phiên bản đơn bán trong phạm vi đang xem.'} tone={tone} />
    <AdminKpiGrid label="Tổng quan Kinh doanh" className={styles.detailKpis}>
      <AdminKpiCard label="Doanh thu" value={revenues.length ? revenues.map((row) => money(row.revenue, text(row.currencyCode, 'VND'))).join(' · ') : 'Không phát sinh'} note="Giữ riêng từng loại tiền; không cộng chéo." />
      <AdminKpiCard label="Sản lượng" value={quantities.length ? quantities.map((row) => quantity(row.quantity, (row.unit ?? {}) as { code?: string; name?: string })).join(' · ') : 'Không phát sinh'} note="Giữ riêng từng ĐVT; không cộng gộp các ĐVT khác nhau." />
      <AdminKpiCard label="Đơn đã chốt" value={text(report.summary.effectiveOrderCount)} note="Đơn xác nhận hoặc hoàn tất trong kỳ." />
      <AdminKpiCard label="Khách mua" value={text(report.summary.buyerCount)} note="Khách có đơn hiệu lực trong kỳ." />
    </AdminKpiGrid>
    <section className={`card ${styles.trend}`}><div className={styles.sectionHeading}><div><span>Xu hướng</span><h3>Doanh thu theo ngày</h3></div></div>{report.trend.length ? <div className={styles.detailRows}>{report.trend.map((point, index) => <div key={`${text(point.businessDate)}-${text(point.currencyCode)}-${index}`}><span>{text(point.businessDate)} · {text(point.currencyCode)}</span><strong>{money(point.revenue ?? point.totalValue, text(point.currencyCode, 'VND'))}</strong></div>)}</div> : <p>Không phát sinh doanh thu trong kỳ.</p>}</section>
    {dimensions.map(([key, title]) => <section className={`card ${styles.detailSection}`} key={key}><div className={styles.sectionHeading}><div><span>Xem theo</span><h3>{title}</h3></div></div>{report.breakdowns[key].length ? <div className={styles.drilldownTree}>{report.breakdowns[key].map((row, index) => <details className={styles.drilldownNode} key={`${key}-${row.id ?? row.code ?? index}-${row.currencyCode}-${row.unit?.code}`}><summary><span>{[row.code, row.name].filter(Boolean).join(' · ')}</span><small>{money(row.revenue, row.currencyCode)} · {quantity(row.quantity, row.unit)}</small></summary><div className={styles.drilldownBody}><div className={styles.detailRows}><div><span>Tỷ trọng</span><strong>{text(row.sharePercent)}%</strong></div><div><span>Kỳ trước</span><strong>{money(row.previousRevenue, row.currencyCode)} · {quantity(row.previousQuantity, row.unit)}</strong></div><div><span>Thay đổi doanh thu</span><strong>{change(row)}</strong></div>{row.source === 'legacy-current-master' ? <div><span>Nguồn chiều phân tích</span><strong>Đơn cũ: tham chiếu danh mục hiện tại</strong></div> : null}</div></div></details>)}</div> : <p>Không phát sinh dữ liệu trong chiều này.</p>}</section>)}
    {report.warnings.length ? <section className={`card ${styles.detailSection}`}><h3>Điểm cần lưu ý</h3><div className={styles.detailHighlights}>{report.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div></section> : null}
    <Link className={`card ${styles.detailLink}`} href={`/reports/business/reconciliation?${new URLSearchParams({ period: report.period }).toString()}`}><span>Đối soát chứng từ cuối báo cáo</span><strong>→</strong></Link>
  </AdminShell>;
}
