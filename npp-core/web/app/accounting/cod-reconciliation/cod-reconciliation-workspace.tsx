'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useRef, useState } from 'react';
import type { CodHandover } from '../../../lib/cod-reconciliation-types';
import styles from '../supplier-payments/supplier-payments.module.css';

type Props = Readonly<{ initialHandovers: CodHandover[]; initialError: string | null }>;
type Envelope<T> = { data?: T; error?: { message?: string } };
const SCALE = 1_000_000n;

function scaled(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(String(value ?? '').trim());
  if (!match) return 0n;
  const amount = BigInt(match[2]) * SCALE + BigInt((match[3] ?? '').padEnd(6, '0'));
  return match[1] ? -amount : amount;
}

function decimal(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const fraction = String(absolute % SCALE).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / SCALE}${fraction ? `.${fraction}` : ''}`;
}

function money(value: string) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 6 }).format(Number(value));
}

function statusLabel(status: CodHandover['status']) {
  return {
    submitted: 'Chờ xác nhận',
    reconciled: 'Đã khớp',
    discrepancy: 'Có chênh lệch',
    reversed: 'Đã đảo bàn giao',
    acceptance_reversed: 'Đã đảo xác nhận',
  }[status];
}

async function data<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload ?? {}, 'data')) {
    throw new Error(payload?.error?.message || 'Yêu cầu đối soát COD không thành công');
  }
  return payload!.data as T;
}

export default function CodReconciliationWorkspace({ initialHandovers, initialError }: Props) {
  const [handovers, setHandovers] = useState(initialHandovers);
  const [selectedId, setSelectedId] = useState(initialHandovers[0]?.id ?? '');
  const [detail, setDetail] = useState<CodHandover | null>(initialHandovers[0] ?? null);
  const [acceptedAmount, setAcceptedAmount] = useState(() => initialHandovers[0]
    ? decimal(scaled(initialHandovers[0].handedOverTotal) + scaled(initialHandovers[0].unattributedExcessAmount))
    : '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const [message, setMessage] = useState(initialError ?? '');
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const selected = detail?.id === selectedId ? detail : handovers.find((item) => item.id === selectedId) ?? null;
  const claimed = selected ? scaled(selected.handedOverTotal) + scaled(selected.unattributedExcessAmount) : 0n;
  const acceptanceDifference = scaled(acceptedAmount) - claimed;

  function mutationKey(prefix: string, payload: unknown) {
    const slot = `${prefix}:${JSON.stringify(payload)}`;
    const existing = keys.current.get(slot);
    if (existing) return { slot, key: existing };
    const key = createIdempotencyKey(prefix);
    keys.current.set(slot, key);
    return { slot, key };
  }

  async function refresh(nextId = selectedId) {
    const next = await data<CodHandover[]>(await fetch('/api/cod-reconciliation?limit=1000', { cache: 'no-store' }));
    setHandovers(next);
    const id = nextId || next[0]?.id || '';
    setSelectedId(id);
    if (!id) { setDetail(null); return; }
    const nextDetail = await data<CodHandover>(await fetch(`/api/cod-reconciliation/${id}`, { cache: 'no-store' }));
    setDetail(nextDetail);
    setAcceptedAmount(decimal(scaled(nextDetail.handedOverTotal) + scaled(nextDetail.unattributedExcessAmount)));
  }

  useEffect(() => {
    if (initialHandovers.length || initialError) return;
    setBusy(true);
    setMessage('');
    void refresh()
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Không tải được bàn giao COD'))
      .finally(() => setBusy(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function select(id: string) {
    setBusy(true); setMessage('');
    try {
      const next = await data<CodHandover>(await fetch(`/api/cod-reconciliation/${id}`, { cache: 'no-store' }));
      setSelectedId(id); setDetail(next); setReason(''); setNote(''); setReversalReason('');
      setAcceptedAmount(decimal(scaled(next.handedOverTotal) + scaled(next.unattributedExcessAmount)));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không tải được bàn giao COD'); }
    finally { setBusy(false); }
  }

  async function mutate(path: string, payload: unknown, success: string, prefix: string, nextId = selectedId) {
    const mutation = mutationKey(prefix, payload);
    setBusy(true); setMessage('');
    try {
      await data<unknown>(await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
        body: JSON.stringify(payload),
      }));
      keys.current.delete(mutation.slot);
      setReason(''); setNote(''); setReversalReason('');
      await refresh(nextId);
      setMessage(success);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Yêu cầu đối soát COD không thành công'); }
    finally { setBusy(false); }
  }

  async function accept() {
    if (!selected) return;
    if (scaled(acceptedAmount) < 0n) { setMessage('Số tiền thực nhận không hợp lệ.'); return; }
    if (acceptanceDifference !== 0n && !reason.trim()) { setMessage('Chênh lệch tiền thực nhận cần có lý do.'); return; }
    const payload = { acceptedAmount, acceptedAt: new Date().toISOString(), reason: reason.trim() || null, note: note.trim() || null };
    await mutate(`/api/cod-reconciliation/${selected.id}/accept`, payload, 'Đã xác nhận số tiền công ty thực nhận.', `cod-accept-${selected.id}`);
  }

  async function reverseAcceptance() {
    if (!selected?.acceptance || !reversalReason.trim()) { setMessage('Cần nhập lý do đảo xác nhận.'); return; }
    await mutate(`/api/cod-reconciliation/acceptances/${selected.acceptance.id}/reverse`, { reason: reversalReason.trim() }, 'Đã đảo xác nhận COD bằng bản ghi bù.', `cod-acceptance-reverse-${selected.acceptance.id}`);
  }

  async function reverseHandover() {
    if (!selected || !reversalReason.trim()) { setMessage('Cần nhập lý do đảo bàn giao.'); return; }
    await mutate(`/api/cod-reconciliation/handovers/${selected.id}/reverse`, { reason: reversalReason.trim() }, 'Đã đảo bàn giao COD.', `cod-handover-reverse-${selected.id}`);
  }

  async function reverseCollection(collectionId: string) {
    if (!reversalReason.trim()) { setMessage('Cần nhập lý do đảo khoản thu COD.'); return; }
    await mutate(`/api/cod-reconciliation/collections/${collectionId}/reverse`, { reason: reversalReason.trim() }, 'Đã đảo khoản thu COD và các bút toán liên quan.', `cod-collection-reverse-${collectionId}`);
  }

  return (
    <div className={styles.workspace} data-testid="cod-reconciliation-workspace">
      {message ? <div className={styles.notice} role="status">{message}</div> : null}
      <div className={styles.columns}>
        <section className={styles.card}>
          <h2>Bàn giao COD</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Chuyến</th><th>Tài xế</th><th>Kho</th><th className={styles.amount}>Bàn giao</th><th className={styles.amount}>Chênh lệch</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {handovers.map((handover) => (
                  <tr key={handover.id} className={selectedId === handover.id ? styles.selected : undefined}>
                    <td><button className={styles.linkButton} disabled={busy} onClick={() => select(handover.id)}>{handover.tripNumber || handover.tripId}</button><br /><span>{new Date(handover.handedOverAt).toLocaleString('vi-VN')}</span></td>
                    <td>{handover.driverCode}<br /><span>{handover.driverName}</span></td>
                    <td>{handover.warehouseCode}<br /><span>{handover.warehouseName}</span></td>
                    <td className={styles.amount}>{money(handover.handedOverTotal)}</td>
                    <td className={styles.amount}>{money(handover.differenceAmount)}</td>
                    <td>{statusLabel(handover.status)}</td>
                  </tr>
                ))}
                {!handovers.length ? <tr><td colSpan={6}>Chưa có bàn giao COD.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.card}>
          <h2>Đối chiếu và xác nhận</h2>
          {!selected ? <p>Chọn một bàn giao COD.</p> : (
            <>
              <div className={styles.summary}>
                <strong>{selected.tripNumber} · {selected.driverName}</strong>
                <span>Tài xế khai bàn giao: {money(selected.handedOverTotal)}</span>
                <span>Tiền thừa chưa gắn phiếu: {money(selected.unattributedExcessAmount)}</span>
                <span>Chênh lệch lúc lập bàn giao: {money(selected.differenceAmount)}</span>
                <span>Trạng thái: {statusLabel(selected.status)}</span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Phiếu giao</th><th>Khách hàng</th><th className={styles.amount}>Đang giữ</th><th className={styles.amount}>Bàn giao</th><th /></tr></thead>
                  <tbody>{selected.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.deliveryOrderNumber}</td>
                      <td>{line.customerCode}<br /><span>{line.customerName}</span></td>
                      <td className={styles.amount}>{money(line.expectedAmount)}</td>
                      <td className={styles.amount}>{money(line.handedOverAmount)}</td>
                      <td><button type="button" disabled={busy || selected.status !== 'reversed'} onClick={() => reverseCollection(line.collectionId)}>Đảo thu</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>

              {selected.status === 'submitted' && !selected.acceptance ? (
                <div className={styles.formGrid}>
                  <label>Số tiền công ty thực nhận<input inputMode="decimal" value={acceptedAmount} onChange={(event) => setAcceptedAmount(event.target.value)} /></label>
                  <label className={styles.wide}>Lý do chênh lệch<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                  <label className={styles.wide}>Ghi chú<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
                  <button className={styles.wide} type="button" disabled={busy} onClick={accept}>Xác nhận tiền thực nhận</button>
                </div>
              ) : null}

              <label className={styles.reason}>Lý do đảo
                <textarea value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} />
              </label>
              <div className={styles.actions}>
                {selected.acceptance && !selected.acceptance.reversalId ? <button disabled={busy} onClick={reverseAcceptance}>Đảo xác nhận</button> : null}
                {(!selected.acceptance || selected.acceptance.reversalId) && selected.status !== 'reversed' ? <button disabled={busy} onClick={reverseHandover}>Đảo bàn giao</button> : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
