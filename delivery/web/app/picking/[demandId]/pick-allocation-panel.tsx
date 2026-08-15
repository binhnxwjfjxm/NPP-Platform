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
const DECIMAL_SCALE = 12;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;

function scaledDigits(value: string) {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) return null;
  const digits = `${match[1]}${(match[2] ?? '').padEnd(DECIMAL_SCALE, '0')}`.replace(/^0+(?=\d)/, '');
  return digits || '0';
}

function compareDigits(left: string, right: string) {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function subtractDigits(left: string, right: string) {
  const width = Math.max(left.length, right.length);
  const a = left.padStart(width, '0').split('').map(Number);
  const b = right.padStart(width, '0').split('').map(Number);
  const output = Array.from({ length: width }, () => 0);
  let borrow = 0;
  for (let index = width - 1; index >= 0; index -= 1) {
    let digit = a[index] - borrow - b[index];
    if (digit < 0) {
      digit += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    output[index] = digit;
  }
  return output.join('').replace(/^0+(?=\d)/, '') || '0';
}

function decimalFromScaledDigits(value: string) {
  const padded = value.padStart(DECIMAL_SCALE + 1, '0');
  const whole = padded.slice(0, -DECIMAL_SCALE).replace(/^0+(?=\d)/, '') || '0';
  const fraction = padded.slice(-DECIMAL_SCALE).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function remainingQuantity(allocatedValue: string, pickedValue: string) {
  const allocated = scaledDigits(allocatedValue);
  const picked = scaledDigits(pickedValue);
  if (!allocated || !picked || compareDigits(allocated, picked) <= 0) return '0';
  return decimalFromScaledDigits(subtractDigits(allocated, picked));
}

function display(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(parsed) : value;
}

export default function PickAllocationPanel({ allocation, demandId, unitCode }: Props) {
  const router = useRouter();
  const remaining = useMemo(
    () => remainingQuantity(allocation.allocatedBaseQuantity, allocation.pickedBaseQuantity),
    [allocation.allocatedBaseQuantity, allocation.pickedBaseQuantity],
  );
  const remainingScaled = useMemo(() => scaledDigits(remaining) ?? '0', [remaining]);
  const [quantity, setQuantity] = useState(remaining);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pendingByFingerprint = useRef(new Map<string, PendingPick>());
  const requestedScaled = useMemo(() => scaledDigits(quantity), [quantity]);
  const discrepancy = requestedScaled !== null
    && compareDigits(requestedScaled, '0') > 0
    && compareDigits(requestedScaled, remainingScaled) < 0;
  const completed = compareDigits(remainingScaled, '0') === 0;

  async function submit() {
    setMessage('');
    if (completed) return;
    if (requestedScaled === null || compareDigits(requestedScaled, '0') <= 0 || compareDigits(requestedScaled, remainingScaled) > 0) {
      setMessage('Số lượng soạn phải lớn hơn 0 và không vượt số còn lại.');
      return;
    }
    if (discrepancy && !reason.trim()) {
      setMessage('Soạn thiếu so với số còn lại cần ghi lý do chênh lệch.');
      return;
    }

    const logicalPayload = {
      quantity: decimalFromScaledDigits(requestedScaled),
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
