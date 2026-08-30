import Link from 'next/link';
import { AdminShell } from '../../../admin-shell';
import { AdminStatePanel } from '../../../admin-ui-primitives';
import { loadBusinessReport } from '../../business-report-data';
import styles from '../../report-center.module.css';

function text(value: unknown, fallback = ''): string { const normalized = String(value ?? '').trim(); return normalized || fallback; }
export default async function BusinessReconciliationPage({ searchParams }: { searchParams?: { period?: string } }) {
  const report = await loadBusinessReport(searchParams?.period);
  const ok = report.reconciliation.ok === true;
  return <AdminShell activeSection="reports" title="Đối soát Báo cáo Kinh doanh" subtitle="Kiểm tra tổng dòng hàng khớp tổng phiên bản đơn bán trước khi dùng số liệu." contentWidth="special">
    <Link className={styles.backLink} href={`/reports/business?${new URLSearchParams({ period: report.period }).toString()}`}>← Quay lại Kinh doanh</Link>
    <AdminStatePanel title={ok ? 'Đối soát khớp' : 'Chưa đối soát khớp'} message={ok ? `${text(report.reconciliation.checkedOrderCount, '0')} đơn đã được kiểm tra, không có chênh lệch.` : 'Không dùng báo cáo để kết luận cho tới khi chênh lệch được xử lý.'} tone={ok ? 'ok' : 'error'} />
    <section className={`card ${styles.detailSection}`}><h3>Chứng từ trong phạm vi</h3>{report.documents.length ? <div className={styles.detailRows}>{report.documents.map((row, index) => <div key={`${text(row.salesOrderId)}-${index}`}><span>{text(row.orderNumber, text(row.salesOrderId, 'Đơn chưa cấp số'))} · {text(row.customerName)}</span><strong>{text(row.totalValue)} {text(row.currencyCode)}</strong></div>)}</div> : <p>Không phát sinh chứng từ.</p>}</section>
  </AdminShell>;
}
