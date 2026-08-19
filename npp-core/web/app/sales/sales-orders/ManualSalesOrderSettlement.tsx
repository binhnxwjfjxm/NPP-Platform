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
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [busy, setBusy] = useState<'complete' | 'settlement' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const completeKeyRef = useRef<StableMutation | null>(null);
  const settlementKeyRef = useRef<StableMutation | null>(null);
  const currentVersion = activeVersion(order);

  useEffect(() => {
    setPaidAmount('');
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
      setNotice('Đã Hoàn tất giao. Doanh số và khoản phải thu đã được ghi nhận; tiền thu theo dõi riêng.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không Hoàn tất giao được');
    } finally {
      setBusy(null);
    }
  }

  async function recordSettlement() {
    const normalizedAmount = paidAmount.trim();
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
      setPaidAmount('');
      onUpdated(updated);
      setNotice('Đã ghi nhận tiền thu. Công nợ còn lại được tự động cập nhật.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không ghi nhận tiền thu được');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.reasonRow}>
      <strong>Hoàn tất Giao thủ công</strong>
      <small>Xuất kho đã xong. Hoàn tất giao ghi nhận doanh số và khoản phải thu; thu tiền là bước riêng.</small>

      <div className={styles.inlineActions}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!canComplete || !completionAvailable || busy !== null}
          onClick={() => void completeOrder()}
        >
          {busy === 'complete'
            ? 'Đang hoàn tất…'
            : order.status === 'closed'
              ? 'Đã Hoàn tất giao'
              : 'Hoàn tất giao'}
        </button>
      </div>

      {settlementAvailable ? (
        <>
          <label>
            Số tiền thực thu
            <input
              value={paidAmount}
              inputMode="decimal"
              disabled={!canSettle || busy !== null}
              onChange={(event) => setPaidAmount(event.target.value)}
              placeholder="Nhập số tiền thu"
            />
          </label>
          <small>
            Giá trị đơn: {formatMoney(currentVersion?.total)} {order.currency}. Phần chưa thu tiếp tục là công nợ khách hàng.
          </small>
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
              disabled={!canSettle || busy !== null || paidAmount.trim() === ''}
              onClick={() => void recordSettlement()}
            >
              {busy === 'settlement' ? 'Đang ghi nhận…' : 'Ghi nhận tiền thu'}
            </button>
          </div>
        </>
      ) : (
        <small>
          Thanh toán: {order.settlementStatus === 'paid'
            ? 'Đã thanh toán đủ'
            : order.settlementStatus === 'partially_paid'
              ? 'Đã thu một phần, còn công nợ'
              : order.settlementStatus === 'pending'
                ? 'Đang còn công nợ'
                : 'Chưa phát sinh khoản phải thu'}.
        </small>
      )}

      {notice ? <div className={`${styles.banner} ${styles.bannerSuccess}`}>{notice}</div> : null}
      {error ? <div className={`${styles.banner} ${styles.bannerError}`}>{error}</div> : null}
    </div>
  );
}
