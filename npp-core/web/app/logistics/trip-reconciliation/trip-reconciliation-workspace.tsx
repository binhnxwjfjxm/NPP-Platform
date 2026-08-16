'use client';

import { createIdempotencyKey } from '@npp/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from './trip-reconciliation-workspace.module.css';
import TripReconciliationPrintDock from './TripReconciliationPrintDock';

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

type TripReadiness = 'needs-reconciliation' | 'ready' | 'closed';

const RESULT_LABELS: Record<NonNullable<ReconciliationLine['attemptResult']>, string> = {
  delivered_full: 'Giao đủ',
  delivered_partial: 'Giao một phần',
  failed: 'Không giao được',
  rescheduled: 'Hẹn giao lại',
};

const FLOW_STEPS = [
  'Chọn chuyến',
  'Kiểm tra chênh lệch',
  'Nhận hàng trả về',
  'Đóng chuyến',
] as const;

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

function isPositiveQuantity(value: string): boolean {
  const normalized = String(value ?? '').trim();
  if (!/^\+?\d+(?:\.\d+)?$/.test(normalized)) return false;
  return normalized.replace(/[+.0]/g, '').length > 0;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { cache: 'no-store', ...init, headers });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new Error(envelope.error?.message || 'Yêu cầu đối soát không thành công.');
  }
  return envelope.data as T;
}

function readinessForDetail(detail: Reconciliation): TripReadiness {
  if (detail.status === 'closed') return 'closed';
  return detail.canClose ? 'ready' : 'needs-reconciliation';
}

