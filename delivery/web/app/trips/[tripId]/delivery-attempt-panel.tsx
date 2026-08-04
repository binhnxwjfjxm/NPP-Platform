'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  DeliveryAttemptResult,
  RecordDeliveryAttemptPayload,
  TripAssignment,
} from '../../../lib/types';
import styles from './delivery-attempt-panel.module.css';

type Props = Readonly<{
  tripId: string;
  assignment: TripAssignment;
}>;

const LABELS: Record<DeliveryAttemptResult, string> = {
  delivered_full: 'Giao đủ',
  delivered_partial: 'Giao một phần',
  failed: 'Không giao được',
  rescheduled: 'Hẹn giao lại',
};

const REASONS = [
  ['CUSTOMER_CLOSED', 'Khách đóng cửa'],
  ['CUSTOMER_REFUSED', 'Khách từ chối nhận'],
  ['ADDRESS_ISSUE', 'Không xác định được địa chỉ'],
  ['REQUESTED_NEW_TIME', 'Khách yêu cầu giờ khác'],
  ['OTHER', 'Lý do khác'],
] as const;

function localDateTimeValue(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

function quantityText(value: string): string {
  const normalized = value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return normalized || '0';
}

export default function DeliveryAttemptPanel({ tripId, assignment }: Props) {
  const router = useRouter();
  const [result, setResult] = useState<DeliveryAttemptResult>('delivered_full');
  const [attemptedAt] = useState(() => new Date().toISOString());
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [rescheduledFor, setRescheduledFor] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>(
    () => Object.fromEntries(assignment.lines.map((line) => [line.inventoryIssueLineId, '0'])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const keys = useRef(new Map<string, string>());

  const totalIssued = useMemo(
    () => assignment.lines.reduce((total, line) => total + Number(line.issuedBaseQuantity), 0),
    [assignment.lines],
  );

  function operationKey(signature: string): string {
    const existing = keys.current.get(signature);
    if (existing) return existing;
    const next = `delivery-attempt-${crypto.randomUUID()}`;
    keys.current.set(signature, next);
    return next;
  }

  async function submitAttempt() {
    setError('');
    setMessage('');
    if (!assignment.lines.length) {
      setError('Phiếu chưa có dữ liệu hàng đã xuất kho để đối chiếu.');
      return;
    }
    if ((result === 'failed' || result === 'rescheduled') && !reasonCode) {
      setError('Cần chọn lý do.');
      return;
    }
    if (result === 'rescheduled' && !rescheduledFor) {
      setError('Cần chọn thời điểm giao lại.');
      return;
    }

    const payload: RecordDeliveryAttemptPayload = {
      result,
      attemptedAt,
      reasonCode: result === 'failed' || result === 'rescheduled' ? reasonCode : null,
      note: note.trim() || null,
      rescheduledFor: result === 'rescheduled'
        ? new Date(rescheduledFor).toISOString()
        : null,
      lines: result === 'delivered_partial'
        ? assignment.lines.map((line) => ({
            inventoryIssueLineId: line.inventoryIssueLineId,
            deliveredBaseQuantity: quantities[line.inventoryIssueLineId] || '0',
          }))
        : undefined,
    };
    const signature = JSON.stringify(payload);
    setBusy(true);
    try {
      const response = await fetch(
        `/api/trips/${encodeURIComponent(tripId)}/assignments/${encodeURIComponent(assignment.assignmentId)}/attempts`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': operationKey(signature),
          },
          body: signature,
        },
      );
      const body = await response.json().catch(() => null) as {
        data?: { replayed?: boolean };
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.data) {
        throw new Error(body?.error?.message || 'Không ghi được kết quả giao.');
      }
      setMessage(body.data.replayed
        ? 'Yêu cầu đã được xử lý trước đó; đang tải lại kết quả.'
        : 'Đã ghi kết quả giao.');
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không ghi được kết quả giao.');
    } finally {
      setBusy(false);
    }
  }

  if (assignment.attempt) {
    return (
      <section className={styles.recorded} data-testid={`attempt-recorded-${assignment.assignmentId}`}>
        <div className={styles.recordedHeading}>
          <strong>{LABELS[assignment.attempt.result]}</strong>
          <span>{formatDateTime(assignment.attempt.attemptedAt)}</span>
        </div>
        {assignment.attempt.reasonCode ? <p>Lý do: {assignment.attempt.reasonCode}</p> : null}
        {assignment.attempt.rescheduledFor ? (
          <p>Giao lại: {formatDateTime(assignment.attempt.rescheduledFor)}</p>
        ) : null}
        {assignment.attempt.note ? <p>Ghi chú: {assignment.attempt.note}</p> : null}
        {assignment.lines.some((line) => line.deliveredBaseQuantity !== null) ? (
          <ul className={styles.recordedLines}>
            {assignment.lines.map((line) => (
              <li key={line.inventoryIssueLineId}>
                <span>{line.itemName || line.sku || 'Mặt hàng'}</span>
                <strong>
                  {quantityText(line.deliveredBaseQuantity || '0')} / {quantityText(line.issuedBaseQuantity)} {line.unitCode || ''}
                </strong>
              </li>
            ))}
          </ul>
        ) : null}
        <p className={styles.terminalNotice}>Kết quả đã khóa và chỉ đọc.</p>
      </section>
    );
  }

  return (
    <section className={styles.panel} data-testid={`attempt-form-${assignment.assignmentId}`}>
      <fieldset disabled={busy}>
        <legend>Ghi kết quả giao</legend>
        <div className={styles.resultGrid}>
          {(Object.keys(LABELS) as DeliveryAttemptResult[]).map((value) => (
            <label key={value} className={result === value ? styles.selectedResult : ''}>
              <input
                type="radio"
                name={`result-${assignment.assignmentId}`}
                value={value}
                checked={result === value}
                onChange={() => setResult(value)}
              />
              {LABELS[value]}
            </label>
          ))}
        </div>

        {result === 'delivered_partial' ? (
          <div className={styles.lineEditor}>
            <p>Nhập số thực giao trên từng dòng. Tổng phải lớn hơn 0 và nhỏ hơn hàng đã xuất.</p>
            {assignment.lines.map((line) => (
              <label key={line.inventoryIssueLineId}>
                <span>
                  <strong>{line.itemName || line.sku || 'Mặt hàng'}</strong>
                  <small>Đã xuất: {quantityText(line.issuedBaseQuantity)} {line.unitCode || ''}</small>
                </span>
                <input
                  inputMode="decimal"
                  value={quantities[line.inventoryIssueLineId] || '0'}
                  onChange={(event) => setQuantities((current) => ({
                    ...current,
                    [line.inventoryIssueLineId]: event.target.value,
                  }))}
                  aria-label={`Số thực giao ${line.itemName || line.sku || ''}`}
                />
              </label>
            ))}
            <small>Tổng hàng đã xuất tham chiếu: {totalIssued.toLocaleString('vi-VN')}</small>
          </div>
        ) : null}

        {result === 'failed' || result === 'rescheduled' ? (
          <label className={styles.field}>
            Lý do
            <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
              <option value="">Chọn lý do</option>
              {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        ) : null}

        {result === 'rescheduled' ? (
          <label className={styles.field}>
            Thời điểm giao lại
            <input
              type="datetime-local"
              min={localDateTimeValue(new Date())}
              value={rescheduledFor}
              onChange={(event) => setRescheduledFor(event.target.value)}
            />
          </label>
        ) : null}

        <label className={styles.field}>
          Ghi chú
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Thông tin cần để điều phối theo dõi"
          />
        </label>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.message} role="status">{message}</p> : null}
        <button type="button" className={styles.submit} onClick={submitAttempt} disabled={busy}>
          {busy ? 'Đang ghi…' : 'Xác nhận kết quả'}
        </button>
      </fieldset>
    </section>
  );
}
