'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CodAssignment, CodCollectionMethod, RecordCodCollectionPayload } from '../../../lib/types';
import styles from './cod-panel.module.css';

type Props = Readonly<{ tripId: string; assignment: CodAssignment }>;

function money(value: string | null, currency = 'VND') {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 6 }).format(number)
    : `${value ?? '0'} ${currency}`;
}

function localDateTime(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

const METHOD_LABELS: Record<CodCollectionMethod, string> = {
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
  NONE: 'Chưa thu',
};

export default function CodCollectionPanel({ tripId, assignment }: Props) {
  const router = useRouter();
  const [method, setMethod] = useState<CodCollectionMethod>('CASH');
  const [receivedAmount, setReceivedAmount] = useState(assignment.amountDue ?? '');
  const [externalReference, setExternalReference] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [promisedBy, setPromisedBy] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const keyRef = useRef<string | null>(null);

  if (assignment.collectionPolicy !== 'COLLECT_ON_DELIVERY') return null;
  if (!['delivered_full', 'delivered_partial'].includes(assignment.deliveryAttemptResult ?? '')) return null;

  if (assignment.collection) {
    const collection = assignment.collection;
    return (
      <section className={styles.panel} data-testid={`cod-collection-${assignment.assignmentId}`}>
        <div className={styles.status}>{collection.reversed ? 'Đã đảo' : METHOD_LABELS[collection.collectionMethod]}</div>
        <h3>Tiền COD</h3>
        <div className={styles.summary}>
          <div><span>Phải thu lúc giao</span><strong>{money(collection.expectedAmount, collection.currencyCode)}</strong></div>
          <div><span>Đã nhận từ khách</span><strong>{money(collection.receivedAmount, collection.currencyCode)}</strong></div>
          {collection.collectionMethod === 'CASH' ? (
            <div><span>Tài xế còn giữ</span><strong>{money(collection.custodyRemainingAmount, collection.currencyCode)}</strong></div>
          ) : null}
          <div><span>Phiếu thu</span><strong>{collection.paymentDocumentNumber || 'Không phát sinh'}</strong></div>
        </div>
        {collection.reasonCode ? <p>Lý do: {collection.reasonCode}</p> : null}
        {collection.promisedBy ? <p>Người hẹn: {collection.promisedBy}</p> : null}
        {collection.dueAt ? <p>Hẹn trả: {new Date(collection.dueAt).toLocaleString('vi-VN')}</p> : null}
        {collection.note ? <p>Ghi chú: {collection.note}</p> : null}
        <p className={styles.notice}>Tiền khách đã trả và tiền tài xế đang giữ được theo dõi riêng.</p>
      </section>
    );
  }

  async function submit() {
    setMessage('');
    if (method !== 'NONE' && (!receivedAmount || Number(receivedAmount) <= 0)) {
      setMessage('Cần nhập số tiền thực thu.');
      return;
    }
    if (method === 'BANK_TRANSFER' && !externalReference.trim()) {
      setMessage('Cần nhập mã tham chiếu chuyển khoản.');
      return;
    }
    if (method === 'NONE' && (!reasonCode || !promisedBy.trim() || !dueAt)) {
      setMessage('Chưa thu tiền cần có lý do, người hẹn và thời điểm hẹn trả.');
      return;
    }
    const payload: RecordCodCollectionPayload = {
      collectionMethod: method,
      receivedAmount: method === 'NONE' ? undefined : receivedAmount,
      externalReference: method === 'BANK_TRANSFER' ? externalReference.trim() : null,
      reasonCode: reasonCode || null,
      promisedBy: method === 'NONE' ? promisedBy.trim() : null,
      dueAt: method === 'NONE' ? new Date(dueAt).toISOString() : null,
      note: note.trim() || null,
      collectedAt: new Date().toISOString(),
    };
    if (!keyRef.current) keyRef.current = `cod-collection-${crypto.randomUUID()}`;
    setBusy(true);
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/assignments/${encodeURIComponent(assignment.assignmentId)}/cod-collections`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyRef.current },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || 'Không ghi được tiền COD.');
      keyRef.current = null;
      setMessage('Đã ghi tiền COD.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không ghi được tiền COD.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} data-testid={`cod-form-${assignment.assignmentId}`}>
      <h3>Ghi tiền COD</h3>
      <p>Phải thu hiện tại: <strong>{money(assignment.amountDue, assignment.currencyCode ?? 'VND')}</strong></p>
      <div className={styles.methods}>
        {(Object.keys(METHOD_LABELS) as CodCollectionMethod[]).map((value) => (
          <label key={value}>
            <input type="radio" checked={method === value} onChange={() => setMethod(value)} />
            {METHOD_LABELS[value]}
          </label>
        ))}
      </div>
      {method !== 'NONE' ? (
        <label className={styles.field}>Số tiền thực thu
          <input inputMode="decimal" value={receivedAmount} onChange={(event) => setReceivedAmount(event.target.value)} />
        </label>
      ) : null}
      {method === 'BANK_TRANSFER' ? (
        <label className={styles.field}>Mã tham chiếu ngân hàng
          <input value={externalReference} maxLength={256} onChange={(event) => setExternalReference(event.target.value)} />
        </label>
      ) : null}
      {(method === 'NONE' || (assignment.amountDue !== null && receivedAmount !== assignment.amountDue)) ? (
        <label className={styles.field}>Lý do
          <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
            <option value="">Chọn lý do</option>
            <option value="CUSTOMER_PROMISED">Khách hẹn trả</option>
            <option value="PARTIAL_PAYMENT">Khách trả một phần</option>
            <option value="CUSTOMER_OVERPAID">Khách trả thừa</option>
            <option value="OTHER">Lý do khác</option>
          </select>
        </label>
      ) : null}
      {method === 'NONE' ? (
        <>
          <label className={styles.field}>Người hẹn trả
            <input value={promisedBy} maxLength={256} onChange={(event) => setPromisedBy(event.target.value)} />
          </label>
          <label className={styles.field}>Thời điểm hẹn trả
            <input type="datetime-local" min={localDateTime(new Date())} value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          </label>
        </>
      ) : null}
      <label className={styles.field}>Ghi chú
        <textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {message ? <p className={message.startsWith('Đã') ? styles.notice : styles.error} role="status">{message}</p> : null}
      <button className={styles.button} type="button" disabled={busy} onClick={submit}>{busy ? 'Đang ghi…' : 'Xác nhận tiền COD'}</button>
    </section>
  );
}
