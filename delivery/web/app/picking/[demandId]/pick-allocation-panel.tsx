'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PickingAllocation } from '../../../lib/fulfillment-api';
import styles from '../picking.module.css';

type Props = Readonly<{
  allocation: PickingAllocation;
  demandId: string;
  unitCode: string | null;
}>;

type PendingPick = Readonly<{ key: string; body: string }>;
const SCALE = 1_000_000_000_000n;

function scaled(value: string) {
  const match = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/.exec(value.trim());
  return match ? BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(12, '0')) : null;
}

function decimal(value: bigint) {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(12, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function display(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(parsed) : value;
}

export default function PickAllocationPanel({ allocation, demandId, unitCode }: Props) {
  const router = useRouter();
  const allocated = scaled(allocation.allocatedBaseQuantity) ?? 0n;
  const picked = scaled(allocation.pickedBaseQuantity) ?? 0n;
  const remaining = allocated > picked ? allocated - picked : 0n;
  const [quantity, setQuantity] = useState(() => decimal(remaining));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pendingByFingerprint = useRef(new Map<string, PendingPick>());
  const requested = useMemo(() => scaled(quantity), [quantity]);
  const discrepancy = requested !== null && requested > 0n && requested < remaining;
  const completed = remaining === 0n;

  async function submit() {
    setMessage('');
    if (completed) return;
    if (requested === null || requested <= 0n || requested > remaining) {
      setMessage('Số lượng soạn phải lớn hơn 0 và không vượt số còn lại.');
      return;
    }
    if (discrepancy && !reason.trim()) {
      setMessage('Soạn thiếu so với số còn lại cần ghi lý do chênh lệch.');
      return;
    }

    const logicalPayload = {
      quantity: decimal(requested),
      reason: discrepancy ? reason.trim() : null,
    };
    const fingerprint = JSON.stringify({ demandId, allocationId: allocation.id, ...logicalPayload });
    let pending = pendingByFingerprint.current.get(fingerprint);
    if (!pending) {
      pending = {
        key: createIdempotencyKey('fulfillment-pick'),
        body: JSON.stringify(logicalPayload),
      };
      pendingByFingerprint.current.set(fingerprint, pending);
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/picking/${encodeURIComponent(allocation.id)}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key },
        body: pending.body,
      });
      const body = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || 'Không ghi được số lượng đã soạn.');
      setMessage('Đã ghi nhận vào Core Fulfillment.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không ghi được số lượng đã soạn.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.allocationCard} data-testid="picking-allocation">
      <div className={styles.cardTop}>
        <div>
          <small>Vị trí / lô</small>
          <h2>{allocation.locationCode || allocation.locationName || 'Không bắt buộc vị trí'}</h2>
          <p className={styles.muted}>{allocation.lotCode ? `Lô ${allocation.lotCode}` : 'Không bắt buộc lô'}</p>
        </div>
        <span className={completed ? styles.doneBadge : styles.statusBadge}>{completed ? 'Đã soạn' : 'Đang soạn'}</span>
      </div>
      <div className={styles.progressLine}>
        <span>Đã soạn <strong>{display(allocation.pickedBaseQuantity)}</strong></span>
        <span>Cần soạn <strong>{display(allocation.allocatedBaseQuantity)} {unitCode || ''}</strong></span>
      </div>
      {!completed ? (
        <>
          <label className={styles.field}>
            Số lượng xác nhận
            <input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </label>
          {discrepancy ? (
            <label className={styles.field}>
              Lý do chênh lệch
              <textarea rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: thiếu hàng thực tế tại vị trí" />
            </label>
          ) : null}
          {message ? <p className={message.startsWith('Đã') ? styles.notice : styles.error} role="status">{message}</p> : null}
          <button className={styles.primaryActionButton} type="button" disabled={busy} onClick={submit}>{busy ? 'Đang ghi…' : 'Xác nhận đã soạn'}</button>
        </>
      ) : <p className={styles.notice}>Allocation này đã được pick đủ trong Core Fulfillment.</p>}
    </section>
  );
}
