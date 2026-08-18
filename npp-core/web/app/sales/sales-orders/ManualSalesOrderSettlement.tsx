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
  const settlementAvailable = ['confirmed', 'closed'].includes(order.status)
    && order.settlementStatus === 'not_due';

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
      setNotice('Đã Hoàn thành đơn. Phần tiền / nợ vẫn được theo dõi riêng.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không Hoàn thành đơn được');
    } finally {
      setBusy(null);
    }
  }

  async function recordSettlement() {
    const normalizedAmount = paidAmount.trim() || '0';
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
          paymentMethod,
        }),
      });
      settlementKeyRef.current = null;
      onUpdated(updated);
      setNotice(normalizedAmount === '0'
        ? 'Đã ghi nhận toàn bộ giá trị đơn là nợ khách hàng.'
        : 'Đã ghi nhận tiền thực nộp; phần còn lại (nếu có) là nợ khách hàng.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không ghi nhận tiền / nợ được');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.reasonRow}>
      <strong>Hoàn tất Giao thủ công</strong>
      <small>Xuất kho đã xong. Hoàn thành đơn và tiền / nợ là hai việc độc lập.</small>

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
              ? 'Đã Hoàn thành đơn'
              : 'Hoàn thành đơn'}
        </button>
      </div>

      {settlementAvailable ? (
        <>
          <label>
            Số tiền thực nộp
            <input
              value={paidAmount}
              inputMode="decimal"
              disabled={!canSettle || busy !== null}
              onChange={(event) => setPaidAmount(event.target.value)}
              placeholder="0"
            />
          </label>
          <small>Tổng đơn: {formatMoney(currentVersion?.total)} {order.currency}. Nhập 0 nếu ghi nợ toàn bộ.</small>
          <label>
            Hình thức nhận tiền
            <select
              value={paymentMethod}
              disabled={!canSettle || busy !== null}
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
              disabled={!canSettle || busy !== null}
              onClick={() => void recordSettlement()}
            >
              {busy === 'settlement' ? 'Đang ghi nhận…' : 'Nộp tiền / Nợ'}
            </button>
          </div>
        </>
      ) : (
        <small>
          Tiền / nợ: {order.settlementStatus === 'paid'
            ? 'Đã thanh toán'
            : order.settlementStatus === 'partially_paid'
              ? 'Đã thanh toán một phần'
              : order.settlementStatus === 'pending'
                ? 'Đang còn nợ'
                : 'Đã ghi nhận'}.
        </small>
      )}

      {notice ? <div className={`${styles.banner} ${styles.bannerSuccess}`}>{notice}</div> : null}
      {error ? <div className={`${styles.banner} ${styles.bannerError}`}>{error}</div> : null}
    </div>
  );
}
