'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from './delivery-attempt-workspace.module.css';

type TripListItem = Readonly<{
  id: string;
  number: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  licensePlate: string | null;
  vehicleCode: string | null;
  driverName: string | null;
  driverCode: string | null;
  dispatchedAt: string | null;
  status: 'draft' | 'planned' | 'locked' | 'dispatched';
  stopCount?: number;
  assignmentCount?: number;
}>;

type Attempt = Readonly<{
  id: string;
  stopSequence: number;
  assignmentId: string;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  customerCode: string | null;
  customerName: string | null;
  result: 'delivered_full' | 'delivered_partial' | 'failed' | 'rescheduled';
  attemptedAt: string;
  reasonCode: string | null;
  note: string | null;
  rescheduledFor: string | null;
}>;

type Proof = Readonly<{
  id: string;
  podType: 'photo' | 'signature' | 'otp' | 'manual_confirm';
  receiverName: string | null;
  confirmationReference: string | null;
  note: string | null;
  capturedAt: string;
  file: Readonly<{
    fileName: string;
    downloadUrl: string | null;
  }> | null;
}>;

type AttemptSummary = Readonly<{
  trip: Readonly<{
    id: string;
    number: string;
    status: string;
    warehouseId: string;
  }>;
  attempts: readonly Attempt[];
}>;

type ApiEnvelope<T> = Readonly<{
  data?: T;
  error?: { message?: string };
}>;

const RESULT_LABELS: Record<Attempt['result'], string> = {
  delivered_full: 'Giao đủ',
  delivered_partial: 'Giao một phần',
  failed: 'Không giao được',
  rescheduled: 'Hẹn giao lại',
};

const POD_LABELS: Record<Proof['podType'], string> = {
  photo: 'Ảnh giao hàng',
  signature: 'Tham chiếu chữ ký',
  otp: 'Tham chiếu OTP',
  manual_confirm: 'Xác nhận thủ công',
};

function formatDateTime(value: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('vi-VN');
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new Error(envelope.error?.message || 'Không tải được kết quả giao.');
  }
  return envelope.data;
}

