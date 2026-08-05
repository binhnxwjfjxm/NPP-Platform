import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import {
  getReceivable,
  listReceivableBalances,
  listReceivables,
  resolveReceivableRequestId,
} from '../../../lib/receivable-gateway';
import type {
  CustomerReceivableBalance,
  ReceivableDocument,
} from '../../../lib/receivable-types';
import styles from './receivables.module.css';

export const dynamic = 'force-dynamic';

type PageProps = { searchParams?: Record<string, string | string[] | undefined> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function money(value: string, currencyCode = 'VND') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${value} ${currencyCode}`;
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: currencyCode === 'VND' ? 0 : 2,
    maximumFractionDigits: 6,
  }).format(numeric);
}

function statusLabel(status: ReceivableDocument['status']) {
  return {
    open: 'Còn phải thu',
    partially_allocated: 'Đã thu một phần',
    settled: 'Đã tất toán',
    reversed: 'Đã đảo',
  }[status];
}

function sourceLabel(source: ReceivableDocument['sourceDocumentType']) {
  return source === 'PICKUP_HANDOVER' ? 'Nhận tại quầy' : 'Giao hàng';
}

export default async function ReceivablesPage({ searchParams }: PageProps) {
  const requestId = resolveReceivableRequestId(null);
  const selectedId = first(searchParams?.id);
  const [documentsResult, balancesResult, detailResult] = await Promise.allSettled([
    listReceivables<ReceivableDocument>(requestId, { limit: 1000 }),
    listReceivableBalances<CustomerReceivableBalance>(requestId, { limit: 1000 }),
    selectedId
      ? getReceivable<ReceivableDocument>(selectedId, requestId)
      : Promise.resolve(null),
  ]);
  const documents = documentsResult.status === 'fulfilled' ? documentsResult.value : [];
  const balances = balancesResult.status === 'fulfilled' ? balancesResult.value : [];
  const detail = detailResult.status === 'fulfilled' ? detailResult.value : null;
  const error = documentsResult.status === 'rejected' || balancesResult.status === 'rejected'
    ? 'Không tải được đầy đủ dữ liệu công nợ khách hàng. Hãy thử tải lại trang.'
    : detailResult.status === 'rejected'
      ? 'Không tải được chi tiết chứng từ công nợ đã chọn.'
      : null;
  const vndBalances = balances.filter((item) => item.currencyCode === 'VND');
  const totalBalance = vndBalances.reduce((sum, item) => sum + Number(item.balance || 0), 0);
  const totalOpen = vndBalances.reduce((sum, item) => sum + Number(item.openAmount || 0), 0);
  const openDocuments = documents.filter(
    (item) => item.status === 'open' || item.status === 'partially_allocated',
  ).length;

  return (
    <AppShell
      title="Công nợ khách hàng"
      subtitle="Xem số tiền khách còn nợ và lần giao hàng hoặc nhận tại quầy đã phát sinh khoản nợ."
      kicker="Kế toán bán hàng"
    >
      <div className={styles.grid} data-testid="receivables-page">
        {error ? <div className={styles.alert} role="alert">{error}</div> : null}

        <section className={styles.summaryGrid} aria-label="Tổng hợp công nợ khách hàng">
          <article className={styles.card}>
            <span className={styles.muted}>Số dư phải thu (VND)</span>
            <p className={styles.value} data-testid="receivable-total-balance">
              {money(String(totalBalance))}
            </p>
          </article>
          <article className={styles.card}>
            <span className={styles.muted}>Còn mở (VND)</span>
            <p className={styles.value}>{money(String(totalOpen))}</p>
          </article>
          <article className={styles.card}>
            <span className={styles.muted}>Chứng từ còn phải thu</span>
            <p className={styles.value}>{openDocuments}</p>
          </article>
        </section>

        <section className={styles.card}>
          <h2>Số dư theo khách hàng</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="receivable-balances-table">
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Tiền tệ</th>
                  <th className={styles.amount}>Số dư</th>
                  <th className={styles.amount}>Còn mở</th>
                  <th className={styles.amount}>Số chứng từ</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((item) => (
                  <tr key={`${item.customerId}-${item.currencyCode}`}>
                    <td>
                      <strong>{item.customerCode}</strong><br />
                      <span className={styles.muted}>{item.customerName}</span>
                    </td>
                    <td>{item.currencyCode}</td>
                    <td className={styles.amount}>{money(item.balance, item.currencyCode)}</td>
                    <td className={styles.amount}>{money(item.openAmount, item.currencyCode)}</td>
                    <td className={styles.amount}>{item.openDocumentCount}</td>
                  </tr>
                ))}
                {!balances.length ? (
                  <tr><td colSpan={5} className={styles.muted}>Chưa có số dư công nợ khách hàng.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.card}>
          <h2>Chứng từ phát sinh công nợ</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="receivables-table">
              <thead>
                <tr>
                  <th>Nguồn phát sinh</th>
                  <th>Khách hàng</th>
                  <th>Đơn bán / Phiếu giao</th>
                  <th>Kho</th>
                  <th>Trạng thái</th>
                  <th className={styles.amount}>Giá trị</th>
                  <th className={styles.amount}>Còn phải thu</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link className={styles.link} href={`/accounting/receivables?id=${item.id}`}>
                        {sourceLabel(item.sourceDocumentType)}
                      </Link><br />
                      <span className={styles.muted}>{item.sourceDocumentDate}</span>
                    </td>
                    <td>{item.customerCode}<br /><span className={styles.muted}>{item.customerName}</span></td>
                    <td>{item.salesOrderNumber ?? '—'}<br /><span className={styles.muted}>{item.deliveryOrderNumber ?? item.sourceDocumentNumber}</span></td>
                    <td>{item.warehouseCode}<br /><span className={styles.muted}>{item.warehouseName}</span></td>
                    <td><span className={styles.badge}>{statusLabel(item.status)}</span></td>
                    <td className={`${styles.amount} ${styles.debit}`}>{money(item.originalAmount, item.currencyCode)}</td>
                    <td className={styles.amount}>{money(item.remainingAmount, item.currencyCode)}</td>
                  </tr>
                ))}
                {!documents.length ? (
                  <tr><td colSpan={7} className={styles.muted}>Chưa phát sinh chứng từ công nợ khách hàng.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {detail ? (
          <section className={styles.card} data-testid="receivable-detail">
            <Link className={`${styles.link} ${styles.back}`} href="/accounting/receivables">
              ← Đóng chi tiết
            </Link>
            <h2>{sourceLabel(detail.sourceDocumentType)} · {detail.deliveryOrderNumber ?? detail.sourceDocumentNumber}</h2>
            <div className={styles.detailGrid}>
              <div className={styles.detailItem}>
                <span className={styles.muted}>Khách hàng</span>
                <strong>{detail.customerCode} · {detail.customerName}</strong>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.muted}>Đơn bán hàng</span>
                <strong>{detail.salesOrderNumber ?? detail.salesOrderId}</strong>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.muted}>Giá trị phát sinh</span>
                <strong>{money(detail.originalAmount, detail.currencyCode)}</strong>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.muted}>Còn phải thu</span>
                <strong>{money(detail.remainingAmount, detail.currencyCode)}</strong>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.muted}>Chính sách thu tiền</span>
                <strong>{detail.collectionPolicy}</strong>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.muted}>Trạng thái</span>
                <strong>{statusLabel(detail.status)}</strong>
              </div>
            </div>

            <h3>Hàng khách đã nhận</h3>
            <div className={styles.tableWrap}>
              <table className={styles.table} data-testid="receivable-lines-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Hàng hóa</th>
                    <th className={styles.amount}>Số lượng nhận</th>
                    <th className={styles.amount}>Tiền hàng</th>
                    <th className={styles.amount}>Giảm giá</th>
                    <th className={styles.amount}>Thuế</th>
                    <th className={styles.amount}>Phải thu</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.sku}</td>
                      <td>{line.itemName}</td>
                      <td className={styles.amount}>{line.acceptedBaseQuantity} {line.unitCode}</td>
                      <td className={styles.amount}>{money(line.grossAmount, detail.currencyCode)}</td>
                      <td className={styles.amount}>{money(line.discountAmount, detail.currencyCode)}</td>
                      <td className={styles.amount}>{money(line.taxAmount, detail.currencyCode)}</td>
                      <td className={styles.amount}>{money(line.lineAmount, detail.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>Sổ chi tiết</h3>
            <div className={styles.tableWrap}>
              <table className={styles.table} data-testid="receivable-ledger-table">
                <thead>
                  <tr>
                    <th>Thời điểm</th>
                    <th>Loại bút toán</th>
                    <th>Nguồn</th>
                    <th>Yêu cầu</th>
                    <th className={styles.amount}>Số tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.ledgerEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.occurredAt}</td>
                      <td>{entry.entryType}</td>
                      <td>{sourceLabel(detail.sourceDocumentType)}</td>
                      <td>{entry.requestId}</td>
                      <td className={styles.amount}>{money(entry.amount, detail.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
