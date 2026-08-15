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
type SheetMode = 'pick' | 'shortage' | 'reverse' | null;
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

function reversiblePickQuantity(pickedValue: string, packedValue: string) {
  const picked = scaledDigits(pickedValue);
  const packed = scaledDigits(packedValue);
  if (!picked || !packed || compareDigits(picked, packed) <= 0) return '0';
  return decimalFromScaledDigits(subtractDigits(picked, packed));
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
  const reversible = useMemo(
    () => reversiblePickQuantity(allocation.pickedBaseQuantity, allocation.packedBaseQuantity),
    [allocation.packedBaseQuantity, allocation.pickedBaseQuantity],
  );
  const remainingScaled = useMemo(() => scaledDigits(remaining) ?? '0', [remaining]);
  const pickedScaled = useMemo(() => scaledDigits(allocation.pickedBaseQuantity) ?? '0', [allocation.pickedBaseQuantity]);
  const packedScaled = useMemo(() => scaledDigits(allocation.packedBaseQuantity) ?? '0', [allocation.packedBaseQuantity]);
  const reversibleScaled = useMemo(() => scaledDigits(reversible) ?? '0', [reversible]);
  const [sheetMode, setSheetMode] = useState<SheetMode>(null);
  const [actualPickedQuantity, setActualPickedQuantity] = useState('0');
  const [observedQuantity, setObservedQuantity] = useState('');
  const [shortageReason, setShortageReason] = useState('');
  const [reverseQuantity, setReverseQuantity] = useState(reversible);
  const [reverseReason, setReverseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pendingByFingerprint = useRef(new Map<string, PendingMutation>());
  const completed = compareDigits(remainingScaled, '0') === 0;
  const hasPicked = compareDigits(pickedScaled, '0') > 0;
  const hasPacked = compareDigits(packedScaled, '0') > 0;
  const canReversePick = compareDigits(reversibleScaled, '0') > 0;
  const pickActionLabel = hasPicked ? 'SOẠN TIẾP' : 'SOẠN ĐỦ';

  function closeSheet() {
    if (!busy) setSheetMode(null);
  }

  function openSheet(mode: Exclude<SheetMode, null>) {
    setMessage('');
    if (mode === 'shortage') {
      setActualPickedQuantity('0');
      setObservedQuantity('');
      setShortageReason('');
    }
    if (mode === 'reverse') {
      setReverseQuantity(reversible);
      setReverseReason('');
    }
    setSheetMode(mode);
  }

  async function runMutation(
    url: string,
    pending: PendingMutation,
    fingerprint: string,
    successMessage: string,
  ) {
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
      pendingByFingerprint.current.delete(fingerprint);
      setSheetMode(null);
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
      fingerprint,
      `Đã ghi nhận ${pickActionLabel} vào Core Fulfillment.`,
    );
  }

  async function submitShortage() {
    const picked = scaledDigits(actualPickedQuantity);
    const observed = scaledDigits(observedQuantity);
    setMessage('');
    if (picked === null || compareDigits(picked, '0') < 0 || compareDigits(picked, remainingScaled) >= 0) {
      setMessage('Số thực lấy phải từ 0 đến nhỏ hơn số còn phải soạn.');
      return;
    }
    if (observed === null || compareDigits(observed, '0') < 0) {
      setMessage('Tồn thực tế quan sát phải là số không âm.');
      return;
    }
    if (compareDigits(picked, observed) > 0) {
      setMessage('Số thực lấy không thể lớn hơn tồn thực tế quan sát.');
      return;
    }
    if (!shortageReason.trim()) {
      setMessage('THIẾU phải ghi lý do.');
      return;
    }
    const logicalPayload = {
      actualPickedQuantity: decimalFromScaledDigits(picked),
      observedQuantity: decimalFromScaledDigits(observed),
      reason: shortageReason.trim(),
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
      fingerprint,
      'Đã ghi riêng thiếu Fulfillment và chênh lệch tồn kho; tồn kho chưa bị tự điều chỉnh.',
    );
  }

  async function submitReversePick() {
    const reversal = scaledDigits(reverseQuantity);
    setMessage('');
    if (reversal === null || compareDigits(reversal, '0') <= 0 || compareDigits(reversal, reversibleScaled) > 0) {
      setMessage(`Số lượng HOÀN phải lớn hơn 0 và không vượt ${display(reversible)} ${unitCode || ''}.`);
      return;
    }
    if (!reverseReason.trim()) {
      setMessage('HOÀN phải ghi lý do.');
      return;
    }
    const logicalPayload = {
      quantity: decimalFromScaledDigits(reversal),
      reason: reverseReason.trim(),
    };
    const fingerprint = JSON.stringify({
      operation: 'pick-reversal',
      demandId,
      allocationId: allocation.id,
      ...logicalPayload,
    });
    let pending = pendingByFingerprint.current.get(fingerprint);
    if (!pending) {
      pending = {
        key: createIdempotencyKey('fulfillment-pick-reversal'),
        body: JSON.stringify(logicalPayload),
      };
      pendingByFingerprint.current.set(fingerprint, pending);
    }
    await runMutation(
      `/api/picking/${encodeURIComponent(allocation.id)}/reversal`,
      pending,
      fingerprint,
      'Đã ghi nhận HOÀN pick vào Core Fulfillment.',
    );
  }

  const dialogTitle = sheetMode === 'shortage'
    ? 'Ghi nhận THIẾU'
    : sheetMode === 'reverse'
      ? 'HOÀN số đã soạn'
      : pickActionLabel;

  return (
    <section className={styles.allocationCard} data-testid="picking-allocation">
      <div className={styles.cardTop}>
        <div>
          <small>Vị trí / lô</small>
          <h2>{allocation.locationCode || allocation.locationName || 'Không bắt buộc vị trí'}</h2>
          <p className={styles.muted}>{allocation.lotCode ? `Lô ${allocation.lotCode}` : 'Không bắt buộc lô'}</p>
        </div>
        <span className={completed ? styles.doneBadge : styles.statusBadge}>{completed ? 'Đã đủ' : hasPicked ? 'Đang soạn' : 'Chưa soạn'}</span>
      </div>

      <div className={styles.allocationMetrics}>
        <div><small>Cần</small><strong>{display(allocation.allocatedBaseQuantity)} {unitCode || ''}</strong></div>
        <div><small>Đã soạn</small><strong>{display(allocation.pickedBaseQuantity)} {unitCode || ''}</strong></div>
        <div><small>Còn</small><strong>{display(remaining)} {unitCode || ''}</strong></div>
      </div>

      <div className={styles.actionRow}>
        {!completed ? (
          <>
            <button className={`${styles.actionButton} ${styles.actionPrimary}`} type="button" disabled={busy} onClick={() => openSheet('pick')}>
              {pickActionLabel}
            </button>
            <button className={`${styles.actionButton} ${styles.actionSecondary}`} type="button" disabled={busy} onClick={() => openSheet('shortage')}>
              THIẾU
            </button>
          </>
        ) : null}
        {canReversePick ? (
          <button className={`${styles.actionButton} ${styles.actionReverse}`} type="button" disabled={busy} onClick={() => openSheet('reverse')}>
            HOÀN
          </button>
        ) : null}
      </div>

      {hasPicked && !canReversePick && hasPacked ? (
        <p className={styles.lockedNotice}>Đã đóng gói {display(allocation.packedBaseQuantity)} {unitCode || ''}. Muốn HOÀN pick phải hoàn Pack trước theo đúng thứ tự.</p>
      ) : null}

      {alternativeSources.length ? (
        <div className={styles.sourceHint}>
          <strong>Nguồn khác còn hợp lệ</strong>
          {alternativeSources.slice(0, 2).map((source) => (
            <p key={source.key}>
              Lấy tiếp từ {source.locationLabel}{source.lotLabel ? ` · lô ${source.lotLabel}` : ''} · {display(source.availableBaseQuantity)} {unitCode || ''}
            </p>
          ))}
        </div>
      ) : null}

      {message ? <p className={message.startsWith('Đã') ? styles.notice : styles.error} role="status">{message}</p> : null}

      {sheetMode ? (
        <div
          className={styles.sheetBackdrop}
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeSheet(); }}
        >
          <section className={styles.bottomSheet} role="dialog" aria-modal="true" aria-label={dialogTitle}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetHeader}>
              <div>
                <small>{allocation.locationCode || allocation.locationName || 'Allocation'}</small>
                <h3>{dialogTitle}</h3>
              </div>
              <button className={styles.sheetClose} type="button" aria-label="Đóng" disabled={busy} onClick={closeSheet}>×</button>
            </div>

            {sheetMode === 'pick' ? (
              <>
                <div className={styles.sheetSummary}>
                  <span>Còn phải soạn</span>
                  <strong>{display(remaining)} {unitCode || ''}</strong>
                </div>
                <p className={styles.sheetHelp}>Xác nhận sẽ ghi đúng số còn lại vào allocation này. Core vẫn kiểm tra warehouse, allocation và trạng thái hiện tại.</p>
                <button className={styles.sheetPrimary} type="button" disabled={busy} onClick={submitFullPick}>
                  {busy ? 'Đang ghi…' : `Xác nhận ${pickActionLabel}`}
                </button>
              </>
            ) : null}

            {sheetMode === 'shortage' ? (
              <>
                <label className={styles.field}>
                  Số lượng thực lấy
                  <input inputMode="decimal" value={actualPickedQuantity} onChange={(event) => setActualPickedQuantity(event.target.value)} />
                </label>
                <label className={styles.field}>
                  Tồn thực tế quan sát tại vị trí/lô
                  <input inputMode="decimal" value={observedQuantity} onChange={(event) => setObservedQuantity(event.target.value)} placeholder="Ví dụ: 0" />
                </label>
                <label className={styles.field}>
                  Lý do chênh lệch / thiếu
                  <textarea rows={3} maxLength={1000} value={shortageReason} onChange={(event) => setShortageReason(event.target.value)} placeholder="Ví dụ: tồn thực tế thấp hơn số trên hệ thống" />
                </label>
                {alternativeSources.length ? <p className={styles.sheetHelp}>Core vẫn còn nguồn khác. Sau khi ghi THIẾU, ưu tiên SOẠN TIẾP từ allocation hợp lệ trước khi chốt phần thiếu.</p> : null}
                <button className={styles.sheetPrimary} type="button" disabled={busy} onClick={submitShortage}>
                  {busy ? 'Đang ghi…' : 'Ghi nhận THIẾU'}
                </button>
              </>
            ) : null}

            {sheetMode === 'reverse' ? (
              <>
                <div className={styles.sheetSummary}>
                  <span>Có thể hoàn pick</span>
                  <strong>{display(reversible)} {unitCode || ''}</strong>
                </div>
                <label className={styles.field}>
                  Số lượng HOÀN
                  <input inputMode="decimal" value={reverseQuantity} onChange={(event) => setReverseQuantity(event.target.value)} />
                </label>
                <label className={styles.field}>
                  Lý do HOÀN
                  <textarea rows={3} maxLength={1000} value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder="Ví dụ: lấy nhầm số lượng" />
                </label>
                {hasPacked ? <p className={styles.sheetHelp}>Phần đã Pack không thể hoàn Pick trực tiếp. Core sẽ chặn nếu vượt số lượng chưa đóng gói.</p> : null}
                <button className={`${styles.sheetPrimary} ${styles.sheetDanger}`} type="button" disabled={busy} onClick={submitReversePick}>
                  {busy ? 'Đang hoàn…' : 'Xác nhận HOÀN'}
                </button>
              </>
            ) : null}

            {message && !message.startsWith('Đã') ? <p className={styles.error} role="status">{message}</p> : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
