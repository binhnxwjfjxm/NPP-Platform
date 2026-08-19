'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { SalesOrder } from '../../../lib/sales-order-types';
import { activeVersion, apiRequest, formatMoney, mutationKey } from './sales-order-ui';
import styles from './sales-orders.module.css';

type StableMutation = {
  orderId: string;
  fingerprint: string;
  key: string;
};

function stableKey(
  ref: MutableRefObject<StableMutation | null>,
  orderId: string,
  fingerprint: string,
  prefix: string,
) {
  const current = ref.current;
  if (current?.orderId === orderId && current.fingerprint === fingerprint) return current.key;
  const key = mutationKey(prefix);
  ref.current = { orderId, fingerprint, key };
  return key;
}

export default function ManualSalesOrderSettlement({
  order,
  canComplete,
  canSettle,
  onUpdated,
}: {
  order: SalesOrder;
  canComplete: boolean;
  canSettle: boolean;
  onUpdated: (order: SalesOrder) => void;
}) {
  const [paidAmount, setPaidAmount] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [busy, setBusy] = useState<'complete' | 'settlement' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const completeKeyRef = useRef<StableMutation | null>(null);
  const settlementKeyRef = useRef<StableMutation | null>(null);
  const currentVersion = activeVersion(order);

  useEffect(() => {
    setPaidAmount('0');
    setPaymentMethod('CASH');
    setNotice(null);
    setError(null);
    completeKeyRef.current = null;
    settlementKeyRef.current = null;
  }, [order.id]);

  const completionAvailable = order.status === 'confirmed';
  const settlementAvailable = order.status === 'closed'
    && ['pending', 'partially_paid'].includes(order.settlementStatus);

  async function completeOrder() {
    const fingerprint = String(order.revision);
    setBusy('complete');
    setNotice(null);
    setError(null);
    try {
      const updated = await apiRequest<SalesOrder>(`/api/manual-sales-orders/${order.id}/complete`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': stableKey(
            completeKeyRef,
            order.id,
            fingerprint,
            'manual-order-complete',
          ),
        },
        body: JSON.stringify({ expectedRevision: order.revision }),
      });
      completeKeyRef.current = null;
      onUpdated(updated);
      setNotice('Đã hoàn thành đơn. Doanh số và khoản phải thu đã được ghi nhận; tiền thu được theo dõi riêng.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không hoàn thành đơn được');
    } finally {
      setBusy(null);
    }
  }

  async function recordSettlement() {
    const normalizedAmount = paidAmount.trim();
    const debtOnly = /^0(?:\.0+)?$/.test(normalizedAmount);
    const fingerprint = `${order.revision}|${normalizedAmount}|${paymentMethod}`;
    setBusy('settlement');
    setNotice(null);
    setError(null);
    try {
      const updated = await apiRequest<SalesOrder>(`/api/manual-sales-orders/${order.id}/settlement`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': stableKey(
            settlementKeyRef,
            order.id,
            fingerprint,
            'manual-order-settlement',
          ),
        },
        body: JSON.stringify({
          expectedRevision: order.revision,
          paidAmount: normalizedAmount,
          ...(debtOnly ? {} : { paymentMethod }),
        }),
      });
      settlementKeyRef.current = null;
      setPaidAmount('0');
      onUpdated(updated);
      setNotice(debtOnly
        ? 'Đã ghi nhận nợ toàn bộ. Khoản phải thu của đơn được giữ nguyên.'
        : 'Đã ghi nhận tiền thu. Công nợ còn lại được tự động cập nhật.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không ghi nhận tiền thu được');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.reasonRow}>
      <strong>Hoàn thành đơn và Nộp tiền / Nợ</strong>
      <small>Xuất kho đã xong. Hoàn thành đơn ghi nhận doanh số và khoản phải thu; tiền thu hoặc nợ được xử lý riêng.</small>

      <div className={styles.inlineActions}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!canComplete || !completionAvailable || busy !== null}
          onClick={() => void completeOrder()}
        >
          {busy === 'complete'
            ? 'Đang hoàn thành…'
            : order.status === 'closed'
              ? 'Đã hoàn thành đơn'
              : 'Hoàn thành đơn'}
        </button>
      </div>

      <label>
        Số tiền thực nộp / đã thu
        <input
          value={paidAmount}
          inputMode="decimal"
          disabled={!canSettle || !settlementAvailable || busy !== null}
          onChange={(event) => setPaidAmount(event.target.value)}
          placeholder="Nhập 0 nếu ghi nợ toàn bộ"
        />
      </label>
      <small>
        Giá trị đơn: {formatMoney(currentVersion?.total)} {order.currency}. Nhập 0 để ghi nợ toàn bộ; phần chưa thu tiếp tục là công nợ khách hàng.
      </small>
      <label>
        Hình thức nhận tiền
        <select
          value={paymentMethod}
          disabled={!canSettle || !settlementAvailable || busy !== null || /^0(?:\.0+)?$/.test(paidAmount.trim())}
          onChange={(event) => setPaymentMethod(event.target.value)}
        >
          <option value="CASH">Tiền mặt</option>
          <option value="BANK_TRANSFER">Chuyển khoản</option>
        </select>
      </label>
      <div className={styles.inlineActions}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!canSettle || !settlementAvailable || busy !== null || paidAmount.trim() === ''}
          onClick={() => void recordSettlement()}
        >
          {busy === 'settlement' ? 'Đang ghi nhận…' : 'Nộp tiền / Nợ'}
        </button>
      </div>
      {!settlementAvailable && order.status !== 'closed' ? (
        <small>Hoàn thành đơn trước khi ghi nhận tiền thực thu hoặc nợ khách hàng.</small>
      ) : null}
      <small>
        Thanh toán: {order.settlementStatus === 'paid'
          ? 'Đã thanh toán đủ'
          : order.settlementStatus === 'partially_paid'
            ? 'Đã thu một phần, còn công nợ'
            : order.settlementStatus === 'pending'
              ? 'Đang còn công nợ'
              : 'Chưa phát sinh khoản phải thu'}.
      </small>

      {notice ? <div className={`${styles.banner} ${styles.bannerSuccess}`}>{notice}</div> : null}
      {error ? <div className={`${styles.banner} ${styles.bannerError}`}>{error}</div> : null}
    </div>
  );
}
