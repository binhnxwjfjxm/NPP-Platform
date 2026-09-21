'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import localStyles from './attendance.module.css';
import { ATTENDANCE_QR_SIZE, createAttendanceQrMatrix } from '../../../lib/attendance-qr';
import type {
  AttendancePoint,
  AttendancePointManagement,
  AttendanceQrToken,
  AttendanceRecordResult,
  AttendanceToday,
} from '../../../lib/workforce-types';

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
type Attempt = { payload: string; key: string } | null;
type BarcodeResult = { rawValue: string };
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<BarcodeResult[]> };
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

const STATUS_LABEL: Record<AttendanceToday['status'], string> = {
  NOT_STARTED: 'Chưa vào làm',
  WORKING: 'Đang làm việc',
  OUTSIDE: 'Đang ra ngoài',
  COMPLETE: 'Đã hoàn tất',
};

type ExitReason = '' | 'END_WORK' | 'WORK_BUSINESS' | 'PERSONAL' | 'BREAK' | 'OTHER';

const EXIT_REASON_LABEL: Record<Exclude<ExitReason, ''>, string> = {
  END_WORK: 'Kết thúc làm việc / Đi về',
  WORK_BUSINESS: 'Ra ngoài làm công việc',
  PERSONAL: 'Ra ngoài việc cá nhân',
  BREAK: 'Nghỉ giữa ca',
  OTHER: 'Lý do khác',
};

function eventLabel(event: AttendanceToday['events'][number]) {
  if (event.event_type === 'CHECK_IN') return 'Vào làm';
  if (event.event_type === 'CHECK_OUT') return 'Kết thúc làm việc';
  if (event.event_type === 'RETURN') return 'Quay lại nơi làm việc';
  return event.movement_reason ? EXIT_REASON_LABEL[event.movement_reason] : 'Ra tạm thời';
}

const ATTENDANCE_METHOD_LABEL: Record<AttendanceToday['policy']['attendanceMethod'], string> = {
  QR: 'Quét mã tại nơi làm việc',
  MANUAL: 'Chấm công trực tiếp',
  BOTH: 'Quét mã hoặc chấm trực tiếp',
  NONE: 'Không yêu cầu chấm công',
};

function stableKey(ref: React.MutableRefObject<Attempt>, operation: string, payload: unknown) {
  const serialized = JSON.stringify(payload);
  if (ref.current?.payload === serialized) return ref.current.key;
  const key = createIdempotencyKey(operation);
  ref.current = { payload: serialized, key };
  return key;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu');
  }
  return payload.data;
}

