'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from './trip-dispatch-workspace.module.css';

type TripStatus = 'draft' | 'planned' | 'locked' | 'dispatched';

type TripListItem = {
  id: string;
  number: string;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  vehicleCode: string | null;
  licensePlate: string | null;
  driverCode: string | null;
  driverName: string | null;
  plannedStartAt: string | null;
  status: TripStatus;
  stopCount?: number;
  assignmentCount?: number;
};

type DispatchAssignment = {
  assignmentId: string;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  customerCode: string | null;
  customerName: string | null;
};

type DispatchStop = {
  id: string;
  sequence: number;
  assignments: DispatchAssignment[];
};

type DispatchItem = {
  id: string;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  customerCode: string | null;
  customerName: string | null;
  inventoryIssueId: string;
  inventoryMovementId: string;
  movementType: string | null;
  postedAt: string;
};

type DispatchTrip = TripListItem & {
  dispatchId: string | null;
  handoverReceiverName: string | null;
  handoverNote: string | null;
  dispatchedAt: string | null;
  dispatchedBy: string | null;
  stops: DispatchStop[];
  dispatchItems: DispatchItem[];
};

type DispatchResult = {
  ok: true;
  trip: DispatchTrip;
  replayed: boolean;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string };
};

function localDateTimeValue(date = new Date()): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function statusLabel(status: TripStatus): string {
  return {
    draft: 'Nháp',
    planned: 'Đã lập kế hoạch',
    locked: 'Chờ bàn giao',
    dispatched: 'Đã xuất phát',
  }[status];
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
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
    throw new Error(envelope.error?.message || 'Không thực hiện được thao tác bàn giao chuyến.');
  }
  return envelope.data;
}