export default function DeliveryAttemptWorkspace() {
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<TripListItem | null>(null);
  const [summary, setSummary] = useState<AttemptSummary | null>(null);
  const [proofsByAttempt, setProofsByAttempt] = useState<Record<string, readonly Proof[]>>({});
  const [loadingProofId, setLoadingProofId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedTripIdRef = useRef('');
  const tripRequestRef = useRef(0);
  const proofRequestRef = useRef(new Map<string, number>());

  const dispatchedTrips = useMemo(
    () => trips.filter((trip) => trip.status === 'dispatched'),
    [trips],
  );

  const loadTrips = useCallback(async () => {
    const next = await requestJson<TripListItem[]>('/api/logistics/trips?status=all');
    setTrips(next);
  }, []);

  useEffect(() => {
    setBusy(true);
    loadTrips()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Không tải được chuyến.'))
      .finally(() => setBusy(false));
  }, [loadTrips]);

  async function selectTrip(trip: TripListItem) {
    const requestVersion = ++tripRequestRef.current;
    selectedTripIdRef.current = trip.id;
    proofRequestRef.current.clear();
    setSelectedTrip(trip);
    setSummary(null);
    setProofsByAttempt({});
    setError('');
    setBusy(true);
    try {
      const nextSummary = await requestJson<AttemptSummary>(`/api/logistics/trips/${trip.id}/attempts`);
      if (tripRequestRef.current === requestVersion && selectedTripIdRef.current === trip.id) {
        setSummary(nextSummary);
      }
    } catch (loadError) {
      if (tripRequestRef.current === requestVersion && selectedTripIdRef.current === trip.id) {
        setError(loadError instanceof Error ? loadError.message : 'Không tải được kết quả giao.');
      }
    } finally {
      if (tripRequestRef.current === requestVersion && selectedTripIdRef.current === trip.id) {
        setBusy(false);
      }
    }
  }

  async function toggleProofs(attemptId: string) {
    if (!selectedTrip) return;
    if (Object.prototype.hasOwnProperty.call(proofsByAttempt, attemptId)) {
      proofRequestRef.current.delete(attemptId);
      setProofsByAttempt((current) => {
        const next = { ...current };
        delete next[attemptId];
        return next;
      });
      return;
    }
    const tripId = selectedTrip.id;
    const requestVersion = (proofRequestRef.current.get(attemptId) ?? 0) + 1;
    proofRequestRef.current.set(attemptId, requestVersion);
    setError('');
    setLoadingProofId(attemptId);
    try {
      const data = await requestJson<{ proofs: readonly Proof[] }>(
        `/api/logistics/trips/${tripId}/attempts/${attemptId}/pod`,
      );
      if (selectedTripIdRef.current === tripId
          && proofRequestRef.current.get(attemptId) === requestVersion) {
        setProofsByAttempt((current) => ({ ...current, [attemptId]: data.proofs }));
      }
    } catch (loadError) {
      if (selectedTripIdRef.current === tripId
          && proofRequestRef.current.get(attemptId) === requestVersion) {
        setError(loadError instanceof Error ? loadError.message : 'Không tải được bằng chứng giao hàng.');
      }
    } finally {
      if (selectedTripIdRef.current === tripId
          && proofRequestRef.current.get(attemptId) === requestVersion) {
        setLoadingProofId('');
      }
    }
  }

  const completed = summary?.attempts.length ?? 0;
  const total = selectedTrip?.assignmentCount ?? 0;

  return (
    <AppShell
      kicker="Điều phối giao hàng"
      title="Theo dõi kết quả lần giao"
      subtitle="Đọc kết quả và bằng chứng tùy chọn tài xế đã ghi; không ghi thay tài xế và không tự nhập hàng về kho."
      actions={<Link className={styles.linkButton} href="/logistics/dispatch">Bàn giao chuyến</Link>}
    >
      <div className={styles.workspace} data-testid="delivery-attempt-workspace">
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.columns}>
          <section className={styles.panel}>
            <div className={styles.heading}>
              <div>
                <p>Chuyến đã xuất phát</p>
                <h2>Chọn chuyến cần theo dõi</h2>
              </div>
              <button type="button" onClick={() => loadTrips().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Không tải được chuyến.'))} disabled={busy}>Tải lại</button>
            </div>
            <div className={styles.tripList}>
              {dispatchedTrips.map((trip) => (
                <button
                  type="button"
                  key={trip.id}
                  className={selectedTrip?.id === trip.id ? styles.selected : ''}
                  onClick={() => selectTrip(trip)}
                  disabled={busy}
                  data-testid={`attempt-trip-${trip.id}`}
                >
                  <strong>{trip.number}</strong>
                  <span>{trip.warehouseCode || trip.warehouseName || 'Kho'} · {trip.driverName || trip.driverCode || 'Tài xế'}</span>
                  <small>{trip.licensePlate || trip.vehicleCode || 'Chưa rõ xe'} · {trip.assignmentCount || 0} phiếu</small>
                </button>
              ))}
              {!dispatchedTrips.length && !busy ? <p className={styles.empty}>Chưa có chuyến đã xuất phát.</p> : null}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.heading}>
              <div>
                <p>Kết quả read-only</p>
                <h2>{selectedTrip?.number || 'Chưa chọn chuyến'}</h2>
              </div>
              {selectedTrip ? <span className={styles.progress}>{completed}/{total} phiếu</span> : null}
            </div>

            {!selectedTrip ? (
              <p className={styles.empty}>Chọn chuyến bên trái để xem lần giao đã ghi.</p>
            ) : busy && !summary ? (
              <p className={styles.empty}>Đang tải kết quả…</p>
            ) : (
              <div className={styles.attemptList} data-testid="attempt-summary-list">
                {summary?.attempts.map((attempt) => {
                  const proofs = proofsByAttempt[attempt.id];
                  return (
                    <article key={attempt.id} data-result={attempt.result}>
                      <header>
                        <div>
                          <small>Điểm {attempt.stopSequence}</small>
                          <strong>{attempt.deliveryOrderNumber || attempt.deliveryOrderId.slice(0, 8)}</strong>
                          <span>{attempt.customerName || attempt.customerCode || 'Khách hàng'}</span>
                        </div>
                        <span className={styles.result}>{RESULT_LABELS[attempt.result]}</span>
                      </header>
                      <dl>
                        <div><dt>Thời điểm</dt><dd>{formatDateTime(attempt.attemptedAt)}</dd></div>
                        {attempt.reasonCode ? <div><dt>Lý do</dt><dd>{attempt.reasonCode}</dd></div> : null}
                        {attempt.rescheduledFor ? <div><dt>Giao lại</dt><dd>{formatDateTime(attempt.rescheduledFor)}</dd></div> : null}
                        {attempt.note ? <div><dt>Ghi chú</dt><dd>{attempt.note}</dd></div> : null}
                      </dl>
                      <button
                        type="button"
                        className={styles.proofButton}
                        onClick={() => toggleProofs(attempt.id)}
                        disabled={loadingProofId === attempt.id}
                      >
                        {loadingProofId === attempt.id
                          ? 'Đang tải…'
                          : proofs === undefined
                            ? 'Xem bằng chứng tùy chọn'
                            : 'Ẩn bằng chứng'}
                      </button>
                      {proofs !== undefined ? (
                        proofs.length ? (
                          <ul className={styles.proofList} data-testid={`pod-list-${attempt.id}`}>
                            {proofs.map((proof) => (
                              <li key={proof.id}>
                                <strong>{POD_LABELS[proof.podType]}</strong>
                                <span>{formatDateTime(proof.capturedAt)}</span>
                                {proof.receiverName ? <span>Người nhận: {proof.receiverName}</span> : null}
                                {proof.confirmationReference ? <span>Tham chiếu: {proof.confirmationReference}</span> : null}
                                {proof.note ? <span>Ghi chú: {proof.note}</span> : null}
                                {proof.file?.downloadUrl ? (
                                  <a href={proof.file.downloadUrl} target="_blank" rel="noreferrer">Xem ảnh</a>
                                ) : proof.file ? <span>Ảnh đã lưu; liên kết tạm thời chưa khả dụng.</span> : null}
                              </li>
                            ))}
                          </ul>
                        ) : <p className={styles.noProof}>Không có bằng chứng đính kèm; kết quả giao vẫn hợp lệ.</p>
                      ) : null}
                    </article>
                  );
                })}
                {!summary?.attempts.length ? (
                  <p className={styles.empty}>Tài xế chưa ghi kết quả cho phiếu nào trong chuyến này.</p>
                ) : null}
              </div>
            )}

            {selectedTrip ? (
              <p className={styles.custodyNotice}>
                Phiếu chưa giao đủ vẫn là hàng trên xe theo dispatch lineage; màn này không tạo Inventory IN.
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
