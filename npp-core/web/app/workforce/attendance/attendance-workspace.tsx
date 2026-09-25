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
type ManagedManualEmployee = {
  id: string;
  code: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
  policyName: string | null;
  hasPolicy: boolean;
};
type ManagedAttendance = {
  workDate: string;
  status: AttendanceToday['status'];
  nextAction: AttendanceToday['nextAction'];
  tooSoon: boolean;
  expectedStartAt: string | null;
  expectedEndAt: string | null;
  policy: {
    id: string;
    name: string;
    attendanceBasis: AttendanceToday['policy']['attendanceBasis'];
    timezone: string;
  } | null;
  events: AttendanceToday['events'];
};
type ManagedSelection = {
  employee: ManagedManualEmployee;
  attendance: ManagedAttendance | null;
  issue: { code: string; message: string } | null;
};
type ManagedManualResponse = {
  employees: ManagedManualEmployee[];
  selected: ManagedSelection | null;
};

const STATUS_LABEL: Record<AttendanceToday['status'], string> = {
  NOT_STARTED: 'Chưa vào làm',
  WORKING: 'Đang làm việc',
  OUTSIDE: 'Đang ra ngoài',
  COMPLETE: 'Đã hoàn tất',
};

type ExitReason = '' | 'END_WORK' | 'WORK_BUSINESS' | 'PERSONAL' | 'BREAK' | 'OTHER';

const EXIT_REASON_LABEL: Record<Exclude<ExitReason, ''>, string> = {
  END_WORK: 'Kết thúc ngày làm việc',
  WORK_BUSINESS: 'Ra ngoài làm việc',
  PERSONAL: 'Ra ngoài vì việc cá nhân',
  BREAK: 'Nghỉ giữa ca',
  OTHER: 'Lý do khác',
};

const ATTENDANCE_METHOD_LABEL: Record<AttendanceToday['policy']['attendanceMethod'], string> = {
  QR: 'Quét mã QR tại nơi làm việc',
  FACE: 'Quét khuôn mặt tại máy chấm công',
  QR_FACE: 'Quét mã QR hoặc quét khuôn mặt',
  FACE_MANUAL: 'Quét khuôn mặt hoặc chấm công trực tiếp',
  ALL: 'Mã QR, quét khuôn mặt hoặc chấm công trực tiếp',
  MANUAL: 'Chấm công trực tiếp',
  BOTH: 'Quét mã QR hoặc chấm công trực tiếp',
  NONE: 'Không yêu cầu chấm công',
};