function readinessLabel(readiness: TripReadiness): string {
  if (readiness === 'closed') return 'Đã đóng';
  if (readiness === 'ready') return 'Đủ điều kiện';
  return 'Cần đối soát';
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function TripReconciliationWorkspace() {
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [tripReadiness, setTripReadiness] = useState<Record<string, TripReadiness>>({});
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
    () => detail?.lines.filter((line) => isPositiveQuantity(line.outstandingBaseQuantity)) ?? [],
    [detail],
  );

  const missingResultLines = useMemo(
    () => detail?.lines.filter((line) => !line.attemptResult) ?? [],
    [detail],
  );

  const selectedReturnLines = useMemo(
    () => outstandingLines
      .map((line) => ({
        inventoryIssueLineId: line.inventoryIssueLineId,
        returnedBaseQuantity: quantities[line.inventoryIssueLineId]?.trim() || '',
      }))
      .filter((line) => isPositiveQuantity(line.returnedBaseQuantity)),
    [outstandingLines, quantities],
  );

  const flowPosition = useMemo(() => {
    if (!detail) return 0;
    if (detail.status === 'closed') return FLOW_STEPS.length;
    if (missingResultLines.length > 0 && outstandingLines.length === 0) return 1;
    if (outstandingLines.length > 0) return 2;
    if (detail.canClose) return 3;
    return 1;
  }, [detail, missingResultLines.length, outstandingLines.length]);

  const nextStep = useMemo(() => {
    if (!detail) {
      return {
        title: 'Chọn một chuyến cần đối soát',
        description: 'Chọn chuyến ở danh sách để xem hàng còn trên xe và việc cần xử lý.',
        action: 'select' as const,
      };
    }
    if (detail.status === 'closed') {
      return {
        title: 'Chuyến đã hoàn tất đối soát',
        description: `Đã đóng lúc ${formatDateTime(detail.closedAt)}. Lịch sử hàng kho nhận lại vẫn được giữ bên dưới.`,
        action: 'done' as const,
      };
    }
    if (outstandingLines.length > 0) {
      return {
        title: 'Nhận hàng chưa giao quay về kho',
        description: `${outstandingLines.length} dòng hàng vẫn còn trên xe. Kho cần xác nhận số thực nhận trước khi đóng chuyến.`,
        action: 'receive' as const,
      };
    }
    if (missingResultLines.length > 0) {
      return {
        title: 'Bổ sung kết quả lần giao',
        description: `${missingResultLines.length} dòng chưa có kết quả giao. Hoàn tất kết quả lần giao rồi quay lại đối soát.`,
        action: 'delivery-result' as const,
      };
    }
    if (detail.canClose) {
      return {
        title: 'Đủ điều kiện đóng chuyến',
        description: 'Hàng trên xe đã về 0 và hệ thống xác nhận đủ điều kiện. Kiểm tra lần cuối rồi đóng chuyến.',
        action: 'close' as const,
      };
    }
    return {
      title: 'Chuyến còn điều kiện chưa hoàn tất',
      description: 'Hệ thống chưa cho phép đóng chuyến. Kiểm tra chênh lệch và tải lại dữ liệu trước khi tiếp tục.',
      action: 'blocked' as const,
    };
  }, [detail, missingResultLines.length, outstandingLines.length]);

  const closeBlockedReason = useMemo(() => {
    if (!detail || detail.status !== 'dispatched' || detail.canClose) return '';
    if (outstandingLines.length > 0) {
      return `Chưa thể đóng: còn ${outstandingLines.length} dòng hàng trên xe chưa được kho nhận lại.`;
    }
    if (missingResultLines.length > 0) {
      return `Chưa thể đóng: còn ${missingResultLines.length} dòng chưa có kết quả lần giao.`;
    }
    return 'Chưa thể đóng: hệ thống chưa xác nhận đủ điều kiện đối soát.';
  }, [detail, missingResultLines.length, outstandingLines.length]);

  const loadTrips = useCallback(async () => {
    const next = await requestJson<TripListItem[]>('/api/logistics/trips?status=all');
    setTrips(next);
    setTripReadiness((current) => Object.fromEntries(
      next.map((trip) => [
        trip.id,
        trip.status === 'closed' ? 'closed' : current[trip.id] || 'needs-reconciliation',
      ]),
    ));
  }, []);

  const loadDetail = useCallback(async (tripId: string) => {
    const next = await requestJson<Reconciliation>(`/api/logistics/trips/${tripId}/reconciliation`);
    setDetail(next);
    setTripReadiness((current) => ({ ...current, [tripId]: readinessForDetail(next) }));
    setQuantities(Object.fromEntries(
      next.lines
        .filter((line) => isPositiveQuantity(line.outstandingBaseQuantity))
        .map((line) => [line.inventoryIssueLineId, line.outstandingBaseQuantity]),
    ));
  }, []);

  useEffect(() => {
    setBusy(true);
    loadTrips()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Không tải được chuyến.'))
      .finally(() => setBusy(false));
  }, [loadTrips]);

  async function reloadTrips() {
    setBusy(true);
    setError('');
    try {
      await loadTrips();
      if (selectedTripId) await loadDetail(selectedTripId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được chuyến.');
    } finally {
      setBusy(false);
    }
  }

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
    const key = receiptKey || createIdempotencyKey('trip-reconciliation-receive');
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
      setStatus('Đã ghi nhận hàng quay về kho và cập nhật tồn kho.');
      try {
        await loadDetail(detail.id);
        setReceiptKey('');
        setReceiptNote('');
      } catch {
        setError('Đã ghi nhận hàng quay về kho nhưng chưa tải lại được dữ liệu. Tải lại trước khi tạo phiếu mới.');
      }
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
    const key = closeKey || createIdempotencyKey('trip-reconciliation-close');
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
      setStatus('Chuyến đã được đóng sau khi đối soát đủ.');
      try {
        await Promise.all([loadDetail(detail.id), loadTrips()]);
        setCloseKey('');
      } catch {
        setError('Chuyến đã được đóng nhưng chưa tải lại được dữ liệu.');
      }
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
      subtitle="Đi theo 4 bước: chọn chuyến, kiểm tra chênh lệch, nhận hàng trả về rồi mới đóng chuyến."
      actions={<Link className={styles.linkButton} href="/logistics/delivery-attempts">Kết quả lần giao</Link>}
    >
      <div className={styles.workspace} data-testid="trip-reconciliation-workspace">
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {status ? <p className={styles.success} role="status">{status}</p> : null}

        <ol className={styles.flowSteps} aria-label="Các bước đối soát cuối chuyến">
          {FLOW_STEPS.map((step, index) => {
            const state = flowPosition > index ? 'done' : flowPosition === index ? 'active' : 'pending';
            return (
              <li key={step} className={styles[state]} aria-current={state === 'active' ? 'step' : undefined}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </li>
            );
          })}
        </ol>

        <div className={styles.columns}>
          <section className={`${styles.panel} ${styles.tripPanel}`}>
            <div className={styles.heading}>
              <div><p>Bước 1</p><h2>Chọn chuyến</h2></div>
              <button type="button" onClick={reloadTrips} disabled={busy}>Tải lại</button>
            </div>
            <p className={styles.panelHint}>Ưu tiên chuyến “Cần đối soát”; chuyến đủ điều kiện có thể đóng ngay.</p>
            <div className={styles.tripList}>
              {availableTrips.map((trip) => {
                const readiness = tripReadiness[trip.id] || (trip.status === 'closed' ? 'closed' : 'needs-reconciliation');
                return (
                  <button
                    type="button"
                    key={trip.id}
                    onClick={() => selectTrip(trip.id)}
                    disabled={busy}
                    className={selectedTripId === trip.id ? styles.selected : ''}
                  >
                    <span className={styles.tripListTopline}>
                      <strong>{trip.number}</strong>
                      <span className={`${styles.tripState} ${
                        readiness === 'closed'
                          ? styles.tripStateClosed
                          : readiness === 'ready'
                            ? styles.tripStateReady
                            : styles.tripStateNeeds
                      }`}>
                        {readinessLabel(readiness)}
                      </span>
                    </span>
                    <span>{trip.warehouseCode || trip.warehouseName || 'Kho'} · {trip.driverName || 'Tài xế'}</span>
                    <small>{trip.licensePlate || 'Chưa rõ xe'}</small>
                  </button>
                );
              })}
              {!availableTrips.length && !busy ? <p className={styles.empty}>Chưa có chuyến cần đối soát.</p> : null}
            </div>
          </section>

          <section className={`${styles.panel} ${styles.detailPanel}`}>
            <div className={styles.heading}>
              <div><p>Bước 2–4</p><h2>{detail?.number || 'Chi tiết đối soát'}</h2></div>
              {detail ? (
                <div className={styles.headingActions}>
                  <TripReconciliationPrintDock reconciliation={detail} />
                  <span className={detail.status === 'closed' ? styles.closedBadge : detail.canClose ? styles.ready : styles.pending}>
                    {detail.status === 'closed' ? 'Đã đóng' : detail.canClose ? 'Đủ điều kiện đóng' : 'Còn việc cần xử lý'}
                  </span>
                </div>
              ) : null}
            </div>

            {!detail ? (
              <div className={styles.blankState}>
                <strong>{busy ? 'Đang tải chuyến…' : 'Chưa chọn chuyến'}</strong>
                <p>{busy ? 'Dữ liệu đối soát đang được tải.' : 'Chọn một chuyến bên trái. Màn hình sẽ chỉ rõ việc tiếp theo và lý do chưa thể đóng nếu còn vướng.'}</p>
              </div>
            ) : (
              <>
                <div className={styles.summary}>
                  <span>Kho: <strong>{detail.warehouseCode || detail.warehouseName || 'Chưa rõ'}</strong></span>
                  <span>Tài xế: <strong>{detail.driverName || 'Chưa rõ'}</strong></span>
                  <span>Xe: <strong>{detail.licensePlate || 'Chưa rõ'}</strong></span>
                </div>

                <section className={styles.nextActionCard} data-testid="trip-reconciliation-next-action">
                  <div>
                    <p>Việc tiếp theo</p>
                    <h3>{nextStep.title}</h3>
                    <span>{nextStep.description}</span>
                  </div>
                  <div className={styles.nextActionStats}>
                    <span><strong>{outstandingLines.length}</strong><small>Dòng còn trên xe</small></span>
                    <span><strong>{missingResultLines.length}</strong><small>Dòng chưa có kết quả giao</small></span>
                  </div>
                  <div className={styles.nextActionButtons}>
                    {nextStep.action === 'receive' ? (
                      <button type="button" onClick={() => scrollToSection('trip-reconciliation-return')}>Nhận hàng trả về</button>
                    ) : null}
                    {nextStep.action === 'delivery-result' ? (
                      <Link className={styles.primaryLink} href="/logistics/delivery-attempts">Mở kết quả lần giao</Link>
                    ) : null}
                    {nextStep.action === 'close' ? (
                      <button type="button" onClick={() => scrollToSection('trip-reconciliation-close')}>Đi đến đóng chuyến</button>
                    ) : null}
                  </div>
                </section>

                <div className={styles.sectionHeading}>
                  <div><p>Bước 2</p><h3>Kiểm tra chênh lệch</h3></div>
                  <span>{outstandingLines.length > 0 ? `${outstandingLines.length} dòng còn trên xe` : 'Hàng trên xe đã về 0'}</span>
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

                {detail.status === 'dispatched' ? (
                  <section
                    id="trip-reconciliation-return"
                    className={`${styles.actionBox} ${outstandingLines.length > 0 ? styles.actionBoxActive : styles.actionBoxDone}`}
                  >
                    <div className={styles.actionBoxTitle}>
                      <div><p>Bước 3</p><h3>Nhận hàng trả về</h3></div>
                      <span>{outstandingLines.length > 0 ? 'Cần thực hiện' : 'Đã đủ'}</span>
                    </div>
                    {outstandingLines.length > 0 ? (
                      <>
                        <p>Nhập số lượng kho thực nhận. Hệ thống chỉ cho đóng chuyến khi hàng còn trên xe về 0.</p>
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
                        {selectedReturnLines.length === 0 ? <small className={styles.blockReason}>Nhập ít nhất một số lượng kho thực nhận lớn hơn 0.</small> : null}
                      </>
                    ) : (
                      <p>Không còn hàng trên xe cần kho nhận lại. Có thể chuyển sang bước đóng chuyến khi hệ thống xác nhận đủ điều kiện.</p>
                    )}
                  </section>
                ) : null}

                {detail.status === 'dispatched' ? (
                  <section
                    id="trip-reconciliation-close"
                    className={`${styles.actionBox} ${detail.canClose ? styles.actionBoxActive : styles.actionBoxBlocked}`}
                  >
                    <div className={styles.actionBoxTitle}>
                      <div><p>Bước 4</p><h3>Đóng chuyến</h3></div>
                      <span>{detail.canClose ? 'Sẵn sàng' : 'Chưa đủ điều kiện'}</span>
                    </div>
                    <p>Đóng chuyến chỉ khi mọi phiếu đã có kết quả và toàn bộ số lượng đã giao hoặc đã về kho.</p>
                    <label>Thời điểm đóng<input type="datetime-local" value={closeAt} onChange={(event) => setCloseAt(event.target.value)} /></label>
                    <label>Ghi chú<textarea value={closeNote} onChange={(event) => setCloseNote(event.target.value)} maxLength={2000} /></label>
                    <button type="button" onClick={submitClose} disabled={busy || !detail.canClose}>Đóng chuyến đã đối soát</button>
                    {closeBlockedReason ? <small className={styles.blockReason}>{closeBlockedReason}</small> : null}
                  </section>
                ) : (
                  <div className={styles.closedCard}>
                    <strong>Đã đóng chuyến</strong>
                    <span>Đã đóng chuyến lúc {formatDateTime(detail.closedAt)}.</span>
                  </div>
                )}

                {detail.receipts.length > 0 ? (
                  <div className={styles.receipts}>
                    <h3>Lịch sử kho nhận lại</h3>
                    {detail.receipts.map((receipt) => (
                      <article key={receipt.id}>
                        <strong>{formatDateTime(receipt.receivedAt)}</strong>
                        <span>Mã nhập kho: {receipt.inventoryMovementId.slice(0, 8)}</span>
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