export default function TripDispatchWorkspace() {
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<DispatchTrip | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const [dispatchedAt, setDispatchedAt] = useState(localDateTimeValue());
  const [handoverNote, setHandoverNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const operationKeys = useRef(new Map<string, string>());

  const visibleTrips = useMemo(
    () => trips.filter((trip) => trip.status === 'locked' || trip.status === 'dispatched'),
    [trips],
  );

  const assignmentCount = useMemo(
    () => selectedTrip?.stops.reduce((total, stop) => total + stop.assignments.length, 0) ?? 0,
    [selectedTrip],
  );

  const loadTrips = useCallback(async () => {
    const nextTrips = await requestJson<TripListItem[]>('/api/logistics/trips?status=all');
    setTrips(nextTrips);
  }, []);

  const loadTrip = useCallback(async (tripId: string) => {
    const trip = await requestJson<DispatchTrip>(`/api/logistics/trips/${tripId}/dispatch`);
    setSelectedTrip(trip);
    setReceiverName(trip.handoverReceiverName || trip.driverName || '');
    setDispatchedAt(trip.dispatchedAt ? localDateTimeValue(new Date(trip.dispatchedAt)) : localDateTimeValue());
    setHandoverNote(trip.handoverNote || '');
  }, []);

  useEffect(() => {
    setBusy('load');
    loadTrips()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Không tải được chuyến giao.'))
      .finally(() => setBusy(null));
  }, [loadTrips]);

  function operationKey(scope: string): string {
    const existing = operationKeys.current.get(scope);
    if (existing) return existing;
    const next = `web-trip-dispatch-${scope}-${crypto.randomUUID()}`
      .replace(/[^A-Za-z0-9._:-]/g, '_')
      .slice(0, 128);
    operationKeys.current.set(scope, next);
    return next;
  }

  async function selectTrip(tripId: string) {
    setBusy(`load-${tripId}`);
    setError('');
    setMessage('');
    try {
      await loadTrip(tripId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được chi tiết chuyến.');
    } finally {
      setBusy(null);
    }
  }

  async function dispatchTrip() {
    if (!selectedTrip || selectedTrip.status !== 'locked') return;
    const normalizedReceiver = receiverName.trim();
    if (!normalizedReceiver || !dispatchedAt) {
      setError('Cần nhập người nhận bàn giao và thời điểm xe xuất phát.');
      return;
    }
    const scope = `${selectedTrip.id}:${dispatchedAt}:${normalizedReceiver}:${handoverNote.trim()}`;
    setBusy('dispatch');
    setError('');
    setMessage('');
    try {
      const result = await requestJson<DispatchResult>(
        `/api/logistics/trips/${selectedTrip.id}/dispatch`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': operationKey(scope) },
          body: JSON.stringify({
            dispatchedAt: new Date(dispatchedAt).toISOString(),
            handoverReceiverName: normalizedReceiver,
            handoverNote: handoverNote.trim() || null,
          }),
        },
      );
      operationKeys.current.delete(scope);
      setSelectedTrip(result.trip);
      setMessage(result.replayed
        ? 'Yêu cầu đã được xử lý trước đó; dữ liệu chuyến được tải lại.'
        : `Đã bàn giao ${result.trip.dispatchItems.length} phiếu và cho chuyến xuất phát.`);
      await loadTrips();
    } catch (dispatchError) {
      setError(dispatchError instanceof Error ? dispatchError.message : 'Không dispatch được chuyến.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell
      kicker="Giao nhận"
      title="Bàn giao và cho xe xuất phát"
      subtitle="Xác nhận hàng rời kho và ghi Inventory OUT toàn chuyến; chưa ghi kết quả giao hay POD."
      actions={<Link className={styles.linkButton} href="/logistics/trips">Quay lại lập kế hoạch</Link>}
    >
      <div className={styles.workspace} data-testid="trip-dispatch-workspace">
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.message} role="status">{message}</p> : null}

        <div className={styles.columns}>
          <section className={styles.panel} aria-labelledby="dispatch-queue-heading">
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Hàng đợi bàn giao</p>
                <h2 id="dispatch-queue-heading">Chuyến đã khóa và đã xuất phát</h2>
              </div>
              <button type="button" className={styles.secondaryButton} onClick={() => loadTrips()} disabled={busy !== null}>
                Tải lại
              </button>
            </div>
            <div className={styles.tripList} data-testid="dispatch-trip-list">
              {visibleTrips.map((trip) => (
                <button
                  type="button"
                  key={trip.id}
                  className={`${styles.tripCard} ${selectedTrip?.id === trip.id ? styles.selected : ''}`}
                  onClick={() => selectTrip(trip.id)}
                  disabled={busy !== null}
                  data-testid={`dispatch-trip-${trip.id}`}
                >
                  <strong>{trip.number}</strong>
                  <span>{trip.warehouseCode || 'Kho'} · {statusLabel(trip.status)}</span>
                  <small>{trip.stopCount || 0} điểm · {trip.assignmentCount || 0} phiếu</small>
                  <small>{trip.licensePlate || trip.vehicleCode || 'Chưa rõ xe'} · {trip.driverName || 'Chưa rõ tài xế'}</small>
                </button>
              ))}
              {!visibleTrips.length && busy !== 'load' ? (
                <p className={styles.empty}>Chưa có chuyến chờ bàn giao hoặc đã xuất phát.</p>
              ) : null}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="dispatch-detail-heading">
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Chi tiết bàn giao</p>
                <h2 id="dispatch-detail-heading">{selectedTrip?.number || 'Chọn một chuyến'}</h2>
              </div>
              {selectedTrip ? (
                <span className={styles.status} data-status={selectedTrip.status}>{statusLabel(selectedTrip.status)}</span>
              ) : null}
            </div>

            {selectedTrip ? (
              <>
                <div className={styles.summaryGrid}>
                  <div><span>Kho</span><strong>{selectedTrip.warehouseCode || selectedTrip.warehouseName || 'Kho được cấp quyền'}</strong></div>
                  <div><span>Xe</span><strong>{selectedTrip.licensePlate || selectedTrip.vehicleCode || '—'}</strong></div>
                  <div><span>Tài xế</span><strong>{selectedTrip.driverName || selectedTrip.driverCode || '—'}</strong></div>
                  <div><span>Khối lượng việc</span><strong>{selectedTrip.stops.length} điểm · {assignmentCount} phiếu</strong></div>
                </div>

                {selectedTrip.status === 'locked' ? (
                  <div className={styles.dispatchForm} data-testid="dispatch-form">
                    <label>
                      Người nhận bàn giao
                      <input
                        value={receiverName}
                        onChange={(event) => setReceiverName(event.target.value)}
                        disabled={busy !== null}
                        maxLength={256}
                        data-testid="handover-receiver"
                      />
                    </label>
                    <label>
                      Thời điểm xe xuất phát
                      <input
                        type="datetime-local"
                        value={dispatchedAt}
                        onChange={(event) => setDispatchedAt(event.target.value)}
                        disabled={busy !== null}
                        data-testid="dispatch-time"
                      />
                    </label>
                    <label className={styles.noteField}>
                      Ghi chú bàn giao
                      <textarea
                        value={handoverNote}
                        onChange={(event) => setHandoverNote(event.target.value)}
                        disabled={busy !== null}
                        maxLength={2000}
                        rows={3}
                      />
                    </label>
                    <div className={styles.checklist}>
                      <strong>Trước khi xác nhận</strong>
                      <span>✓ Chuyến đã khóa, không còn sửa xe/tài xế/điểm giao</span>
                      <span>✓ Toàn bộ phiếu sẽ xuất kho trong một giao dịch</span>
                      <span>✓ Có lỗi ở một phiếu thì toàn chuyến không thay đổi</span>
                    </div>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={dispatchTrip}
                      disabled={busy !== null || !receiverName.trim() || !dispatchedAt}
                      data-testid="dispatch-trip-button"
                    >
                      {busy === 'dispatch' ? 'Đang bàn giao…' : 'Bàn giao và cho xe xuất phát'}
                    </button>
                  </div>
                ) : (
                  <div className={styles.dispatchedSummary} data-testid="dispatched-read-only">
                    <p><span>Xuất phát</span><strong>{formatDateTime(selectedTrip.dispatchedAt)}</strong></p>
                    <p><span>Người nhận</span><strong>{selectedTrip.handoverReceiverName || '—'}</strong></p>
                    <p><span>Mã dispatch</span><strong>{selectedTrip.dispatchId || '—'}</strong></p>
                    <p className={styles.notice}>Chuyến đã xuất phát. Kế hoạch và assignment chỉ đọc; kết quả giao và POD thuộc phần tiếp theo.</p>
                  </div>
                )}

                <div className={styles.stopList}>
                  {selectedTrip.stops.map((stop) => (
                    <article className={styles.stopCard} key={stop.id}>
                      <strong>Điểm {stop.sequence}</strong>
                      {stop.assignments.map((assignment) => (
                        <span key={assignment.assignmentId}>
                          {assignment.deliveryOrderNumber || assignment.deliveryOrderId.slice(0, 8)} · {assignment.customerCode || 'Khách'} · {assignment.customerName || ''}
                        </span>
                      ))}
                    </article>
                  ))}
                </div>

                {selectedTrip.status === 'dispatched' ? (
                  <div className={styles.movementList} data-testid="dispatch-movement-list">
                    <h3>Inventory OUT đã ghi</h3>
                    {selectedTrip.dispatchItems.map((item) => (
                      <article key={item.id}>
                        <span>
                          <strong>{item.deliveryOrderNumber || item.deliveryOrderId.slice(0, 8)}</strong>
                          <small>{item.customerCode || 'Khách'} · {item.customerName || ''}</small>
                        </span>
                        <span>
                          <small>Movement</small>
                          <code>{item.inventoryMovementId}</code>
                        </span>
                      </article>
                    ))}
                    {!selectedTrip.dispatchItems.length ? <p className={styles.empty}>Không tìm thấy movement để đối soát.</p> : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className={styles.empty}>Chọn chuyến bên trái để kiểm tra và bàn giao.</p>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
