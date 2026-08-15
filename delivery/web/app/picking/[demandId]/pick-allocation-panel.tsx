'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PickingAllocation } from '../../../lib/fulfillment-api';
import styles from '../picking.module.css';

type AlternativeSource = Readonly<{
  key: string;
  locationLabel: string;
  lotLabel: string | null;
  availableBaseQuantity: string;
}>;

type Props = Readonly<{
  allocation: PickingAllocation;
  demandId: string;
  unitCode: string | null;
  alternativeSources: readonly AlternativeSource[];
}>;

type PendingMutation = Readonly<{ key: string; body: string }>;
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

export default function PickAllocationPanel({
  allocation,
  demandId,
  unitCode,
  alternativeSources,
}: Props) {
  const router = useRouter();
  const remaining = useMemo(
    () => remainingQuantity(allocation.allocatedBaseQuantity, allocation.pickedBaseQuantity),
    [allocation.allocatedBaseQuantity, allocation.pickedBaseQuantity],
  );
  const remainingScaled = useMemo(() => scaledDigits(remaining) ?? '0', [remaining]);
  const [shortageOpen, setShortageOpen] = useState(false);
  const [actualPickedQuantity, setActualPickedQuantity] = useState('0');
  const [observedQuantity, setObservedQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pendingByFingerprint = useRef(new Map<string, PendingMutation>());
  const completed = compareDigits(remainingScaled, '0') === 0;

  async function runMutation(url: string, pending: PendingMutation, successMessage: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key },
        body: pending.body,
      });
      const body = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || 'Không ghi được soạn hàng.');
      setMessage(successMessage);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không ghi được soạn hàng.');
    } finally {
      setBusy(false);
    }
  }

  async function submitFullPick() {
    if (completed) return;
    const logicalPayload = { quantity: remaining, reason: null };
    const fingerprint = JSON.stringify({
      operation: 'full-pick',
      demandId,
      allocationId: allocation.id,
      ...logicalPayload,
    });
    let pending = pendingByFingerprint.current.get(fingerprint);
    if (!pending) {
      pending = {
        key: createIdempotencyKey('fulfillment-pick'),
        body: JSON.stringify(logicalPayload),
      };
      pendingByFingerprint.current.set(fingerprint, pending);
    }
    await runMutation(
      `/api/picking/${encodeURIComponent(allocation.id)}`,
      pending,
      'Đã ghi nhận SOẠN ĐỦ vào Core Fulfillment.',
    );
  }

  async function submitShortage() {
    const pickedScaled = scaledDigits(actualPickedQuantity);
    const observedScaled = scaledDigits(observedQuantity);
    setMessage('');
    if (pickedScaled === null || compareDigits(pickedScaled, '0') < 0 || compareDigits(pickedScaled, remainingScaled) >= 0) {
      setMessage('Số thực lấy phải từ 0 đến nhỏ hơn số còn phải soạn.');
      return;
    }
    if (observedScaled === null || compareDigits(observedScaled, '0') < 0) {
      setMessage('Tồn thực tế quan sát phải là số không âm.');
      return;
    }
    if (compareDigits(pickedScaled, observedScaled) > 0) {
      setMessage('Số thực lấy không thể lớn hơn tồn thực tế quan sát.');
      return;
    }
    if (!reason.trim()) {
      setMessage('THIẾU phải ghi lý do.');
      return;
    }
    const logicalPayload = {
      actualPickedQuantity: decimalFromScaledDigits(pickedScaled),
      observedQuantity: decimalFromScaledDigits(observedScaled),
      reason: reason.trim(),
    };
    const fingerprint = JSON.stringify({
      operation: 'shortage',
      demandId,
      allocationId: allocation.id,
      ...logicalPayload,
    });
    let pending = pendingByFingerprint.current.get(fingerprint);
    if (!pending) {
      pending = {
        key: createIdempotencyKey('fulfillment-shortage'),
        body: JSON.stringify(logicalPayload),
      };
      pendingByFingerprint.current.set(fingerprint, pending);
    }
    await runMutation(
      `/api/picking/${encodeURIComponent(allocation.id)}/shortage`,
      pending,
      'Đã ghi riêng thiếu Fulfillment và chênh lệch tồn kho; tồn kho chưa bị tự điều chỉnh.',
    );
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
          <button
            className={styles.primaryActionButton}
            type="button"
            disabled={busy}
            onClick={submitFullPick}
          >
            <span>SOẠN ĐỦ</span>
            {busy ? <span aria-live="polite"> · Đang ghi…</span> : null}
          </button>
          <button
            className={styles.secondaryAction}
            type="button"
            disabled={busy}
            onClick={() => setShortageOpen((value) => !value)}
          >
            THIẾU
          </button>
          {shortageOpen ? (
            <div>
              <label className={styles.field}>
                Số lượng thực lấy
                <input
                  inputMode="decimal"
                  value={actualPickedQuantity}
                  onChange={(event) => setActualPickedQuantity(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                Tồn thực tế quan sát tại vị trí/lô
                <input
                  inputMode="decimal"
                  value={observedQuantity}
                  onChange={(event) => setObservedQuantity(event.target.value)}
                  placeholder="Ví dụ: 0"
                />
              </label>
              <label className={styles.field}>
                Lý do chênh lệch / thiếu
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Ví dụ: tồn thực tế thấp hơn số trên hệ thống"
                />
              </label>
              <button
                className={styles.primaryActionButton}
                type="button"
                disabled={busy}
                onClick={submitShortage}
              >
                {busy ? 'Đang ghi…' : 'Ghi nhận THIẾU'}
              </button>
            </div>
          ) : null}
          {alternativeSources.length ? (
            <div className={styles.notice}>
              <strong>Nguồn khác còn hợp lệ</strong>
              {alternativeSources.slice(0, 3).map((source) => (
                <p key={source.key}>
                  Lấy tiếp từ {source.locationLabel}
                  {source.lotLabel ? ` · lô ${source.lotLabel}` : ''}
                  {' · '}
                  {display(source.availableBaseQuantity)} {unitCode || ''}
                </p>
              ))}
            </div>
          ) : null}
          {message ? <p className={message.startsWith('Đã') ? styles.notice : styles.error} role="status">{message}</p> : null}
        </>
      ) : <p className={styles.notice}>Allocation này đã được pick đủ trong Core Fulfillment.</p>}
    </section>
  );
}
