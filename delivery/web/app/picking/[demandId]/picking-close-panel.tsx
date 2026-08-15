'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PickingCloseState } from '../../../lib/fulfillment-api';
import styles from '../picking.module.css';

type PendingClose = Readonly<{ key: string; body: string }>;

function closeHint(state: PickingCloseState) {
  switch (state.reasonCode) {
    case 'SHORTAGE_FACT_REQUIRED':
      return 'Còn mã chưa soạn đủ nhưng chưa ghi nhận THIẾU.';
    case 'UNALLOCATED_DEMAND_REMAINS':
      return 'Còn số lượng chưa được phân bổ hoặc xác định chờ hàng.';
    case 'ALTERNATIVE_SOURCE_AVAILABLE':
      return 'Core vẫn còn nguồn hàng hợp lệ ở vị trí/lô khác; lấy tiếp trước khi chốt phần thiếu.';
    case 'NO_PICKED_QUANTITY':
      return 'Chưa có số lượng nào được soạn để chốt phần đã soạn.';
    case 'PICKING_ALREADY_CLOSED_AT_CURRENT_PROGRESS':
      return `Đã chốt ${state.latestCloseMode === 'FULL' ? 'SOẠN XONG' : 'PHẦN ĐÃ SOẠN'} ở tiến độ hiện tại.`;
    default:
      return 'Chưa đủ điều kiện chốt soạn ở trạng thái hiện tại.';
  }
}

export default function PickingClosePanel({
  salesOrderId,
  state,
}: Readonly<{ salesOrderId: string; state: PickingCloseState }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pendingByMode = useRef(new Map<'FULL' | 'PARTIAL', PendingClose>());
  const mode = state.canCloseFull ? 'FULL' : state.canClosePartial ? 'PARTIAL' : null;

  async function closePicking() {
    if (!mode) return;
    let pending = pendingByMode.current.get(mode);
    if (!pending) {
      const body = JSON.stringify({ mode });
      pending = { key: createIdempotencyKey('fulfillment-pick-close'), body };
      pendingByMode.current.set(mode, pending);
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/picking/orders/${encodeURIComponent(salesOrderId)}/close`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key },
        body: pending.body,
      });
      const body = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || 'Không chốt được soạn hàng.');
      setMessage(mode === 'FULL' ? 'Đã CHỐT SOẠN XONG.' : 'Đã CHỐT PHẦN ĐÃ SOẠN; phần thiếu vẫn chờ bổ sung.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không chốt được soạn hàng.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.readyBanner} data-testid="picking-close-panel">
      <strong>Chốt soạn đơn</strong>
      <p>
        Đã soạn {state.pickedBaseQuantity} / {state.orderedBaseQuantity}.
        {state.backorderedBaseQuantity !== '0.000000000000' ? ` Chờ hàng ${state.backorderedBaseQuantity}.` : ''}
      </p>
      {mode ? (
        <button className={styles.primaryActionButton} type="button" disabled={busy} onClick={closePicking}>
          {busy ? 'Đang chốt…' : mode === 'FULL' ? 'CHỐT SOẠN XONG' : 'CHỐT PHẦN ĐÃ SOẠN'}
        </button>
      ) : <p className={styles.muted}>{closeHint(state)}</p>}
      {message ? <p className={message.startsWith('Đã') ? styles.notice : styles.error} role="status">{message}</p> : null}
    </section>
  );
}
