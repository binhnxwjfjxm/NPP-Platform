import Link from 'next/link';
import type { CustomerDeliveryReturnsHistory } from '../../../lib/customer-delivery-returns-gateway';
import type { CustomerProfilePeriod } from '../../../lib/customer-profile-gateway';
import styles from './customer-detail.module.css';

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

function deliveryStatusLabel(value: string) {
  return ({
    draft: 'Nháp',
    ready_to_dispatch: 'Sẵn sàng giao',
    dispatched: 'Đang giao',
    handed_over: 'Đã bàn giao',
    cancelled: 'Đã hủy',
  } as Record<string, string>)[value] ?? value;
}

function handoverModeLabel(value: string) {
  return ({ DELIVERY: 'Giao khách', PICKUP: 'Khách nhận tại kho' } as Record<string, string>)[value] ?? value;
}

function attemptResultLabel(value: string | null | undefined) {
  if (!value) return 'Chưa có kết quả';
  return ({
    delivered_full: 'Giao đủ',
    delivered_partial: 'Giao một phần',
    failed: 'Giao chưa thành công',
    rescheduled: 'Hẹn lại',
  } as Record<string, string>)[value] ?? value;
}

function returnStatusLabel(value: string) {
  return ({
    draft: 'Chờ nhận hàng trả',
    received: 'Đã nhận hàng trả',
    cancelled: 'Đã hủy',
  } as Record<string, string>)[value] ?? value;
}