function formatDateTime(value: string | null | undefined, timeZone = 'Asia/Ho_Chi_Minh') {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function QrCode({ payload }: { payload: string }) {
  const matrix = useMemo(() => createAttendanceQrMatrix(payload), [payload]);
  const quiet = 4;
  const size = ATTENDANCE_QR_SIZE + quiet * 2;
  return (
    <svg
      className={localStyles.qrSvg}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Mã QR chấm công"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="white" />
      {matrix.flatMap((row, rowIndex) => row.map((value, columnIndex) => value ? (
        <rect
          key={`${rowIndex}-${columnIndex}`}
          x={columnIndex + quiet}
          y={rowIndex + quiet}
          width="1"
          height="1"
          fill="currentColor"
        />
      ) : null))}
    </svg>
  );
}

export default function AttendanceWorkspace({
  initialToday,
  initialManagement,
  initialError,
}: {
  initialToday: AttendanceToday | null;
  initialManagement: AttendancePointManagement | null;
  initialError: string | null;
}) {
  const [today, setToday] = useState(initialToday);
  const [management, setManagement] = useState(initialManagement);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState(initialManagement?.branches[0]?.id ?? '');
  const [qrToken, setQrToken] = useState<AttendanceQrToken | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [exitReason, setExitReason] = useState<ExitReason>('');
  const [exitNote, setExitNote] = useState('');

  const recordAttempt = useRef<Attempt>(null);
  const manualRecordAttempt = useRef<Attempt>(null);
  const pointAttempt = useRef<Attempt>(null);
  const tokenAttempt = useRef<Attempt>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const detectionBusyRef = useRef(false);

  const timeZone = today?.policy.timezone || 'Asia/Ho_Chi_Minh';
  const nextActionLabel = today?.nextAction === 'CHECK_IN'
    ? 'Ghi nhận vào làm'
    : today?.nextAction === 'EXIT'
      ? 'Chọn lý do rời nơi làm việc'
      : today?.nextAction === 'RETURN'
        ? 'Ghi nhận quay lại'
        : 'Đã hoàn tất chấm công';
  const exitSelectionReady = today?.nextAction !== 'EXIT'
    || (Boolean(exitReason) && (exitReason !== 'OTHER' || Boolean(exitNote.trim())));
  const qrAllowed = today?.policy.attendanceMethod === 'QR' || today?.policy.attendanceMethod === 'BOTH';
  const manualAllowed = today?.policy.attendanceMethod === 'MANUAL' || today?.policy.attendanceMethod === 'BOTH';
  const remainingSeconds = qrToken
    ? Math.max(0, Math.ceil((new Date(qrToken.expiresAt).getTime() - clock) / 1000))
    : 0;

  function stopScanner() {
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
    detectionBusyRef.current = false;
  }

  useEffect(() => () => stopScanner(), []);

  useEffect(() => {
    if (!qrToken) return undefined;
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [qrToken?.id]);

  useEffect(() => {
    if (!qrToken) return undefined;
    const delay = Math.max(5_000, new Date(qrToken.expiresAt).getTime() - Date.now() - 15_000);
    const timer = window.setTimeout(() => {
      void issueQrToken(qrToken.attendancePointId);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [qrToken?.id]);

  function attendancePayload(method: 'QR' | 'MANUAL', qrPayload?: string) {
    const payload: Record<string, string> = { method };
    if (qrPayload) payload.qrPayload = qrPayload;
    if (today?.nextAction === 'EXIT') {
      if (!exitReason) throw new Error('Vui lòng chọn lý do rời nơi làm việc');
      payload.exitReason = exitReason;
      if (exitNote.trim()) payload.note = exitNote.trim();
    }
    return payload;
  }

  async function reloadToday() {
    try {
      const value = await requestJson<AttendanceToday>('/api/workforce/attendance/today');
      setToday(value);
      return value;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được trạng thái chấm công');
      return null;
    }
  }

  async function submitQr(qrPayload: string) {
    const normalized = qrPayload.trim();
    if (!normalized) return;
    let payload: Record<string, string>;
    try {
      payload = attendancePayload('QR', normalized);
    } catch (payloadError) {
      setError(payloadError instanceof Error ? payloadError.message : 'Vui lòng chọn lý do rời nơi làm việc');
      return;
    }
    const key = stableKey(recordAttempt, 'web-attendance-record', payload);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<AttendanceRecordResult>('/api/workforce/attendance/record', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      recordAttempt.current = null;
      setNotice(`Đã ghi nhận ${eventLabel(result.event).toLowerCase()} lúc ${formatDateTime(result.event.occurred_at, timeZone)} tại ${result.point?.branchName || result.point?.name || 'nơi làm việc'}.`);
      setExitReason('');
      setExitNote('');
      await reloadToday();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không ghi nhận được chấm công');
    } finally {
      setBusy(false);
    }
  }


  async function submitManualAttendance() {
    if (!today?.nextAction || !manualAllowed) return;
    let payload: Record<string, string>;
    try {
      payload = attendancePayload('MANUAL');
    } catch (payloadError) {
      setError(payloadError instanceof Error ? payloadError.message : 'Vui lòng chọn lý do rời nơi làm việc');
      return;
    }
    const key = stableKey(manualRecordAttempt, 'web-attendance-manual-record', payload);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<AttendanceRecordResult>('/api/workforce/attendance/record', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      manualRecordAttempt.current = null;
      setNotice(`Đã ghi nhận ${eventLabel(result.event).toLowerCase()} lúc ${formatDateTime(result.event.occurred_at, timeZone)} bằng chấm công trực tiếp.`);
      setExitReason('');
      setExitNote('');
      await reloadToday();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không ghi nhận được chấm công trực tiếp');
    } finally {
      setBusy(false);
    }
  }

  async function startScanner() {
    setError(null);
    setNotice(null);
    setCameraMessage(null);
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector) {
      setCameraMessage(manualAllowed ? 'Thiết bị này chưa hỗ trợ quét QR bằng camera. Anh/chị có thể dùng Chấm công trực tiếp bên dưới.' : 'Thiết bị này chưa hỗ trợ quét QR bằng camera. Vui lòng dùng thiết bị có camera hỗ trợ quét QR.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage('Thiết bị không cho phép mở camera trong trình duyệt này.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      await video.play();
      setScanning(true);
      const detector = new Detector({ formats: ['qr_code'] });
      scanTimerRef.current = window.setInterval(async () => {
        if (detectionBusyRef.current || !videoRef.current || videoRef.current.readyState < 2) return;
        detectionBusyRef.current = true;
        try {
          const results = await detector.detect(videoRef.current);
          const raw = results.find((item) => item.rawValue.startsWith('NPPATT.'))?.rawValue;
          if (raw) {
            stopScanner();
            await submitQr(raw);
          } else if (results.length) {
            setCameraMessage('Đây không phải mã QR chấm công của Công Ty.');
          }
        } catch {
          setCameraMessage('Camera chưa đọc được mã. Giữ mã QR ngay ngắn trong khung và thử lại.');
        } finally {
          detectionBusyRef.current = false;
        }
      }, 350);
    } catch {
      stopScanner();
      setCameraMessage(manualAllowed ? 'Không mở được camera. Kiểm tra quyền camera hoặc dùng Chấm công trực tiếp bên dưới.' : 'Không mở được camera. Vui lòng kiểm tra quyền camera trên thiết bị.');
    }
  }

  async function reloadPointManagement() {
    if (!management) return null;
    try {
      const value = await requestJson<AttendancePointManagement>('/api/workforce/attendance/points');
      setManagement(value);
      if (!value.branches.some((branch) => branch.id === selectedWorkplaceId)) {
        setSelectedWorkplaceId(value.branches[0]?.id ?? '');
      }
      return value;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được danh sách nơi làm việc');
      return null;
    }
  }

  async function showWorkplaceQr(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!management || !selectedWorkplaceId) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let point = management.points.find((item) => item.is_active && item.branch_id === selectedWorkplaceId) ?? null;
      if (!point) {
        const payload = { branchId: selectedWorkplaceId };
        const key = stableKey(pointAttempt, 'web-attendance-point-create', payload);
        point = await requestJson<AttendancePoint>('/api/workforce/attendance/points', {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
          body: JSON.stringify(payload),
        });
        pointAttempt.current = null;
        await reloadPointManagement();
      }
      await issueQrToken(point.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không hiển thị được mã QR chấm công');
    } finally {
      setBusy(false);
    }
  }

  async function issueQrToken(attendancePointId: string) {
    if (!attendancePointId) return;
    const payload = { attendancePointId };
    const key = stableKey(tokenAttempt, 'web-attendance-qr-token', payload);
    setBusy(true);
    setError(null);
    try {
      const token = await requestJson<AttendanceQrToken>('/api/workforce/attendance/qr-token', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      tokenAttempt.current = null;
      setQrToken(token);
      setClock(Date.now());
    } catch (tokenError) {
      setError(tokenError instanceof Error ? tokenError.message : 'Không phát được mã QR chấm công');
    } finally {
      setBusy(false);
    }
  }

  const actions = (
    <button
      type="button"
      className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`}
      onClick={() => void reloadToday()}
      disabled={busy}
    >
      Cập nhật trạng thái
    </button>
  );

  return (
    <AppShell
      title="Chấm công"
      subtitle="Nhân viên chấm công theo nơi làm việc đã gắn trong hồ sơ. Không cần chọn lại nơi làm việc mỗi ngày."
      kicker="Nhân sự"
      actions={actions}
    >
      <section className={styles.page} data-testid="attendance-page">
        {(error || notice) ? (
          <div className={`${styles.banner} ${error ? styles.bannerError : styles.bannerSuccess}`} role="status">
            {error ?? notice}
          </div>
        ) : null}

        <section className={styles.summaryGrid}>
          <article className={styles.summaryCard}>
            <span>Ngày làm việc</span>
            <strong>{today?.workDate || '—'}</strong>
            <small>{today?.employee ? `${today.employee.full_name} · Nơi làm việc: ${today.employee.branch_name || 'Chưa gắn'}` : 'Chưa xác định hồ sơ nhân sự'}</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Trạng thái hôm nay</span>
            <strong>{today ? STATUS_LABEL[today.status] : 'Chưa sẵn sàng'}</strong>
            <small>{nextActionLabel}</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Chính sách làm việc</span>
            <strong>{today?.policy.name || '—'}</strong>
            <small>{today ? ATTENDANCE_METHOD_LABEL[today.policy.attendanceMethod] : 'Chưa có chính sách phù hợp'}</small>
          </article>
        </section>

        <div className={localStyles.attendanceGrid}>
          <section className={localStyles.scanPanel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.panelKicker}>Hôm nay</p>
                <h2>Chấm công hôm nay</h2>
              </div>
              {today ? <span className={localStyles.statusPill}>{STATUS_LABEL[today.status]}</span> : null}
            </div>

            <div className={localStyles.statusRow}>
              <span className={localStyles.statusPill}>Dự kiến vào: {formatDateTime(today?.expectedStartAt, timeZone)}</span>
              <span className={localStyles.statusPill}>Dự kiến ra: {formatDateTime(today?.expectedEndAt, timeZone)}</span>
            </div>

            {qrAllowed ? (
              <>
                <div className={localStyles.cameraBox}>
                  <video
                    ref={videoRef}
                    className={localStyles.video}
                    muted
                    playsInline
                    hidden={!scanning}
                    aria-label="Camera quét mã QR chấm công"
                  />
                  {!scanning ? (
                    <div className={styles.emptyState}>
                      {today?.nextAction
                        ? `Sẵn sàng: ${nextActionLabel.toLowerCase()} bằng mã QR tại nơi làm việc.`
                        : 'Ngày làm việc này đã có đủ giờ vào và giờ ra.'}
                    </div>
                  ) : null}
                </div>
                {cameraMessage ? <p role="status">{cameraMessage}</p> : null}

                <div className={localStyles.scanActions}>
                  {!scanning ? (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void startScanner()}
                      disabled={busy || !today?.nextAction || !exitSelectionReady}
                      data-testid="attendance-start-camera"
                    >
                      Mở camera quét QR
                    </button>
                  ) : (
                    <button type="button" className={styles.secondaryButton} onClick={stopScanner}>
                      Dừng camera
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className={localStyles.methodNotice}>
                Chính sách hiện tại không yêu cầu quét mã. Dùng cách chấm công được hiển thị bên dưới.
              </div>
            )}

            {today?.nextAction === 'EXIT' ? (
              <div className={localStyles.exitPanel} data-testid="attendance-exit-reason">
                <strong>Lý do rời nơi làm việc</strong>
                <span>Chọn đúng mục để Bảng công phân biệt kết thúc ngày với ra tạm thời.</span>
                <div className={localStyles.exitReasonGrid}>
                  {(Object.keys(EXIT_REASON_LABEL) as Array<Exclude<ExitReason, ''>>).map((reason) => (
                    <label key={reason} className={localStyles.exitReasonOption}>
                      <input
                        type="radio"
                        name="exit-reason"
                        value={reason}
                        checked={exitReason === reason}
                        onChange={() => setExitReason(reason)}
                      />
                      <span>{EXIT_REASON_LABEL[reason]}</span>
                    </label>
                  ))}
                </div>
                {exitReason === 'OTHER' ? (
                  <label className={localStyles.exitNoteField}>
                    Ghi rõ lý do
                    <input
                      value={exitNote}
                      onChange={(event) => setExitNote(event.target.value)}
                      maxLength={1024}
                      placeholder="Nhập lý do"
                      required
                    />
                  </label>
                ) : null}
              </div>
            ) : null}

            {today?.policy.attendanceBasis === 'PRESENCE' ? (
              <div className={localStyles.methodNotice}>Chính sách này chỉ xác nhận có mặt. Sau khi ghi nhận vào làm, Bảng công không dùng số phút làm việc để tính công và không yêu cầu ghi nhận giờ ra.</div>
            ) : null}

            {manualAllowed ? (
              <div className={localStyles.manualAttendanceCard} data-testid="attendance-manual-record">
                <div>
                  <strong>Chấm công trực tiếp</strong>
                  <span>Hệ thống tự ghi giờ hiện tại. Anh/chị không cần nhập thời gian hoặc chọn nơi làm việc.</span>
                </div>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void submitManualAttendance()}
                  disabled={busy || !today?.nextAction || !exitSelectionReady}
                >
                  {today?.nextAction === 'EXIT' ? 'Ghi nhận rời nơi làm việc' : nextActionLabel}
                </button>
              </div>
            ) : null}

            <div className={localStyles.eventList} data-testid="attendance-today-events">
              {(today?.events ?? []).map((event) => (
                <div className={localStyles.eventItem} key={event.id}>
                  <span><strong>{eventLabel(event)}</strong><br /><small>{event.note || event.point_name || (event.source === 'MANUAL' ? 'Chấm công trực tiếp' : 'Nơi làm việc')}</small></span>
                  <span>{formatDateTime(event.occurred_at, timeZone)}</span>
                </div>
              ))}
              {today && !today.events.length ? <div className={styles.emptyState}>Chưa có lần chấm công nào trong ngày làm việc này.</div> : null}
            </div>
          </section>

          {management ? (
            <section className={localStyles.qrPanel} data-testid="attendance-point-management">
              <div className={styles.sectionHeader}>
                <div><p className={styles.panelKicker}>Dành cho quản lý</p><h2>Mã QR theo nơi làm việc</h2></div>
                <span className={styles.panelChip}>{management.branches.length} nơi làm việc</span>
              </div>

              <form className={localStyles.pointForm} onSubmit={(event) => void showWorkplaceQr(event)}>
                <label>
                  Nơi làm việc
                  <select
                    value={selectedWorkplaceId}
                    onChange={(event) => {
                      setSelectedWorkplaceId(event.target.value);
                      setQrToken(null);
                    }}
                    required
                  >
                    <option value="">Chọn nơi làm việc</option>
                    {management.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                </label>
                <small className={localStyles.pointHelp}>Thiết lập theo nơi làm việc có sẵn. Nhân viên không chọn lại nơi làm việc khi chấm công.</small>
                <button type="submit" className={styles.secondaryButton} disabled={busy || !selectedWorkplaceId}>Hiển thị mã QR</button>
              </form>

              {qrToken ? (
                <div className={localStyles.qrWrap}>
                  <QrCode payload={qrToken.qrPayload} />
                  <div className={localStyles.qrMeta}>
                    <strong>{qrToken.branchName || qrToken.pointName}</strong>
                    <div>Dùng mã này để chấm công tại nơi làm việc trên.</div>
                    <div>Còn hiệu lực khoảng {remainingSeconds} giây · mã tự làm mới trước khi hết hạn</div>
                    <button type="button" className={styles.secondaryButton} onClick={() => setQrToken(null)}>Tắt mã QR</button>
                  </div>
                </div>
              ) : (
                <div className={styles.emptyState}>Chọn nơi làm việc rồi bấm “Hiển thị mã QR”.</div>
              )}
            </section>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
