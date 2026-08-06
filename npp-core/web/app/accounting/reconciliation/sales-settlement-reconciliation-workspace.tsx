'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import type {
  CloseoutAnomaly,
  ReconciliationStatus,
  SalesSettlementReport,
} from '../../../lib/sales-settlement-reconciliation-types';
import styles from './sales-settlement-reconciliation-workspace.module.css';

type ApiEnvelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;
type Filters = Readonly<{ from: string; to: string; search: string; status: 'all' | ReconciliationStatus }>;

const EMPTY_FILTERS: Filters = Object.freeze({ from: '', to: '', search: '', status: 'all' });
const STATUS_LABELS: Record<string, string> = {
  matched: 'Khớp', mismatch: 'Lệch',
  draft: 'Nháp', confirmed: 'Đã xác nhận', cancelled: 'Đã hủy', closed: 'Đã đóng',
  unallocated: 'Chưa giữ hàng', partially_allocated: 'Giữ một phần', allocated: 'Đã giữ hàng',
  partially_fulfilled: 'Hoàn tất một phần', fulfilled: 'Đã hoàn tất',
  not_required: 'Không cần giao', pending: 'Đang chờ', ready_to_dispatch: 'Sẵn sàng giao',
  dispatched: 'Đang giao', partially_delivered: 'Giao một phần', delivered: 'Đã giao',
  failed: 'Giao thất bại', rescheduled: 'Hẹn giao lại', returned: 'Đã trả hàng',
  not_due: 'Chưa phát sinh nợ', partially_paid: 'Đã trả một phần', paid: 'Đã thanh toán',
  overpaid: 'Trả thừa', refunded: 'Đã hoàn tiền', written_off: 'Đã xóa nợ',
  driver_custody: 'Tài xế đang giữ', handed_over: 'Đã bàn giao', settled_non_cash: 'Đã thu chuyển khoản',
  not_collected: 'Chưa thu', reversed: 'Đã đảo', submitted: 'Chờ xác nhận',
  acceptance_reversed: 'Đã đảo xác nhận', reconciled: 'Đã khớp', discrepancy: 'Có chênh lệch',
};

function label(value: string | null | undefined) {
  const normalized = String(value ?? '');
  return STATUS_LABELS[normalized] ?? normalized.replaceAll('_', ' ');
}

function money(value: string | null | undefined, currency = 'VND') {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency', currency, maximumFractionDigits: 6,
  }).format(Number.isFinite(parsed) ? parsed : 0);
}

function dateTime(value: string | null | undefined) {
  if (!value) return 'Chưa ghi nhận';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('vi-VN');
}

function statusClass(status: string | boolean) {
  const matched = status === true || status === 'matched' || status === 'reconciled';
  return matched ? styles.matched : styles.mismatch;
}

function csvCell(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function anomalyHref(anomaly: CloseoutAnomaly) {
  if (anomaly.anomalyType === 'sales_order_status') return `/sales/sales-orders?search=${encodeURIComponent(anomaly.sourceNumber)}`;
  if (anomaly.anomalyType === 'cod_collection' || anomaly.anomalyType === 'cod_handover') return '/accounting/cod-reconciliation';
  return `/accounting/receivables?search=${encodeURIComponent(anomaly.sourceNumber)}`;
}

async function requestReport(filters: Filters): Promise<SalesSettlementReport> {
  const query = new URLSearchParams({ limit: '100' });
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.search.trim()) query.set('search', filters.search.trim());
  if (filters.status !== 'all') query.set('status', filters.status);
  const response = await fetch(`/api/accounting/reconciliation?${query}`, { method: 'GET', cache: 'no-store' });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<SalesSettlementReport>;
  if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không tải được đối soát bán hàng và COD.');
  return envelope.data;
}

