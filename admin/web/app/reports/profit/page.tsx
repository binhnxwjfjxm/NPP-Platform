import Link from 'next/link';
import { AdminShell } from '../../admin-shell';
import { AdminFilterChip, AdminKpiCard, AdminKpiGrid, AdminStatePanel, AdminToolbar } from '../../admin-ui-primitives';
import { CoreApiError, requestCore } from '../../../lib/core-api';
import { normalizeReportPeriod, reportPeriods, resolveReportRange } from '../report-data';
import styles from '../report-center.module.css';

type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}; }
function numberText(value: unknown): string { const parsed = Number(value); return Number.isFinite(parsed) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(parsed) : '0'; }

export default async function ProfitReportPage({ searchParams }: { searchParams?: { period?: string } }) {
  const period = normalizeReportPeriod(searchParams?.period); const range = resolveReportRange(period); const query = new URLSearchParams({ from: range.from, to: range.to });
  let summary: JsonRecord = {}; let state: 'ready' | 'partial' | 'forbidden' | 'error' = 'ready'; let message = 'Lãi gộp chỉ dùng phần doanh thu VND đã có giá vốn đối chiếu được.';
  try { const data = await requestCore<unknown>(`/api/reporting/gross-margin?${query.toString()}`); summary = record(record(data).summary); const issues = Number(summary.missingCostCount ?? 0) + Number(summary.costAnomalyCount ?? 0) + Number(summary.nonVndCount ?? 0) + Number(summary.missingLineageCount ?? 0); if (issues > 0) { state = 'partial'; message = 'Có dòng chưa đủ điều kiện tính lãi gộp; hệ thống giữ riêng để đối soát, không thay bằng số 0.'; } } catch (error) { state = error instanceof CoreApiError && error.statusCode === 403 ? 'forbidden' : 'error'; message = state === 'forbidden' ? 'Tài khoản hiện tại không có quyền xem Báo cáo Lợi nhuận.' : 'Không thể tải Báo cáo Lợi nhuận.'; }
  const tone = state === 'ready' ? 'ok' : state === 'partial' ? 'partial' : state === 'forbidden' ? 'forbidden' : 'error';
  return <AdminShell activeSection="reports" title="Báo cáo Lợi nhuận" subtitle="Lãi gộp tách riêng khỏi Báo cáo Kinh doanh và chỉ đọc trên phần đã đối chiếu giá vốn." contentWidth="special">
    <Link className={styles.backLink} href="/reports/business">← Kinh doanh</Link>
    <AdminToolbar label="Kỳ Báo cáo Lợi nhuận">{reportPeriods.map((candidate) => <AdminFilterChip key={candidate} href={`/reports/profit?${new URLSearchParams({ period: candidate }).toString()}`} label={candidate} active={period === candidate} />)}</AdminToolbar>
    <AdminStatePanel title={state === 'ready' ? 'Dữ liệu giá vốn đã đối chiếu' : state === 'partial' ? 'Có dòng cần đối soát' : 'Không thể tải số liệu'} message={message} tone={tone} />
    <AdminKpiGrid label="Tổng quan Lợi nhuận" className={styles.detailKpis}>
      <AdminKpiCard label="Doanh thu thuần có thể so sánh" value={`${numberText(summary.netRevenueVnd)} VND`} note="Chỉ phần VND đủ liên kết giá vốn." />
      <AdminKpiCard label="Giá vốn" value={`${numberText(summary.cogsVnd)} VND`} note="Giá vốn canonical đã đối chiếu." />
      <AdminKpiCard label="Lãi gộp" value={`${numberText(summary.grossMarginVnd)} VND`} note="Không cộng dòng thiếu giá vốn." />
      <AdminKpiCard label="Tỷ lệ lãi gộp" value={`${numberText(summary.grossMarginPercent)}%`} note="Tính trên phần đủ điều kiện." />
    </AdminKpiGrid>
    <section className={`card ${styles.detailSection}`}><h3>Điểm cần đối soát</h3><div className={styles.detailRows}><div><span>Thiếu liên kết xuất kho</span><strong>{numberText(summary.missingLineageCount)}</strong></div><div><span>Thiếu giá vốn</span><strong>{numberText(summary.missingCostCount)}</strong></div><div><span>Giá vốn bất thường</span><strong>{numberText(summary.costAnomalyCount)}</strong></div><div><span>Dòng ngoại tệ tách riêng</span><strong>{numberText(summary.nonVndCount)}</strong></div></div></section>
  </AdminShell>;
}
