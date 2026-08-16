'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DriverCodOverview } from '../../../lib/types';
import styles from './cod-panel.module.css';

type Props = Readonly<{
  tripId: string;
  overview: DriverCodOverview;
  canCreateHandover?: boolean;
}>;
type PendingHandover = Readonly<{ fingerprint: string; key: string; body: string }>;
const ZERO = BigInt(0);
const SCALE = BigInt(1_000_000);

function scaled(value: string) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  return match ? BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0')) : ZERO;
}

function money(value: string) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 6 }).format(Number(value));
}

export default function CodHandoverPanel({ tripId, overview, canCreateHandover = true }: Props) {
  const router = useRouter();
  const cash = useMemo(() => overview.assignments.filter((assignment) => (
    assignment.collection?.collectionMethod === 'CASH'
    && !assignment.collection.reversed
    && scaled(assignment.collection.custodyRemainingAmount) > ZERO
  )), [overview.assignments]);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(
    cash.map((assignment) => [assignment.collection!.id, assignment.collection!.custodyRemainingAmount]),
  ));
  const [excess, setExcess] = useState('0');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<PendingHandover | null>(null);

  useEffect(() => {
    setAmounts((current) => Object.fromEntries(cash.map((assignment) => {
      const collection = assignment.collection!;
      return [collection.id, current[collection.id] ?? collection.custodyRemainingAmount];
    })));
  }, [cash]);

  const lines = cash.map((assignment) => ({
    collectionId: assignment.collection!.id,
    amount: amounts[assignment.collection!.id] || '0',
  })).filter((line) => scaled(line.amount) > ZERO);
  const expected = cash.reduce((total, assignment) => total + scaled(assignment.collection!.custodyRemainingAmount), ZERO);
  const handed = lines.reduce((total, line) => total + scaled(line.amount), ZERO) + scaled(excess);
  const different = expected !== handed;

  async function submit() {
    setMessage('');
    if (!canCreateHandover) { setMessage('Tài khoản hiện tại không có quyền bàn giao COD.'); return; }
    if (!lines.length) { setMessage('Không có khoản tiền mặt nào để bàn giao.'); return; }
    if (different && !reason.trim()) { setMessage('Bàn giao thiếu, thừa hoặc một phần cần nhập lý do.'); return; }

    const logicalPayload = {
      lines,
      unattributedExcessAmount: excess,
      reason: reason.trim() || null,
      note: note.trim() || null,
    };
    const fingerprint = JSON.stringify(logicalPayload);
    let pending = pendingRef.current;
    if (!pending || pending.fingerprint !== fingerprint) {
      pending = {
        fingerprint,
        key: createIdempotencyKey('cod-handover'),
        body: JSON.stringify({ ...logicalPayload, handedOverAt: new Date().toISOString() }),
      };
      pendingRef.current = pending;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/cod-handovers`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key },
        body: pending.body,
      });
      const body = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || 'Không lập được bàn giao COD.');
      pendingRef.current = null;
      setMessage('Đã bàn giao tiền, chờ Công Ty xác nhận thực nhận.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không lập được bàn giao COD.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} data-testid="cod-handover-panel">
      <button className={styles.custodyTrigger} type="button" onClick={() => setOpen(true)}>
        <span>Tiền đang giữ</span>
        <strong>{money(overview.trip.custodyTotal)}</strong>
        <small>Bàn giao tiền cho Công Ty</small>
      </button>

      {open ? (
        <div className={styles.sheetBackdrop} role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`custody-title-${tripId}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className={styles.sheetHeader}>
              <div>
                <p>Tiền đang giữ / Bàn giao cho Công Ty</p>
                <h3 id={`custody-title-${tripId}`}>{money(overview.trip.custodyTotal)}</h3>
              </div>
              <button className={styles.closeButton} type="button" onClick={() => setOpen(false)} aria-label="Đóng">×</button>
            </header>

            {canCreateHandover && cash.length ? (
              <>
                <div className={styles.lines}>
                  {cash.map((assignment) => (
                    <label className={styles.line} key={assignment.collection!.id}>
                      <span>{assignment.customerName || assignment.customerCode}<br /><small>{assignment.deliveryOrderNumber}</small></span>
                      <input inputMode="decimal" aria-label={`Số tiền bàn giao ${assignment.deliveryOrderNumber}`} value={amounts[assignment.collection!.id] || '0'} onChange={(event) => setAmounts((current) => ({ ...current, [assignment.collection!.id]: event.target.value }))} />
                    </label>
                  ))}
                </div>
                <label className={styles.field}>Tiền thừa không gắn phiếu
                  <input inputMode="decimal" value={excess} onChange={(event) => setExcess(event.target.value)} />
                </label>
                {different ? <label className={styles.field}>Lý do chênh lệch
                  <textarea rows={2} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
                </label> : null}
                <label className={styles.field}>Ghi chú bàn giao
                  <textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
                </label>
                {message ? <p className={message.startsWith('Đã') ? styles.notice : styles.error} role="status">{message}</p> : null}
                <button className={styles.button} type="button" disabled={busy} onClick={submit}>{busy ? 'Đang bàn giao…' : 'Bàn giao tiền cho Công Ty'}</button>
              </>
            ) : cash.length ? (
              <p className={styles.notice}>Tài khoản hiện tại chỉ được xem tiền đang giữ, chưa có quyền bàn giao.</p>
            ) : (
              <p className={styles.notice}>Không còn tiền mặt COD chờ bàn giao.</p>
            )}

            <div className={styles.historyBlock}>
              <h3>Lịch sử bàn giao</h3>
              {overview.handovers.length ? (
                <ul className={styles.history}>
                  {overview.handovers.map((handover) => (
                    <li key={handover.id}><strong>{money(handover.handedOverTotal)}</strong> · {handover.status}<br /><small>{new Date(handover.handedOverAt).toLocaleString('vi-VN')}</small></li>
                  ))}
                </ul>
              ) : <p className={styles.notice}>Chưa có lần bàn giao nào.</p>}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
