'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from './trip-reconciliation-workspace.module.css';

type TripListItem = Readonly<{
  id: string;
  number: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  licensePlate: string | null;
  driverName: string | null;
  status: 'draft' | 'planned' | 'locked' | 'dispatched' | 'closed';
}>;

type ReconciliationLine = Readonly<{
  assignmentId: string;
  stopSequence: number;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  customerCode: string | null;
  customerName: string | null;
  attemptId: string | null;
  attemptResult: 'delivered_full' | 'delivered_partial' | 'failed' | 'rescheduled' | null;
  inventoryIssueLineId: string;
  sku: string;
  itemName: string;
  unitCode: string;
  locationCode: string | null;
  lotCode: string | null;
  issuedBaseQuantity: string;
  deliveredBaseQuantity: string;
  returnedBaseQuantity: string;
  outstandingBaseQuantity: string;
}>;

type ReturnReceipt = Readonly<{
  id: string;
  inventoryMovementId: string;
  receivedAt: string;
  note: string | null;
  lines: readonly Readonly<{
    inventoryIssueLineId: string;
    returnedBaseQuantity: string;
    sku: string;
  }>[];
}>;

type Reconciliation = Readonly<{
  id: string;
  number: string;
  status: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  licensePlate: string | null;
  driverName: string | null;
  canClose: boolean;
  closedAt: string | null;
  lines: readonly ReconciliationLine[];
  receipts: readonly ReturnReceipt[];
}>;

type ApiEnvelope<T> = Readonly<{
  data?: T;
  error?: { message?: string };
}>;

const RESULT_LABELS: Record<NonNullable<ReconciliationLine['attemptResult']>, string> = {
  delivered_full: 'Giao đủ',
  delivered_partial: 'Giao một phần',
  failed: 'Không giao được',
  rescheduled: 'Hẹn giao lại',
};

function formatDateTime(value: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('vi-VN');
}

function localDateTimeValue(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new Error(envelope.error?.message || 'Yêu cầu đối soát không thành công.');
  }
  return envelope.data;
}

function freshKey(prefix: string): string {
  return `trip-reconciliation-${prefix}-${crypto.randomUUID()}`;
}

