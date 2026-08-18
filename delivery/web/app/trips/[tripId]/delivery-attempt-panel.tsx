'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  DeliveryAttemptLine,
  DeliveryAttemptResult,
  RecordDeliveryAttemptPayload,
  TripAssignment,
} from '../../../lib/types';
import MobileActionDialog from './mobile-action-dialog';
import ProofOfDeliveryPanel from './proof-of-delivery-panel';
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

const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const QUANTITY_SCALE = BigInt('1000000000000');
const ZERO_QUANTITY = BigInt(0);

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

function parseQuantity(value: string): bigint | null {
  const normalized = value.trim();
  const match = QUANTITY_PATTERN.exec(normalized);
  if (!match) return null;
  return BigInt(match[1]) * QUANTITY_SCALE + BigInt((match[2] ?? '').padEnd(12, '0'));
}

function formatScaledQuantity(value: bigint): string {
  const whole = value / QUANTITY_SCALE;
  const fraction = String(value % QUANTITY_SCALE).padStart(12, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function remainingQuantity(issued: string, delivered: string): string | null {
  const issuedValue = parseQuantity(issued);
  const deliveredValue = parseQuantity(delivered);
  if (issuedValue === null || deliveredValue === null || deliveredValue > issuedValue) return null;
  return formatScaledQuantity(issuedValue - deliveredValue);
}

function baseUnitLabel(line: DeliveryAttemptLine): string {
  return line.baseUnitCode || 'đơn vị tồn';
}

function unitRelationship(line: DeliveryAttemptLine): string | null {
  if (!line.unitCode || !line.baseUnitCode || !line.conversionToBase) return null;
  const conversion = quantityText(line.conversionToBase);
  if (line.unitCode === line.baseUnitCode && conversion === '1') {
    return `Đơn vị giao: ${line.baseUnitCode}`;
  }
  return `Quy cách: 1 ${line.unitCode} = ${conversion} ${line.baseUnitCode}`;
}

export default function DeliveryAttemptPanel({ tripId, assignment }: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
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

  function operationKey(signature: string): string {
    const existing = keys.current.get(signature);
    if (existing) return existing;
    const next = createIdempotencyKey('delivery-attempt');
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
    if ((result === 'delivered_full' || result === 'delivered_partial')
      && assignment.lines.some((line) => !line.baseUnitCode || !line.conversionToBase)) {
      setError('Có mặt hàng chưa xác định được quy cách hoặc đơn vị tồn. Vui lòng báo kho kiểm tra trước khi ghi giao.');
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

    if (result === 'delivered_partial') {
      for (const line of assignment.lines) {
        const entered = quantities[line.inventoryIssueLineId] || '0';
        const delivered = parseQuantity(entered);
        const issued = parseQuantity(line.issuedBaseQuantity);
        if (delivered === null || issued === null || delivered > issued) {
          setError(`Số thực giao của ${line.itemName || line.sku || 'mặt hàng'} không hợp lệ.`);
          return;
        }
        if (!line.baseUnitAllowsFractional && delivered % QUANTITY_SCALE !== ZERO_QUANTITY) {
          setError(`Số thực giao của ${line.itemName || line.sku || 'mặt hàng'} phải là số nguyên theo đơn vị ${baseUnitLabel(line)}.`);
          return;
        }
      }
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
      setDialogOpen(false);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không ghi được kết quả giao.');
    } finally {
      setBusy(false);
    }
  }

  if (assignment.attempt) {
    return (
      <div data-testid={`attempt-recorded-${assignment.assignmentId}`}>
        <button className={`${styles.trigger} ${styles.recordedTrigger}`} type="button" onClick={() => setDialogOpen(true)}>
          {LABELS[assignment.attempt.result]}
        </button>
        <MobileActionDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          eyebrow="Kết quả giao"
          title={assignment.deliveryOrderNumber || 'Phiếu giao'}
        >
          <section className={styles.recorded}>
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
                {assignment.lines.map((line) => {
                  const delivered = line.deliveredBaseQuantity || '0';
                  const remaining = remainingQuantity(line.issuedBaseQuantity, delivered);
                  const relationship = unitRelationship(line);
                  return (
                    <li key={line.inventoryIssueLineId}>
                      <span>
                        {line.itemName || line.sku || 'Mặt hàng'}
                        {relationship ? <small>{relationship}</small> : null}
                      </span>
                      <strong>
                        Đã giao {quantityText(delivered)} / {quantityText(line.issuedBaseQuantity)} {baseUnitLabel(line)}
                      </strong>
                      {remaining !== null ? <small>Còn trên xe: {remaining} {baseUnitLabel(line)}</small> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <p className={styles.terminalNotice}>Kết quả đã khóa và chỉ đọc.</p>
          </section>
          <section className={styles.podSection}>
            <h3>Bằng chứng giao hàng</h3>
            <ProofOfDeliveryPanel
              tripId={tripId}
              assignmentId={assignment.assignmentId}
              attemptId={assignment.attempt.id}
            />
          </section>
        </MobileActionDialog>
      </div>
    );
  }

  return (
    <div data-testid={`attempt-workflow-${assignment.assignmentId}`}>
      <button className={styles.trigger} type="button" onClick={() => setDialogOpen(true)}>Ghi giao</button>
      <MobileActionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        eyebrow="Tác nghiệp"
        title={assignment.deliveryOrderNumber || 'Ghi kết quả giao'}
      >
        <section className={styles.panel} data-testid={`attempt-form-${assignment.assignmentId}`}>
          <fieldset disabled={busy}>
            <legend>Kết quả giao</legend>
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
                <p>Nhập số khách thực nhận theo đơn vị tồn hiển thị ở từng dòng.</p>
                {assignment.lines.map((line) => {
                  const entered = quantities[line.inventoryIssueLineId] || '0';
                  const remaining = remainingQuantity(line.issuedBaseQuantity, entered);
                  const relationship = unitRelationship(line);
                  return (
                    <label key={line.inventoryIssueLineId}>
                      <span>
                        <strong>{line.itemName || line.sku || 'Mặt hàng'}</strong>
                        {relationship ? <small>{relationship}</small> : null}
                        <small>Đã xuất: {quantityText(line.issuedBaseQuantity)} {baseUnitLabel(line)}</small>
                      </span>
                      <input
                        inputMode={line.baseUnitAllowsFractional ? 'decimal' : 'numeric'}
                        value={entered}
                        onChange={(event) => setQuantities((current) => ({
                          ...current,
                          [line.inventoryIssueLineId]: event.target.value,
                        }))}
                        aria-label={`Số thực giao ${line.itemName || line.sku || ''} theo ${baseUnitLabel(line)}`}
                      />
                      <small>Đơn vị nhập: {baseUnitLabel(line)}</small>
                      {remaining !== null ? <small>Còn trên xe: {remaining} {baseUnitLabel(line)}</small> : null}
                    </label>
                  );
                })}
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
      </MobileActionDialog>
    </div>
  );
}