'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DriverCodOverview } from '../../../lib/types';
import styles from './cod-panel.module.css';

type Props = Readonly<{ tripId: string; overview: DriverCodOverview }>;
const ZERO = BigInt(0);
const SCALE = BigInt(1_000_000);

function scaled(value: string) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  return match ? BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0')) : ZERO;
}

function money(value: string) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 6 }).format(Number(value));
}

export default function CodHandoverPanel({ tripId, overview }: Props) {
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
  const keyRef = useRef<string | null>(null);

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
    if (!lines.length) { setMessage('Không có khoản tiền mặt nào để bàn giao.'); return; }
    if (different && !reason.trim()) { setMessage('Bàn giao thiếu, thừa hoặc một phần cần nhập lý do.'); return; }
    if (!keyRef.current) keyRef.current = `cod-handover-${crypto.randomUUID()}`;
    setBusy(true);
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/cod-handovers`, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyRef.current },
        body: JSON.stringify({
          lines,
          unattributedExcessAmount: excess,
          reason: reason.trim() || null,
          note: note.trim() || null,
          handedOverAt: new Date().toISOString(),
        }),
      });
      const body = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || 'Không lập được bàn giao COD.');
      keyRef.current = null;
      setMessage('Đã lập bàn giao COD, chờ kế toán xác nhận.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không lập được bàn giao COD.');
    } finally { setBusy(false); }
  }

  if (!cash.length && !overview.handovers.length) return null;
  return (
    <section className={styles.panel} data-testid="cod-handover-panel">
      <h3>Bàn giao tiền COD cuối chuyến</h3>
      <p>Tiền mặt còn tài xế giữ: <strong>{money(overview.trip.custodyTotal)}</strong></p>
      {cash.length ? (
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
          <button className={styles.button} type="button" disabled={busy} onClick={submit}>{busy ? 'Đang lập…' : 'Lập bàn giao COD'}</button>
        </>
      ) : <p className={styles.notice}>Không còn tiền mặt COD chờ bàn giao.</p>}
      {overview.handovers.length ? (
        <ul className={styles.history}>
          {overview.handovers.map((handover) => (
            <li key={handover.id}><strong>{money(handover.handedOverTotal)}</strong> · {handover.status}<br /><small>{new Date(handover.handedOverAt).toLocaleString('vi-VN')}</small></li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