export default function TripReconciliationWorkspace() {
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [selectedTripId, setSelectedTripId] = useState('');
  const [detail, setDetail] = useState<Reconciliation | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [receivedAt, setReceivedAt] = useState(localDateTimeValue());
  const [receiptNote, setReceiptNote] = useState('');
  const [closeAt, setCloseAt] = useState(localDateTimeValue());
  const [closeNote, setCloseNote] = useState('');
  const [receiptKey, setReceiptKey] = useState('');
  const [closeKey, setCloseKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const availableTrips = useMemo(
    () => trips.filter((trip) => trip.status === 'dispatched' || trip.status === 'closed'),
    [trips],
  );

  const outstandingLines = useMemo(
    () => detail?.lines.filter((line) => Number(line.outstandingBaseQuantity) > 0) ?? [],
    [detail],
  );

  const selectedReturnLines = useMemo(
    () => outstandingLines
      .map((line) => ({
        inventoryIssueLineId: line.inventoryIssueLineId,
        returnedBaseQuantity: quantities[line.inventoryIssueLineId]?.trim() || '',
      }))
      .filter((line) => Number(line.returnedBaseQuantity) > 0),
    [outstandingLines, quantities],
  );

  const loadTrips = useCallback(async () => {
    const next = await requestJson<TripListItem[]>('/api/logistics/trips?status=all');
    setTrips(next);
  }, []);

  const loadDetail = useCallback(async (tripId: string) => {
    const next = await requestJson<Reconciliation>(`/api/logistics/trips/${tripId}/reconciliation`);
    setDetail(next);
    setQuantities(Object.fromEntries(
      next.lines
        .filter((line) => Number(line.outstandingBaseQuantity) > 0)
        .map((line) => [line.inventoryIssueLineId, line.outstandingBaseQuantity]),
    ));
  }, []);

  useEffect(() => {
    setBusy(true);
    loadTrips()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Không tải được chuyến.'))
      .finally(() => setBusy(false));
  }, [loadTrips]);

  async function selectTrip(tripId: string) {
    setSelectedTripId(tripId);
    setDetail(null);
    setError('');
    setStatus('');
    setReceiptKey('');
    setCloseKey('');
    setBusy(true);
    try {
      await loadDetail(tripId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được đối soát.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReceipt() {
    if (!detail || selectedReturnLines.length === 0) return;
    const timestamp = toIso(receivedAt);
    if (!timestamp) {
      setError('Thời điểm kho nhận không hợp lệ.');
      return;
    }
    const key = receiptKey || freshKey('receive');
    setReceiptKey(key);
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await requestJson(`/api/logistics/trips/${detail.id}/return-receipts`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({
          receivedAt: timestamp,
          note: receiptNote.trim() || null,
          lines: selectedReturnLines,
        }),
      });
      setReceiptKey('');
      setReceiptNote('');
      setStatus('Đã ghi nhận hàng quay về kho và cập nhật tồn kho.');
      await loadDetail(detail.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không ghi nhận được hàng quay về kho.');
    } finally {
      setBusy(false);
    }
  }

  async function submitClose() {
    if (!detail?.canClose) return;
    const timestamp = toIso(closeAt);
    if (!timestamp) {
      setError('Thời điểm đóng chuyến không hợp lệ.');
      return;
    }
    const key = closeKey || freshKey('close');
    setCloseKey(key);
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await requestJson(`/api/logistics/trips/${detail.id}/close`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ closedAt: timestamp, note: closeNote.trim() || null }),
      });
      setCloseKey('');
      setStatus('Chuyến đã được đóng sau khi đối soát đủ.');
      await Promise.all([loadDetail(detail.id), loadTrips()]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không đóng được chuyến.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      kicker="Điều phối giao hàng"
      title="Đối soát cuối chuyến"
      subtitle="Kho xác nhận hàng chưa giao thực sự quay về; chuyến chỉ đóng khi hàng trên xe đã về bằng 0."
      actions={<Link className={styles.linkButton} href="/logistics/delivery-attempts">Kết quả lần giao</Link>}
    >
      <div className={styles.workspace} data-testid="trip-reconciliation-workspace">
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {status ? <p className={styles.success} role="status">{status}</p> : null}

        <div className={styles.columns}>
          <section className={styles.panel}>
            <div className={styles.heading}>
              <div><p>Chuyến giao</p><h2>Chọn chuyến đối soát</h2></div>
              <button type="button" onClick={() => loadTrips()} disabled={busy}>Tải lại</button>
            </div>
            <div className={styles.tripList}>
              {availableTrips.map((trip) => (
                <button
                  type="button"
                  key={trip.id}
                  onClick={() => selectTrip(trip.id)}
                  disabled={busy}
                  className={selectedTripId === trip.id ? styles.selected : ''}
                >
                  <strong>{trip.number}</strong>
                  <span>{trip.warehouseCode || trip.warehouseName || 'Kho'} · {trip.driverName || 'Tài xế'}</span>
                  <small>{trip.licensePlate || 'Chưa rõ xe'} · {trip.status === 'closed' ? 'Đã đóng' : 'Đang giao'}</small>
                </button>
              ))}
              {!availableTrips.length && !busy ? <p className={styles.empty}>Chưa có chuyến cần đối soát.</p> : null}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.heading}>
              <div><p>Đối chiếu số lượng</p><h2>{detail?.number || 'Chưa chọn chuyến'}</h2></div>
              {detail ? <span className={detail.canClose ? styles.ready : styles.pending}>{detail.canClose ? 'Đủ điều kiện đóng' : 'Còn việc cần xử lý'}</span> : null}
            </div>

            {!detail ? <p className={styles.empty}>{busy ? 'Đang tải…' : 'Chọn chuyến bên trái để xem chi tiết.'}</p> : (
              <>
                <div className={styles.summary}>
                  <span>Kho: <strong>{detail.warehouseCode || detail.warehouseName}</strong></span>
                  <span>Tài xế: <strong>{detail.driverName || 'Chưa rõ'}</strong></span>
                  <span>Xe: <strong>{detail.licensePlate || 'Chưa rõ'}</strong></span>
                </div>
                <div className={styles.tableWrap}>
                  <table>
                    <thead><tr><th>Phiếu / hàng</th><th>Kết quả</th><th>Xuất</th><th>Đã giao</th><th>Đã về</th><th>Còn xe</th></tr></thead>
                    <tbody>
                      {detail.lines.map((line) => (
                        <tr key={line.inventoryIssueLineId}>
                          <td><strong>{line.deliveryOrderNumber || line.deliveryOrderId.slice(0, 8)}</strong><small>{line.sku} · {line.itemName}<br />{line.locationCode || 'Vị trí gốc'}{line.lotCode ? ` · Lô ${line.lotCode}` : ''}</small></td>
                          <td>{line.attemptResult ? RESULT_LABELS[line.attemptResult] : 'Chưa có kết quả'}</td>
                          <td>{line.issuedBaseQuantity}</td>
                          <td>{line.deliveredBaseQuantity}</td>
                          <td>{line.returnedBaseQuantity}</td>
                          <td><strong>{line.outstandingBaseQuantity}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {detail.status === 'dispatched' && outstandingLines.length > 0 ? (
                  <div className={styles.actionBox}>
                    <h3>Kho nhận hàng chưa giao</h3>
                    {outstandingLines.map((line) => (
                      <label key={line.inventoryIssueLineId} className={styles.quantityRow}>
                        <span>{line.sku} · còn {line.outstandingBaseQuantity} {line.unitCode}</span>
                        <input
                          inputMode="decimal"
                          aria-label={`Số lượng nhận lại ${line.sku}`}
                          value={quantities[line.inventoryIssueLineId] || ''}
                          onChange={(event) => setQuantities((current) => ({ ...current, [line.inventoryIssueLineId]: event.target.value }))}
                        />
                      </label>
                    ))}
                    <label>Thời điểm kho nhận<input type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></label>
                    <label>Ghi chú<textarea value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} maxLength={2000} /></label>
                    <button type="button" onClick={submitReceipt} disabled={busy || selectedReturnLines.length === 0}>Xác nhận nhập hàng về kho</button>
                  </div>
                ) : null}

                {detail.status === 'dispatched' ? (
                  <div className={styles.actionBox}>
                    <h3>Đóng chuyến</h3>
                    <p>Chỉ đóng khi mọi phiếu đã có kết quả và tất cả số lượng đã giao hoặc đã về kho.</p>
                    <label>Thời điểm đóng<input type="datetime-local" value={closeAt} onChange={(event) => setCloseAt(event.target.value)} /></label>
                    <label>Ghi chú<textarea value={closeNote} onChange={(event) => setCloseNote(event.target.value)} maxLength={2000} /></label>
                    <button type="button" onClick={submitClose} disabled={busy || !detail.canClose}>Đóng chuyến đã đối soát</button>
                  </div>
                ) : <p className={styles.closed}>Đã đóng chuyến lúc {formatDateTime(detail.closedAt)}.</p>}

                {detail.receipts.length > 0 ? (
                  <div className={styles.receipts}>
                    <h3>Lịch sử kho nhận lại</h3>
                    {detail.receipts.map((receipt) => (
                      <article key={receipt.id}>
                        <strong>{formatDateTime(receipt.receivedAt)}</strong>
                        <span>Movement: {receipt.inventoryMovementId.slice(0, 8)}</span>
                        <small>{receipt.lines.length} dòng · {receipt.note || 'Không ghi chú'}</small>
                      </article>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
