import Link from 'next/link';
import type { CustomerPayment } from '../../../lib/customer-payment-types';
import type { CustomerReceivableSummary, CustomerProfilePeriod } from '../../../lib/customer-profile-gateway';
import type { ReceivableDocument } from '../../../lib/receivable-types';
import type { SalesOrder } from '../../../lib/sales-order-types';
import styles from './customer-detail.module.css';

export type CustomerOrderListItem = SalesOrder & Readonly<{ total?: string }>;

export type CustomerOrdersHistory = Readonly<{
  items: readonly CustomerOrderListItem[];
  search: string;
  offset: number;
  limit: number;
  hasPrevious: boolean;
  hasNext: boolean;
}>;

export type CustomerFinanceHistory = Readonly<{
  receivableAllowed: boolean;
  receivables: readonly ReceivableDocument[];
  receivableOffset: number;
  receivableLimit: number;
  receivableHasPrevious: boolean;
  receivableHasNext: boolean;
  receivableError: string | null;
  paymentAccess: 'allowed' | 'forbidden' | 'error';
  payments: readonly CustomerPayment[];
  paymentOffset: number;
  paymentLimit: number;
  paymentHasPrevious: boolean;
  paymentHasNext: boolean;
  paymentError: string | null;
}>;

function formatVnd(value: string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(numeric)
    : '—';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa có';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

function orderStatusLabel(value: string) {
  return ({
    draft: 'Nháp',
    confirmed: 'Đã chốt',
    closed: 'Hoàn thành',
    cancelled: 'Đã hủy',
  } as Record<string, string>)[value] ?? value;
}

function deliveryStatusLabel(value: string) {
  return ({
    pending: 'Chưa giao',
    not_required: 'Không cần giao',
    ready_to_dispatch: 'Sẵn sàng giao',
    dispatched: 'Đang giao',
    partially_delivered: 'Giao một phần',
    delivered: 'Đã giao',
    rescheduled: 'Hẹn lại',
    failed: 'Giao chưa thành công',
    returned: 'Đã trả hàng',
    cancelled: 'Đã hủy',
  } as Record<string, string>)[value] ?? value;
}

function settlementStatusLabel(value: string) {
  return ({
    not_due: 'Chưa đến hạn',
    pending: 'Chưa thanh toán',
    partially_paid: 'Đã thanh toán một phần',
    paid: 'Đã thanh toán',
    overpaid: 'Thu thừa',
    refunded: 'Đã hoàn tiền',
    written_off: 'Đã xử lý công nợ',
  } as Record<string, string>)[value] ?? value;
}

function receivableStatusLabel(value: ReceivableDocument['status']) {
  return {
    open: 'Còn phải thu',
    partially_allocated: 'Đã thu một phần',
    settled: 'Đã thu đủ',
    reversed: 'Đã hủy',
  }[value];
}

function paymentStatusLabel(value: CustomerPayment['status']) {
  return {
    open: 'Chưa phân bổ',
    partially_allocated: 'Đã phân bổ một phần',
    settled: 'Đã phân bổ đủ',
    reversed: 'Đã hủy',
  }[value];
}

function paymentMethodLabel(value: string) {
  return ({ CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản' } as Record<string, string>)[value] ?? value;
}

function ordersHref(customerId: string, period: CustomerProfilePeriod, search: string, offset: number) {
  const query = new URLSearchParams({ tab: 'orders', period });
  if (search.trim()) query.set('search', search.trim());
  if (offset > 0) query.set('offset', String(offset));
  return `/customers/${customerId}?${query.toString()}`;
}

function financeHref(
  customerId: string,
  period: CustomerProfilePeriod,
  receivableOffset: number,
  paymentOffset: number,
) {
  const query = new URLSearchParams({ tab: 'finance', period });
  if (receivableOffset > 0) query.set('debtOffset', String(receivableOffset));
  if (paymentOffset > 0) query.set('paymentOffset', String(paymentOffset));
  return `/customers/${customerId}?${query.toString()}`;
}

export function CustomerOrdersSection({
  customerId,
  period,
  allowed,
  history,
  error,
}: Readonly<{
  customerId: string;
  period: CustomerProfilePeriod;
  allowed: boolean;
  history: CustomerOrdersHistory | null;
  error: string | null;
}>) {
  return (
    <section className={styles.purchasePanel} data-testid="customer-orders">
      <div className={styles.toolbar}>
        <div className={styles.toolbarCopy}>
          <strong>Đơn hàng</strong>
          <span>Lịch sử đơn bán của đúng khách hàng, tải theo từng trang.</span>
        </div>
      </div>

      {!allowed ? <div className={styles.empty}>Bạn không có quyền xem đơn hàng của khách hàng này.</div> : null}
      {allowed ? (
        <>
          <form className={styles.purchaseFilters} method="get">
            <input type="hidden" name="tab" value="orders" />
            <input type="hidden" name="period" value={period} />
            <label className={styles.searchField}>
              <span>Tìm đơn hàng</span>
              <input name="search" defaultValue={history?.search ?? ''} placeholder="Số đơn" maxLength={120} />
            </label>
            <button type="submit">Tìm</button>
            {history?.search ? <Link href={ordersHref(customerId, period, '', 0)}>Xóa tìm kiếm</Link> : null}
          </form>

          {error ? <div className={styles.errorBox} role="alert">{error}</div> : null}
          {!error && history ? (
            <>
              {history.items.length > 0 ? (
                <div className={styles.tableWrap}>
                  <table className={styles.purchaseTable}>
                    <thead>
                      <tr>
                        <th>Số đơn</th>
                        <th>Ngày</th>
                        <th className={styles.numeric}>Tổng tiền</th>
                        <th>Trạng thái</th>
                        <th>Thanh toán</th>
                        <th>Giao hàng</th>
                        <th className={styles.numeric}>Còn phải thu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.items.map((order) => (
                        <tr key={order.id}>
                          <td>
                            <Link href={`/sales/sales-orders?search=${encodeURIComponent(order.number ?? order.id)}`}>
                              {order.number ?? 'Chưa cấp số'}
                            </Link>
                          </td>
                          <td>{formatDateTime(order.confirmedAt ?? order.createdAt)}</td>
                          <td className={styles.numeric}>{formatVnd(order.total)}</td>
                          <td>{orderStatusLabel(order.status)}</td>
                          <td>{settlementStatusLabel(order.settlementStatus)}</td>
                          <td>{deliveryStatusLabel(order.deliveryStatus)}</td>
                          <td className={styles.numeric}>{formatVnd(order.receivableRemainingAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className={styles.empty}>Khách hàng chưa có đơn hàng phù hợp.</div>}

              <div className={styles.pagination} aria-label="Phân trang đơn hàng khách hàng">
                <span>{history.items.length > 0 ? `Đang xem ${history.offset + 1}–${history.offset + history.items.length}` : 'Không có dữ liệu'}</span>
                <div>
                  {history.hasPrevious ? (
                    <Link href={ordersHref(customerId, period, history.search, Math.max(0, history.offset - history.limit))}>Trang trước</Link>
                  ) : null}
                  {history.hasNext ? (
                    <Link href={ordersHref(customerId, period, history.search, history.offset + history.limit)}>Trang sau</Link>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function CustomerFinanceSection({
  customerId,
  period,
  summary,
  history,
}: Readonly<{
  customerId: string;
  period: CustomerProfilePeriod;
  summary: CustomerReceivableSummary | null;
  history: CustomerFinanceHistory;
}>) {
  return (
    <section className={styles.purchasePanel} data-testid="customer-finance">
      <div className={styles.toolbar}>
        <div className={styles.toolbarCopy}>
          <strong>Công nợ &amp; thanh toán</strong>
          <span>Chứng từ phải thu và phiếu thu được lấy từ nguồn kế toán hiện có.</span>
        </div>
      </div>

      {history.receivableAllowed && summary ? (
        <section className={styles.summaryGrid} aria-label="Tổng hợp công nợ khách hàng">
          <article className={styles.summaryCard}><span>Công nợ hiện tại</span><strong>{formatVnd(summary.balance)}</strong></article>
          <article className={styles.summaryCard}><span>Còn phải thu</span><strong>{formatVnd(summary.openAmount)}</strong></article>
          <article className={styles.summaryCard}><span>Chứng từ còn mở</span><strong>{summary.openDocumentCount}</strong></article>
        </section>
      ) : null}

      <section data-testid="customer-receivable-documents">
        <div className={styles.panelHeader}><h3>Chứng từ công nợ</h3><Link href="/accounting/receivables">Mở màn công nợ</Link></div>
        {!history.receivableAllowed ? <div className={styles.empty}>Bạn không có quyền xem công nợ của khách hàng này.</div> : null}
        {history.receivableError ? <div className={styles.errorBox} role="alert">{history.receivableError}</div> : null}
        {history.receivableAllowed && !history.receivableError ? (
          history.receivables.length > 0 ? (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.purchaseTable}>
                  <thead><tr><th>Chứng từ</th><th>Ngày</th><th className={styles.numeric}>Giá trị</th><th className={styles.numeric}>Đã thu / phân bổ</th><th className={styles.numeric}>Còn phải thu</th><th>Trạng thái</th></tr></thead>
                  <tbody>
                    {history.receivables.map((item) => (
                      <tr key={item.id}>
                        <td><Link href={`/accounting/receivables?id=${encodeURIComponent(item.id)}`}>{item.sourceDocumentNumber}</Link></td>
                        <td>{formatDateTime(item.sourceDocumentDate)}</td>
                        <td className={styles.numeric}>{formatVnd(item.originalAmount)}</td>
                        <td className={styles.numeric}>{formatVnd(item.allocatedAmount)}</td>
                        <td className={styles.numeric}>{formatVnd(item.remainingAmount)}</td>
                        <td>{receivableStatusLabel(item.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.pagination} aria-label="Phân trang chứng từ công nợ">
                <span>{`Đang xem ${history.receivableOffset + 1}–${history.receivableOffset + history.receivables.length}`}</span>
                <div>
                  {history.receivableHasPrevious ? <Link href={financeHref(customerId, period, Math.max(0, history.receivableOffset - history.receivableLimit), history.paymentOffset)}>Trang trước</Link> : null}
                  {history.receivableHasNext ? <Link href={financeHref(customerId, period, history.receivableOffset + history.receivableLimit, history.paymentOffset)}>Trang sau</Link> : null}
                </div>
              </div>
            </>
          ) : <div className={styles.empty}>Khách hàng chưa có chứng từ công nợ.</div>
        ) : null}
      </section>

      <section data-testid="customer-payments">
        <div className={styles.panelHeader}><h3>Lịch sử thu tiền</h3><Link href="/accounting/customer-payments">Mở màn thu tiền</Link></div>
        {history.paymentAccess === 'forbidden' ? <div className={styles.empty}>Bạn không có quyền xem lịch sử thu tiền của khách hàng này.</div> : null}
        {history.paymentError ? <div className={styles.errorBox} role="alert">{history.paymentError}</div> : null}
        {history.paymentAccess === 'allowed' && !history.paymentError ? (
          history.payments.length > 0 ? (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.purchaseTable}>
                  <thead><tr><th>Phiếu thu</th><th>Ngày thu</th><th>Hình thức</th><th className={styles.numeric}>Số tiền</th><th className={styles.numeric}>Đã phân bổ</th><th className={styles.numeric}>Chưa phân bổ</th><th>Trạng thái</th></tr></thead>
                  <tbody>
                    {history.payments.map((item) => (
                      <tr key={item.id}>
                        <td>{item.documentNumber}</td>
                        <td>{formatDateTime(item.paymentDate)}</td>
                        <td>{paymentMethodLabel(item.paymentMethod)}</td>
                        <td className={styles.numeric}>{formatVnd(item.originalAmount)}</td>
                        <td className={styles.numeric}>{formatVnd(item.allocatedAmount)}</td>
                        <td className={styles.numeric}>{formatVnd(item.remainingAmount)}</td>
                        <td>{paymentStatusLabel(item.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.pagination} aria-label="Phân trang lịch sử thu tiền">
                <span>{`Đang xem ${history.paymentOffset + 1}–${history.paymentOffset + history.payments.length}`}</span>
                <div>
                  {history.paymentHasPrevious ? <Link href={financeHref(customerId, period, history.receivableOffset, Math.max(0, history.paymentOffset - history.paymentLimit))}>Trang trước</Link> : null}
                  {history.paymentHasNext ? <Link href={financeHref(customerId, period, history.receivableOffset, history.paymentOffset + history.paymentLimit)}>Trang sau</Link> : null}
                </div>
              </div>
            </>
          ) : <div className={styles.empty}>Khách hàng chưa có phiếu thu.</div>
        ) : null}
      </section>
    </section>
  );
}