export default function SalesSettlementReconciliationWorkspace() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [report, setReport] = useState<SalesSettlementReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (filters: Filters) => {
    setBusy(true);
    setError('');
    try {
      setReport(await requestReport(filters));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được đối soát bán hàng và COD.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(EMPTY_FILTERS); }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApplied(draft);
    void load(draft);
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    void load(EMPTY_FILTERS);
  }

  function exportCsv() {
    if (!report) return;
    const rows: unknown[][] = [
      ['Nhóm', 'Mã nguồn', 'Khách/Tài xế', 'Kho/Chuyến', 'Số tiền/Trạng thái', 'Kết quả'],
      ...report.customers.map((row) => ['Khách hàng', row.customerCode, row.customerName, row.warehouseCode, row.calculatedOpenBalance, row.reconciliationStatus]),
      ...report.documents.map((row) => ['Chứng từ', row.sourceDocumentNumber, row.customerNameSnapshot, row.warehouseCodeSnapshot, row.projectedRemainingAmount, row.reconciliationStatus]),
      ...report.orders.map((row) => ['Đơn bán hàng', row.orderNumber ?? row.salesOrderId, row.customerName, row.warehouseCode, row.settlementStatus, row.reconciliationStatus]),
      ...report.codCollections.map((row) => ['Thu COD', row.deliveryOrderNumber ?? row.collectionId, row.driverName, row.tripNumber, row.custodyRemainingAmount, row.lifecycleMatches ? 'matched' : 'mismatch']),
      ...report.codHandovers.map((row) => ['Bàn giao COD', row.handoverId, row.driverName, row.tripNumber, row.claimedAmount, row.lifecycleMatches ? 'matched' : 'mismatch']),
      ...report.anomalies.map((row) => ['Bất thường', row.sourceNumber, row.anomalyType, row.warehouseId, JSON.stringify(row.details), row.reconciliationStatus]),
    ];
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `doi-soat-ban-hang-cod-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const activeFilterText = useMemo(() => {
    const parts = [applied.from && `từ ${applied.from}`, applied.to && `đến ${applied.to}`, applied.search && `“${applied.search}”`, applied.status !== 'all' && label(applied.status)].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Toàn bộ dữ liệu trong phạm vi kho được cấp';
  }, [applied]);

  const summary = report?.summary;

  return (
    <AppShell
      kicker="Kế toán bán hàng"
      title="Đối soát bán hàng & COD"
      subtitle="Đối chiếu riêng trạng thái đơn, giao hàng, công nợ, tiền thu và tiền COD; mọi số tổng hợp đều mở được về nguồn gốc."
      actions={(
        <div className={styles.headerActions}>
          <Link className={styles.headerLink} href="/accounting/receivables">Công nợ phải thu</Link>
          <Link className={styles.headerLink} href="/accounting/cod-reconciliation">Đối soát COD</Link>
        </div>
      )}
    >
      <div className={styles.workspace} data-testid="sales-settlement-reconciliation-workspace">
        <form className={styles.filters} onSubmit={applyFilters} aria-label="Bộ lọc đối soát">
          <div className={styles.filterHeading}>
            <div><p className={styles.eyebrow}>Phạm vi báo cáo</p><h2>Lọc dữ liệu đối soát</h2></div>
            <small>{activeFilterText}</small>
          </div>
          <div className={styles.filterGrid}>
            <label>Từ ngày<input type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} /></label>
            <label>Đến ngày<input type="date" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} /></label>
            <label className={styles.searchField}>Khách, chứng từ, chuyến hoặc tài xế<input type="search" maxLength={160} placeholder="Nhập mã hoặc tên" value={draft.search} onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))} /></label>
            <label>Kết quả<select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as Filters['status'] }))}><option value="all">Tất cả</option><option value="matched">Chỉ số khớp</option><option value="mismatch">Chỉ số lệch</option></select></label>
          </div>
          <div className={styles.filterActions}>
            <button className={styles.secondaryButton} type="button" onClick={resetFilters} disabled={busy}>Đặt lại</button>
            <button className={styles.secondaryButton} type="button" onClick={exportCsv} disabled={busy || !report}>Xuất CSV</button>
            <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? 'Đang tải…' : 'Áp dụng'}</button>
          </div>
        </form>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        <section className={styles.summaryGrid} aria-label="Tổng hợp đối soát">
          <article><span>Dư nợ đang mở</span><strong>{money(summary?.debitOutstandingAmount)}</strong><small>{summary?.customerGroupCount ?? '0'} nhóm khách/kho</small></article>
          <article><span>Credit chưa dùng</span><strong>{money(summary?.unappliedCreditAmount)}</strong><small>Số dư có thể phân bổ/hoàn</small></article>
          <article><span>COD tài xế đang giữ</span><strong>{money(summary?.codCustodyAmount)}</strong><small>Chưa vào bàn giao hiệu lực</small></article>
          <article><span>COD chờ kế toán nhận</span><strong>{money(summary?.codPendingAcceptanceAmount)}</strong><small>Đã bàn giao, chưa xác nhận</small></article>
          <article><span>COD công ty đã nhận</span><strong>{money(summary?.codAcceptedAmount)}</strong><small>Chênh lệch: {money(summary?.codVarianceAmount)}</small></article>
          <article className={Number(summary?.anomalyCount ?? 0) > 0 ? styles.alertCard : ''}><span>Bất thường cần xử lý</span><strong>{summary?.anomalyCount ?? '0'}</strong><small>Không tự sửa số liệu</small></article>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Theo khách và kho</p><h2>Số dư công nợ giải thích được</h2></div><span>{report?.customers.length ?? 0} dòng</span></div>
          <div className={styles.tableWrap}><table><thead><tr><th>Khách hàng / kho</th><th>Đã ghi nợ</th><th>Còn phải thu</th><th>Credit chưa dùng</th><th>Số dư tính lại</th><th>Sổ ledger</th><th>Kết quả</th></tr></thead><tbody>
            {report?.customers.map((row) => <tr key={`${row.customerId}-${row.warehouseId}-${row.currencyCode}`}><td><Link href={`/accounting/receivables?search=${encodeURIComponent(row.customerCode)}`}><strong>{row.customerCode} · {row.customerName}</strong></Link><small>{row.warehouseCode} · cập nhật {row.latestDocumentDate ?? 'chưa có ngày'}</small></td><td>{money(row.debitPostedAmount, row.currencyCode)}</td><td>{money(row.debitOutstandingAmount, row.currencyCode)}</td><td>{money(row.unappliedCreditAmount, row.currencyCode)}</td><td>{money(row.calculatedOpenBalance, row.currencyCode)}</td><td>{money(row.ledgerBalance, row.currencyCode)}</td><td><span className={`${styles.status} ${statusClass(row.reconciliationStatus)}`}>{label(row.reconciliationStatus)}</span></td></tr>)}
            {!report?.customers.length && !busy ? <tr><td colSpan={7} className={styles.empty}>Không có số dư trong phạm vi lọc.</td></tr> : null}
          </tbody></table></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Bốn trục độc lập</p><h2>Trạng thái đơn, hàng, giao và tiền</h2></div><span>{report?.orders.length ?? 0} đơn</span></div>
          <div className={styles.tableWrap}><table><thead><tr><th>Đơn / khách</th><th>Đơn hàng</th><th>Chuẩn bị hàng</th><th>Giao hàng</th><th>Thanh toán</th><th>Còn phải thu</th><th>COD đang giữ</th><th>Kết quả</th></tr></thead><tbody>
            {report?.orders.map((row) => <tr key={row.salesOrderId}><td><Link href={`/sales/sales-orders?search=${encodeURIComponent(row.orderNumber ?? row.salesOrderId)}`}><strong>{row.orderNumber ?? row.salesOrderId.slice(0, 8)}</strong></Link><small>{row.customerCode} · {row.customerName}<br />{row.warehouseCode}</small></td><td>{label(row.orderStatus)}</td><td>{label(row.fulfillmentStatus)}</td><td>{label(row.deliveryStatus)}</td><td><strong>{label(row.settlementStatus)}</strong><small>Tính lại: {label(row.calculatedSettlementStatus)}</small></td><td>{money(row.receivableRemainingAmount, row.currencyCode)}</td><td>{money(row.codCustodyAmount, row.currencyCode)}</td><td><span className={`${styles.status} ${statusClass(row.reconciliationStatus)}`}>{label(row.reconciliationStatus)}</span></td></tr>)}
            {!report?.orders.length && !busy ? <tr><td colSpan={8} className={styles.empty}>Không có đơn bán hàng trong phạm vi lọc.</td></tr> : null}
          </tbody></table></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Chứng từ và ledger</p><h2>Posting, phân bổ và số dư còn lại</h2></div><span>{report?.documents.length ?? 0} chứng từ</span></div>
          <div className={styles.tableWrap}><table><thead><tr><th>Chứng từ / khách</th><th>Loại</th><th>Giá trị gốc</th><th>Đã phân bổ</th><th>Còn lại</th><th>Ledger</th><th>Kết quả</th></tr></thead><tbody>
            {report?.documents.map((row) => <tr key={row.id}><td><Link href={`/accounting/receivables?search=${encodeURIComponent(row.sourceDocumentNumber)}`}><strong>{row.sourceDocumentNumber}</strong></Link><small>{row.sourceDocumentDate} · {row.customerCodeSnapshot} · {row.customerNameSnapshot}</small></td><td>{label(row.documentType)}<small>{row.direction} · {label(row.documentStatus)}</small></td><td>{money(row.originalAmount, row.currencyCode)}</td><td>{money(row.projectedAllocatedAmount, row.currencyCode)}</td><td>{money(row.projectedRemainingAmount, row.currencyCode)}</td><td>{money(row.ledgerAmount, row.currencyCode)}<small>Kỳ vọng {money(row.expectedLedgerAmount, row.currencyCode)}</small></td><td><span className={`${styles.status} ${statusClass(row.reconciliationStatus)}`}>{label(row.reconciliationStatus)}</span></td></tr>)}
            {!report?.documents.length && !busy ? <tr><td colSpan={7} className={styles.empty}>Không có chứng từ trong phạm vi lọc.</td></tr> : null}
          </tbody></table></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Vòng đời tiền mặt</p><h2>Thu COD và bàn giao cuối chuyến</h2></div><Link className={styles.inlineLink} href="/accounting/cod-reconciliation">Mở nghiệp vụ COD</Link></div>
          <h3 className={styles.subheading}>Khoản tài xế đã ghi nhận</h3>
          <div className={styles.tableWrap}><table><thead><tr><th>Phiếu / khách</th><th>Chuyến / tài xế</th><th>Phương thức</th><th>Đã thu</th><th>Đã bàn giao</th><th>Còn tài xế giữ</th><th>Vòng đời</th></tr></thead><tbody>
            {report?.codCollections.map((row) => <tr key={row.collectionId}><td><Link href="/accounting/cod-reconciliation"><strong>{row.deliveryOrderNumber ?? row.collectionId.slice(0, 8)}</strong></Link><small>{row.customerCode} · {row.customerName}</small></td><td><Link href={`/logistics/trip-reconciliation?search=${encodeURIComponent(row.tripNumber)}`}>{row.tripNumber}</Link><small>{row.driverCode} · {row.driverName}</small></td><td>{label(row.collectionMethod)}<small>{label(row.collectionStatus)}</small></td><td>{money(row.receivedAmount, row.currencyCode)}</td><td>{money(row.handedOverAmount, row.currencyCode)}</td><td>{money(row.custodyRemainingAmount, row.currencyCode)}</td><td><span className={`${styles.status} ${statusClass(row.lifecycleMatches)}`}>{label(row.lifecycleStatus)}</span></td></tr>)}
            {!report?.codCollections.length && !busy ? <tr><td colSpan={7} className={styles.empty}>Không có khoản thu COD trong phạm vi lọc.</td></tr> : null}
          </tbody></table></div>

          <h3 className={styles.subheading}>Bàn giao và xác nhận của kế toán</h3>
          <div className={styles.tableWrap}><table><thead><tr><th>Chuyến / tài xế</th><th>Tiền khai bàn giao</th><th>Chờ xác nhận</th><th>Công ty đã nhận</th><th>Chênh lệch</th><th>Trạng thái</th><th>Kết quả</th></tr></thead><tbody>
            {report?.codHandovers.map((row) => <tr key={row.handoverId}><td><Link href="/accounting/cod-reconciliation"><strong>{row.tripNumber}</strong></Link><small>{row.driverCode} · {row.driverName}<br />{dateTime(row.handedOverAt)}</small></td><td>{money(row.claimedAmount)}</td><td>{money(row.pendingAcceptanceAmount)}</td><td>{money(row.acceptedAmount)}</td><td>{money(row.varianceAmount)}</td><td>{label(row.projectionStatus)}</td><td><span className={`${styles.status} ${statusClass(row.lifecycleMatches)}`}>{row.lifecycleMatches ? 'Khớp' : 'Lệch'}</span></td></tr>)}
            {!report?.codHandovers.length && !busy ? <tr><td colSpan={7} className={styles.empty}>Không có bàn giao COD trong phạm vi lọc.</td></tr> : null}
          </tbody></table></div>
        </section>

        <section className={styles.panel} data-testid="phase6f-closeout-anomalies">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Gate đóng Phase 6F</p><h2>Bất thường cần truy về nguồn</h2></div><span className={`${styles.status} ${report?.anomalies.length ? styles.mismatch : styles.matched}`}>{report?.anomalies.length ? `${report.anomalies.length} lỗi` : 'Không có lỗi'}</span></div>
          {report?.anomalies.length ? <div className={styles.anomalyList}>{report.anomalies.map((row) => <article key={`${row.anomalyType}-${row.sourceId}-${row.warehouseId}`}><div><strong>{label(row.anomalyType)}</strong><Link href={anomalyHref(row)}>{row.sourceNumber}</Link></div><pre>{JSON.stringify(row.details, null, 2)}</pre></article>)}</div> : <p className={styles.cleanState}>Các projection, ledger, allocation và vòng đời COD trong phạm vi kho hiện đang khớp.</p>}
        </section>
      </div>
    </AppShell>
  );
}