function count(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function attemptSummary(item: CustomerDeliveryReturnsHistory['deliveries']['items'][number]) {
  if (!item.attempts) return 'Chưa có kết quả';
  const notes: string[] = [attemptResultLabel(item.attempts.latestResult)];
  const partial = count(item.attempts.deliveredPartialCount);
  const failed = count(item.attempts.failedCount);
  const rescheduled = count(item.attempts.rescheduledCount);
  if (partial > 0) notes.push(`${partial} lần giao một phần`);
  if (failed > 0) notes.push(`${failed} lần chưa thành công`);
  if (rescheduled > 0) notes.push(`${rescheduled} lần hẹn lại`);
  return notes.join(' · ');
}

function historyHref(
  customerId: string,
  period: CustomerProfilePeriod,
  deliveryOffset: number,
  returnOffset: number,
) {
  const query = new URLSearchParams({ tab: 'delivery-returns', period });
  if (deliveryOffset > 0) query.set('deliveryOffset', String(deliveryOffset));
  if (returnOffset > 0) query.set('returnOffset', String(returnOffset));
  return `/customers/${customerId}?${query.toString()}`;
}

export default function CustomerDeliveryReturnsSection({
  customerId,
  period,
  history,
  error,
}: Readonly<{
  customerId: string;
  period: CustomerProfilePeriod;
  history: CustomerDeliveryReturnsHistory | null;
  error: string | null;
}>) {
  return (
    <section className={styles.purchasePanel} data-testid="customer-delivery-returns">
      <div className={styles.toolbar}>
        <div className={styles.toolbarCopy}>
          <strong>Giao hàng / Trả hàng</strong>
          <span>Lịch sử giao và hàng khách trả được lấy trực tiếp từ chứng từ nghiệp vụ hiện có.</span>
        </div>
      </div>

      {error ? <div className={styles.errorBox} role="alert">{error}</div> : null}
      {!error && history ? (
        <>
          <section data-testid="customer-delivery-history">
            <div className={styles.panelHeader}>
              <h3>Lịch sử giao hàng</h3>
              <Link href="/inventory/delivery-orders">Mở màn giao nhận</Link>
            </div>
            {!history.permissions.deliveryOrders ? (
              <div className={styles.empty}>Bạn không có quyền xem chứng từ giao nhận của khách hàng này.</div>
            ) : history.deliveries.items.length > 0 ? (
              <>
                {!history.permissions.deliveryAttempts ? (
                  <div className={styles.empty}>Kết quả từng lần giao được giới hạn theo quyền của bạn.</div>
                ) : null}
                <div className={styles.tableWrap}>
                  <table className={styles.purchaseTable}>
                    <thead>
                      <tr>
                        <th>Chứng từ giao</th>
                        <th>Đơn bán</th>
                        <th>Ngày</th>
                        <th>Hình thức</th>
                        <th>Trạng thái</th>
                        <th>Kết quả giao</th>
                        <th className={styles.numeric}>Số dòng hàng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.deliveries.items.map((item) => (
                        <tr key={item.id}>
                          <td>{item.number ?? 'Chưa cấp số'}</td>
                          <td>
                            <Link href={`/sales/sales-orders?search=${encodeURIComponent(item.salesOrderNumber ?? item.salesOrderId)}`}>
                              {item.salesOrderNumber ?? 'Mở đơn bán'}
                            </Link>
                          </td>
                          <td>{formatDateTime(item.createdAt)}</td>
                          <td>{handoverModeLabel(item.handoverMode)}</td>
                          <td>{deliveryStatusLabel(item.status)}</td>
                          <td>
                            {history.permissions.deliveryAttempts ? attemptSummary(item) : 'Không có quyền xem'}
                            {history.permissions.deliveryAttempts && item.attempts?.latestAttemptAt ? (
                              <small> · {formatDateTime(item.attempts.latestAttemptAt)}</small>
                            ) : null}
                          </td>
                          <td className={styles.numeric}>{item.lineCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.pagination} aria-label="Phân trang lịch sử giao hàng">
                  <span>{`Đang xem ${history.deliveries.offset + 1}–${history.deliveries.offset + history.deliveries.items.length}`}</span>
                  <div>
                    {history.deliveries.hasPrevious ? (
                      <Link href={historyHref(customerId, period, Math.max(0, history.deliveries.offset - history.deliveries.limit), history.returns.offset)}>Trang trước</Link>
                    ) : null}
                    {history.deliveries.hasNext ? (
                      <Link href={historyHref(customerId, period, history.deliveries.offset + history.deliveries.limit, history.returns.offset)}>Trang sau</Link>
                    ) : null}
                  </div>
                </div>
              </>
            ) : <div className={styles.empty}>Khách hàng chưa có lịch sử giao hàng.</div>}
          </section>

          <section data-testid="customer-return-history">
            <div className={styles.panelHeader}>
              <h3>Hàng khách trả</h3>
              <Link href="/inventory/customer-returns">Mở màn hàng trả</Link>
            </div>
            {!history.permissions.returns ? (
              <div className={styles.empty}>Bạn không có quyền xem hàng khách trả.</div>
            ) : history.returns.items.length > 0 ? (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.purchaseTable}>
                    <thead>
                      <tr>
                        <th>Phiếu trả hàng</th>
                        <th>Ngày</th>
                        <th>Kho</th>
                        <th>Trạng thái</th>
                        <th className={styles.numeric}>Số dòng</th>
                        <th className={styles.numeric}>Đã nhận</th>
                        <th>Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.returns.items.map((item) => (
                        <tr key={item.id}>
                          <td>{item.number ?? 'Chưa cấp số'}</td>
                          <td>{formatDateTime(item.receivedAt ?? item.createdAt)}</td>
                          <td>{item.warehouseName || item.warehouseCode || '—'}</td>
                          <td>{returnStatusLabel(item.status)}</td>
                          <td className={styles.numeric}>{item.lineCount}</td>
                          <td className={styles.numeric}>{item.acceptedLineCount}</td>
                          <td>{item.cancellationReason || item.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.pagination} aria-label="Phân trang hàng khách trả">
                  <span>{`Đang xem ${history.returns.offset + 1}–${history.returns.offset + history.returns.items.length}`}</span>
                  <div>
                    {history.returns.hasPrevious ? (
                      <Link href={historyHref(customerId, period, history.deliveries.offset, Math.max(0, history.returns.offset - history.returns.limit))}>Trang trước</Link>
                    ) : null}
                    {history.returns.hasNext ? (
                      <Link href={historyHref(customerId, period, history.deliveries.offset, history.returns.offset + history.returns.limit)}>Trang sau</Link>
                    ) : null}
                  </div>
                </div>
              </>
            ) : <div className={styles.empty}>Khách hàng chưa có hàng trả.</div>}
          </section>
        </>
      ) : null}
    </section>
  );
}