function eventLabel(event: AttendanceToday['events'][number]) {
  if (event.event_type === 'CHECK_IN') return 'Vào làm';
  if (event.event_type === 'CHECK_OUT') return 'Kết thúc làm việc';
  if (event.event_type === 'RETURN') return 'Quay lại nơi làm việc';
  return event.movement_reason ? EXIT_REASON_LABEL[event.movement_reason] : 'Ra tạm thời';
}

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
  const [managedEmployees, setManagedEmployees] = useState<ManagedManualEmployee[] | null>(null);
  const [managedEmployeeId, setManagedEmployeeId] = useState('');
  const [managedEmployeeQuery, setManagedEmployeeQuery] = useState('');
  const [managedSelected, setManagedSelected] = useState<ManagedSelection | null>(null);
  const [managedLoading, setManagedLoading] = useState(false);
  const [managedExitOpen, setManagedExitOpen] = useState(false);
  const [managedExitReason, setManagedExitReason] = useState<ExitReason>('');
  const [managedExitNote, setManagedExitNote] = useState('');
  const [qrDialogOpen, setQrDialogOpen] = useState(false);

  const recordAttempt = useRef<Attempt>(null);
  const manualRecordAttempt = useRef<Attempt>(null);
  const pointAttempt = useRef<Attempt>(null);
  const tokenAttempt = useRef<Attempt>(null);
  const managedManualAttempt = useRef<Attempt>(null);
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
  const qrAllowed = today?.policy.attendanceMethod === 'QR' || today?.policy.attendanceMethod === 'BOTH' || today?.policy.attendanceMethod === 'QR_FACE' || today?.policy.attendanceMethod === 'ALL';
  const faceAllowed = today?.policy.attendanceMethod === 'FACE' || today?.policy.attendanceMethod === 'QR_FACE' || today?.policy.attendanceMethod === 'FACE_MANUAL' || today?.policy.attendanceMethod === 'ALL';
  const manualAllowed = today?.policy.attendanceMethod === 'MANUAL' || today?.policy.attendanceMethod === 'BOTH' || today?.policy.attendanceMethod === 'FACE_MANUAL' || today?.policy.attendanceMethod === 'ALL';
  const remainingSeconds = qrToken
    ? Math.max(0, Math.ceil((new Date(qrToken.expiresAt).getTime() - clock) / 1000))
    : 0;
  const normalizedEmployeeQuery = managedEmployeeQuery.trim().toLowerCase();
  const filteredManagedEmployees = useMemo(() => {
    if (!managedEmployees) return [];
    if (!normalizedEmployeeQuery) return managedEmployees;
    return managedEmployees.filter((employee) => `${employee.code} ${employee.name} ${employee.branchName ?? ''}`
      .toLowerCase()
      .includes(normalizedEmployeeQuery));
  }, [managedEmployees, normalizedEmployeeQuery]);
  const managedEmployeeOptions = useMemo(() => {
    if (!managedEmployees) return [];
    const selected = managedEmployees.find((employee) => employee.id === managedEmployeeId) ?? null;
    if (!selected || filteredManagedEmployees.some((employee) => employee.id === selected.id)) {
      return filteredManagedEmployees;
    }
    return [selected, ...filteredManagedEmployees];
  }, [managedEmployees, managedEmployeeId, filteredManagedEmployees]);
  const managedAttendance = managedSelected?.attendance ?? null;
  const managedTimeZone = managedAttendance?.policy?.timezone || 'Asia/Ho_Chi_Minh';

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
    void requestJson<ManagedManualResponse>('/api/workforce/attendance/manual')
      .then((value) => {
        setManagedEmployees(value.employees);
        setManagedSelected(null);
      })
      .catch(() => setManagedEmployees(null));
  }, []);

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
      setCameraMessage(manualAllowed ? 'Thiết bị này chưa hỗ trợ quét mã QR bằng camera. Có thể sử dụng chức năng Chấm công trực tiếp bên dưới.' : 'Thiết bị này chưa hỗ trợ quét mã QR bằng camera. Vui lòng sử dụng thiết bị có camera hỗ trợ quét mã QR.');
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

  async function loadManagedEmployee(employeeId: string) {
    if (!employeeId) {
      setManagedSelected(null);
      return null;
    }
    setManagedLoading(true);
    setError(null);
    try {
      const value = await requestJson<ManagedManualResponse>(
        `/api/workforce/attendance/manual?employeeId=${encodeURIComponent(employeeId)}`,
      );
      setManagedEmployees(value.employees);
      setManagedSelected(value.selected);
      return value.selected;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được trạng thái nhân sự');
      return null;
    } finally {
      setManagedLoading(false);
    }
  }

  function selectManagedEmployee(employee: ManagedManualEmployee) {
    setManagedEmployeeId(employee.id);
    setManagedExitOpen(false);
    setManagedExitReason('');
    setManagedExitNote('');
    void loadManagedEmployee(employee.id);
  }

  async function submitManagedManualAttendance(
    action: 'CHECK_IN' | 'CHECK_OUT' | 'TEMP_EXIT' | 'RETURN',
    selectedExitReason?: Exclude<ExitReason, '' | 'END_WORK'>,
    note?: string,
  ) {
    if (!managedEmployeeId) return;
    const payload = {
      employeeId: managedEmployeeId,
      action,
      ...(selectedExitReason ? { exitReason: selectedExitReason } : {}),
      ...(note?.trim() ? { note: note.trim() } : {}),
    };
    const key = stableKey(managedManualAttempt, 'web-attendance-managed-manual', payload);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<AttendanceRecordResult>('/api/workforce/attendance/manual', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      managedManualAttempt.current = null;
      setManagedExitOpen(false);
      setManagedExitReason('');
      setManagedExitNote('');
      setNotice(`${managedSelected?.employee.name || 'Nhân sự'}: ${eventLabel(result.event)} lúc ${formatDateTime(result.event.occurred_at, managedTimeZone)}.`);
      await loadManagedEmployee(managedEmployeeId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không ghi nhận được chấm công tay');
    } finally {
      setBusy(false);
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

  async function refreshAttendanceScreen() {
    setError(null);
    setNotice(null);
    await Promise.all([
      today ? reloadToday() : Promise.resolve(null),
      managedEmployeeId ? loadManagedEmployee(managedEmployeeId) : Promise.resolve(null),
    ]);
  }

  const actions = (
    <div className={localStyles.headerActions}>
      <button
        type="button"
        className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`}
        onClick={() => void refreshAttendanceScreen()}
        disabled={busy || managedLoading}
      >
        Làm mới
      </button>
    </div>
  );

  return (
    <AppShell
      title="Chấm công"
      subtitle="Ghi nhận và theo dõi chấm công theo đúng trạng thái làm việc."
      kicker="Nhân sự"
      actions={actions}
    >
      <section className={`${styles.page} ${localStyles.attendancePage}`} data-testid="attendance-page">
        {(error || notice) ? (
          <div className={`${styles.banner} ${error ? styles.bannerError : styles.bannerSuccess}`} role="status">
            {error ?? notice}
          </div>
        ) : null}

        {managedEmployees ? (
          <section className={localStyles.managerPanel} data-testid="managed-manual-attendance">
            <div className={localStyles.panelHeader}>
              <div>
                <p className={styles.panelKicker}>Dành cho quản lý</p>
                <h2>Chấm công nhân sự</h2>
                <p>Tìm nhân sự theo mã, tên hoặc chi nhánh rồi thao tác theo trạng thái hiện tại.</p>
              </div>

              {management ? (
                <div className={localStyles.qrUtility}>
                  <button
                    type="button"
                    className={localStyles.qrTrigger}
                    onClick={() => {
                      setQrDialogOpen((current) => !current);
                      setQrToken(null);
                    }}
                    disabled={busy}
                    aria-expanded={qrDialogOpen}
                    data-testid="attendance-qr-toggle"
                  >
                    <span>Mã QR chấm công</span>
                    <small>{qrDialogOpen ? 'Ẩn' : 'Mở'}</small>
                  </button>

                  {qrDialogOpen ? (
                    <div className={localStyles.qrPopover} data-testid="attendance-qr-popover">
                      <div className={localStyles.qrPopoverHeader}>
                        <div>
                          <strong>Mã QR chấm công</strong>
                          <span>Chỉ mở khi cần quét.</span>
                        </div>
                        <button
                          type="button"
                          className={localStyles.qrClose}
                          onClick={() => {
                            setQrDialogOpen(false);
                            setQrToken(null);
                          }}
                        >
                          Đóng
                        </button>
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
                        <button type="submit" className={localStyles.actionButtonPrimary} disabled={busy || !selectedWorkplaceId}>
                          Hiển thị mã
                        </button>
                      </form>

                      {qrToken ? (
                        <div className={localStyles.qrWrap}>
                          <QrCode payload={qrToken.qrPayload} />
                          <div className={localStyles.qrMeta}>
                            <strong>{qrToken.branchName || qrToken.pointName}</strong>
                            <span>Còn hiệu lực khoảng {remainingSeconds} giây.</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className={localStyles.employeeControlGrid}>
              <label className={localStyles.controlField}>
                <span>Nhân sự</span>
                <select
                  value={managedEmployeeId}
                  onChange={(event) => {
                    const employee = managedEmployees.find((item) => item.id === event.target.value);
                    if (employee) selectManagedEmployee(employee);
                    else {
                      setManagedEmployeeId('');
                      setManagedSelected(null);
                    }
                  }}
                >
                  <option value="">Chọn nhân sự</option>
                  {managedEmployeeOptions.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.code} · {employee.name}{employee.branchName ? ` · ${employee.branchName}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className={localStyles.controlField}>
                <span>Tìm nhanh</span>
                <div className={localStyles.quickSearch}>
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    value={managedEmployeeQuery}
                    placeholder="Nhập mã, tên hoặc chi nhánh"
                    autoComplete="off"
                    onChange={(event) => setManagedEmployeeQuery(event.target.value)}
                  />
                </div>
                <small>{filteredManagedEmployees.length} nhân sự phù hợp</small>
              </label>
            </div>

            {!managedSelected ? (
              <div className={localStyles.selectionEmpty}>
                {managedLoading ? 'Đang tải trạng thái nhân sự…' : 'Chọn một nhân sự để xem trạng thái và chấm công.'}
              </div>
            ) : (
              <div className={localStyles.employeeWorkspace}>
                <div className={localStyles.employeeIdentity}>
                  <div className={localStyles.employeeIdentityMain}>
                    <span className={localStyles.employeeAvatar}>
                      {(managedSelected.employee.code || managedSelected.employee.name).slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <h3>{managedSelected.employee.name}</h3>
                      <p>{managedSelected.employee.code} · {managedSelected.employee.branchName || 'Chưa có chi nhánh'}</p>
                    </div>
                  </div>
                  {managedSelected.issue ? (
                    <span className={localStyles.statusPillWarning}>
                      {managedSelected.issue.code === 'WORK_POLICY_REQUIRED' ? 'Chưa gắn chính sách' : 'Cần bổ sung cấu hình'}
                    </span>
                  ) : managedAttendance ? (
                    <span className={localStyles.statusPill}>{STATUS_LABEL[managedAttendance.status]}</span>
                  ) : (
                    <span className={localStyles.statusPillMuted}>Chưa có trạng thái</span>
                  )}
                </div>

                {managedSelected.issue ? (
                  <div className={localStyles.configurationNotice}>
                    <strong>
                      {managedSelected.issue.code === 'WORK_POLICY_REQUIRED'
                        ? 'Chưa có chính sách tính công'
                        : 'Cấu hình chấm công chưa đầy đủ'}
                    </strong>
                    <span>
                      {managedSelected.issue.message}. Quản lý vẫn có thể chấm công trực tiếp; Bảng công sẽ chờ cấu hình để tính công chính xác.
                    </span>
                  </div>
                ) : null}

                {managedAttendance ? (
                  <>
                    <div className={localStyles.primaryActions}>
                      {managedAttendance.nextAction === 'CHECK_IN' ? (
                        <button type="button" className={localStyles.actionButtonPrimary} disabled={busy || managedLoading} onClick={() => void submitManagedManualAttendance('CHECK_IN')}>
                          Chấm vào trực tiếp
                        </button>
                      ) : null}
                      {managedAttendance.nextAction === 'EXIT' ? (
                        <>
                          <button type="button" className={localStyles.actionButtonSecondary} disabled={busy || managedLoading} onClick={() => setManagedExitOpen((current) => !current)}>
                            Ra ngoài
                          </button>
                          <button type="button" className={localStyles.actionButtonSecondary} disabled={busy || managedLoading} onClick={() => void submitManagedManualAttendance('CHECK_OUT')}>
                            Kết thúc làm việc
                          </button>
                        </>
                      ) : null}
                      {managedAttendance.nextAction === 'RETURN' ? (
                        <button type="button" className={localStyles.actionButtonPrimary} disabled={busy || managedLoading} onClick={() => void submitManagedManualAttendance('RETURN')}>
                          Quay lại
                        </button>
                      ) : null}
                      {!managedAttendance.nextAction ? <span className={localStyles.completedText}>Ngày làm việc đã kết thúc.</span> : null}
                      <a className={localStyles.actionButtonLink} href="/workforce/policies">Gắn chính sách</a>
                    </div>

                    {managedExitOpen && managedAttendance.nextAction === 'EXIT' ? (
                      <div className={localStyles.managedExitPanel}>
                        <div>
                          <strong>Mục đích ra ngoài</strong>
                          <span>Chỉ chọn khi nhân sự sẽ quay lại làm việc trong ngày.</span>
                        </div>
                        <div className={localStyles.exitReasonGrid}>
                          {(['WORK_BUSINESS', 'PERSONAL', 'BREAK', 'OTHER'] as const).map((reason) => (
                            <button type="button" key={reason} className={managedExitReason === reason ? localStyles.exitReasonActive : localStyles.exitReasonButton} onClick={() => setManagedExitReason(reason)}>
                              {EXIT_REASON_LABEL[reason]}
                            </button>
                          ))}
                        </div>
                        {managedExitReason === 'OTHER' ? (
                          <input value={managedExitNote} onChange={(event) => setManagedExitNote(event.target.value)} maxLength={1024} placeholder="Ghi rõ lý do" />
                        ) : null}
                        <div className={localStyles.exitConfirmRow}>
                          <button type="button" className={localStyles.actionButtonSecondary} onClick={() => setManagedExitOpen(false)}>Hủy</button>
                          <button
                            type="button"
                            className={localStyles.actionButtonPrimary}
                            disabled={!managedExitReason || (managedExitReason === 'OTHER' && !managedExitNote.trim()) || busy}
                            onClick={() => void submitManagedManualAttendance('TEMP_EXIT', managedExitReason as Exclude<ExitReason, '' | 'END_WORK'>, managedExitNote)}
                          >
                            Ghi nhận ra ngoài
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className={localStyles.detailGrid}>
                      <section className={localStyles.infoCard}>
                        <div className={localStyles.infoCardHeader}><h3>Thông tin hôm nay</h3></div>
                        <div className={localStyles.infoRows}>
                          <div className={localStyles.infoRow}><span>Ngày làm việc</span><strong>{managedAttendance.workDate}</strong></div>
                          <div className={localStyles.infoRow}><span>Trạng thái</span><strong>{STATUS_LABEL[managedAttendance.status]}</strong></div>
                          <div className={localStyles.infoRow}><span>Chính sách</span><strong>{managedAttendance.policy?.name || 'Chờ gắn chính sách'}</strong></div>
                          <div className={localStyles.infoRow}><span>Dự kiến vào/ra</span><strong>{formatDateTime(managedAttendance.expectedStartAt, managedTimeZone)} — {formatDateTime(managedAttendance.expectedEndAt, managedTimeZone)}</strong></div>
                        </div>
                      </section>

                      <section className={localStyles.infoCard}>
                        <div className={localStyles.infoCardHeader}>
                          <h3>Lịch sử hôm nay</h3>
                          <span>{managedAttendance.events.length} lần ghi nhận</span>
                        </div>
                        <div className={localStyles.eventList}>
                          {managedAttendance.events.map((attendanceEvent) => (
                            <div className={localStyles.eventItem} key={attendanceEvent.id}>
                              <span>
                                <strong>{eventLabel(attendanceEvent)}</strong>
                                <small>{attendanceEvent.note || attendanceEvent.point_name || (attendanceEvent.source === 'FACE' ? 'Máy chấm công khuôn mặt' : attendanceEvent.source === 'QR' ? 'Mã QR' : 'Chấm công trực tiếp')}</small>
                              </span>
                              <time>{formatDateTime(attendanceEvent.occurred_at, managedTimeZone)}</time>
                            </div>
                          ))}
                          {!managedAttendance.events.length ? (
                            <div className={localStyles.historyEmpty}>
                              <strong>Chưa có lần chấm công nào trong ngày làm việc này.</strong>
                              <span>Thao tác chấm công sẽ xuất hiện tại đây ngay sau khi ghi nhận.</span>
                            </div>
                          ) : null}
                        </div>
                      </section>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {!managedEmployees && today ? (
          <section className={localStyles.selfPanel} data-testid="attendance-self-service">
            <div className={localStyles.panelHeader}>
              <div>
                <p className={styles.panelKicker}>Cá nhân</p>
                <h2>Chấm công của tôi</h2>
                <p>{today.employee.full_name} · {today.employee.branch_name || 'Chưa có chi nhánh'}</p>
              </div>
              <span className={localStyles.statusPill}>{STATUS_LABEL[today.status]}</span>
            </div>

            <div className={localStyles.selfMetaRow}>
              <span>Dự kiến vào: <strong>{formatDateTime(today.expectedStartAt, timeZone)}</strong></span>
              <span>Dự kiến ra: <strong>{formatDateTime(today.expectedEndAt, timeZone)}</strong></span>
              <span>{today.policy.name}</span>
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
                      {today.nextAction
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
                      disabled={busy || !today.nextAction || !exitSelectionReady}
                      data-testid="attendance-start-camera"
                    >
                      Mở camera quét QR
                    </button>
                  ) : (
                    <button type="button" className={styles.secondaryButton} onClick={stopScanner}>Dừng camera</button>
                  )}
                </div>
              </>
            ) : faceAllowed ? null : (
              <div className={localStyles.methodNotice}>Chính sách hiện tại không yêu cầu quét mã. Dùng cách chấm công được hiển thị bên dưới.</div>
            )}

            {faceAllowed ? (
              <div className={localStyles.methodNotice} data-testid="attendance-face-method">
                Quét khuôn mặt được thực hiện tại máy chấm công của nơi làm việc. Nhân sự không cần chọn tên hoặc nhập giờ trên trình duyệt.
              </div>
            ) : null}

            {today.nextAction === 'EXIT' ? (
              <div className={localStyles.exitPanel} data-testid="attendance-exit-reason">
                <strong>Lý do rời nơi làm việc</strong>
                <span>Chọn đúng mục để bảng công phân biệt kết thúc ngày với ra tạm thời.</span>
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

            {today.policy.attendanceBasis === 'PRESENCE' ? (
              <div className={localStyles.methodNotice}>Chính sách này chỉ xác nhận có mặt. Sau khi ghi nhận vào làm, Bảng công không dùng số phút làm việc để tính công và không yêu cầu ghi nhận giờ ra.</div>
            ) : null}

            {manualAllowed ? (
              <div className={localStyles.manualAttendanceCard} data-testid="attendance-manual-record">
                <div>
                  <strong>Chấm công trực tiếp</strong>
                  <span>Hệ thống tự ghi nhận giờ hiện tại. Không cần nhập thời gian hoặc chọn nơi làm việc.</span>
                </div>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void submitManualAttendance()}
                  disabled={busy || !today.nextAction || !exitSelectionReady}
                >
                  {today.nextAction === 'EXIT' ? 'Ghi nhận rời nơi làm việc' : nextActionLabel}
                </button>
              </div>
            ) : null}

            <div className={localStyles.eventList} data-testid="attendance-today-events">
              {today.events.map((attendanceEvent) => (
                <div className={localStyles.eventItem} key={attendanceEvent.id}>
                  <span>
                    <strong>{eventLabel(attendanceEvent)}</strong>
                    <small>{attendanceEvent.note || attendanceEvent.point_name || (attendanceEvent.source === 'MANUAL' ? 'Chấm công trực tiếp' : attendanceEvent.source === 'FACE' ? 'Máy chấm công khuôn mặt' : 'Nơi làm việc')}</small>
                  </span>
                  <time>{formatDateTime(attendanceEvent.occurred_at, timeZone)}</time>
                </div>
              ))}
              {!today.events.length ? <div className={localStyles.selectionEmpty}>Chưa có lần chấm công nào trong ngày làm việc này.</div> : null}
            </div>
          </section>
        ) : null}

        {!managedEmployees && !today && !error ? (
          <div className={localStyles.selectionEmpty}>Không có chức năng chấm công phù hợp với tài khoản hiện tại.</div>
        ) : null}

      </section>
    </AppShell>
  );
}
