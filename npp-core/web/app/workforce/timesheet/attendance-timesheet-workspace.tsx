'use client';

import { createIdempotencyKey } from '@npp/contracts';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import localStyles from './attendance-timesheet.module.css';
import type {
  AttendanceDayStatus,
  AttendanceEvent,
  AttendanceTimesheetDay,
  AttendanceTimesheetMonth,
  AttendanceTimesheetResponse,
} from '../../../lib/workforce-types';

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
type Attempt = { payload: string; key: string } | null;
type QuickAttendanceAction = 'CHECK_IN' | 'CHECK_OUT' | 'TEMP_EXIT' | 'RETURN' | 'END_EXTERNAL_WORK';
type QuickExitReason = 'WORK_BUSINESS' | 'PERSONAL' | 'BREAK' | 'OTHER';

const QUICK_EXIT_LABEL: Record<QuickExitReason, string> = {
  WORK_BUSINESS: 'Ra ngoài làm việc',
  PERSONAL: 'Ra ngoài việc cá nhân',
  BREAK: 'Nghỉ giữa ca',
  OTHER: 'Lý do khác',
};

function stableMutationKey(ref: React.MutableRefObject<Attempt>, operation: string, payload: unknown) {
  const serialized = JSON.stringify(payload);
  if (ref.current?.payload === serialized) return ref.current.key;
  const key = createIdempotencyKey(operation);
  ref.current = { payload: serialized, key };
  return key;
}

function externalWorkPending(day: AttendanceTimesheetDay) {
  const latest = day.events.at(-1) ?? null;
  return latest?.event_type === 'TEMP_EXIT' && latest.movement_reason === 'WORK_BUSINESS';
}

function currentWorkDate(timeZone = 'Asia/Ho_Chi_Minh') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timeInputValue(value: string | null, timeZone = 'Asia/Ho_Chi_Minh') {
  return value ? timeLabel(value, timeZone) : '';
}

function adjustmentInstant(workDate: string, time: string) {
  if (!time) return null;
  return new Date(`${workDate}T${time}:00+07:00`).toISOString();
}

const STATUS_LABEL: Record<AttendanceDayStatus, string> = {
  UPCOMING: 'Sắp tới',
  DAY_OFF: 'Ngày nghỉ',
  NO_ATTENDANCE_REQUIRED: 'Không yêu cầu chấm công',
  MISSING_POLICY: 'Thiếu chính sách làm việc',
  MISSING_SCHEDULE: 'Thiếu lịch làm việc',
  NOT_STARTED: 'Chưa chấm công',
  WORKING: 'Đang làm việc',
  OUTSIDE: 'Đang ra ngoài',
  MISSING_CHECK_IN: 'Thiếu giờ vào',
  MISSING_CHECK_OUT: 'Thiếu giờ ra',
  INCOMPLETE: 'Chấm công chưa đầy đủ',
  APPROVED_LEAVE: 'Nghỉ được duyệt',
  PENDING_LEAVE: 'Chờ duyệt nghỉ',
  PENDING_ADJUSTMENT: 'Chờ duyệt điều chỉnh',
  UNEXCUSED_ABSENCE: 'Vắng không phép',
  LATE_AND_EARLY: 'Đi trễ và về sớm',
  LATE: 'Đi trễ',
  EARLY: 'Về sớm',
  COMPLETE: 'Chấm công đầy đủ',
};

const SOURCE_LABEL: Record<AttendanceEvent['source'], string> = {
  QR: 'Mã QR',
  FACE: 'Quét khuôn mặt',
  MANUAL: 'Chấm trực tiếp',
  ADJUSTMENT: 'Điều chỉnh',
  SYSTEM: 'Hệ thống',
};

function dateLabel(value: string) {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function dayCountLabel(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(Math.max(0, value || 0));
}

function statusLabel(day: AttendanceTimesheetDay) {
  if (day.status === 'APPROVED_LEAVE') {
    const label = day.leave.approvedLabels.join(' + ') || 'Nghỉ được duyệt';
    return day.leave.approvedFraction < 1 ? `${label} · Nửa ngày` : label;
  }
  if (day.status === 'PENDING_LEAVE') {
    return day.leave.pendingFraction < 1 ? 'Chờ duyệt nghỉ · Nửa ngày' : 'Chờ duyệt nghỉ';
  }
  return STATUS_LABEL[day.status];
}

function leaveSegmentLabel(day: AttendanceTimesheetDay) {
  const approved = new Set(day.leave.approvedSegments);
  if (approved.has('FIRST_HALF') && approved.has('SECOND_HALF')) return 'Cả ngày';
  if (approved.has('FIRST_HALF')) return 'Nửa ca đầu';
  if (approved.has('SECOND_HALF')) return 'Nửa ca sau';
  const pending = new Set(day.leave.pendingSegments);
  if (pending.has('FIRST_HALF') && pending.has('SECOND_HALF')) return 'Cả ngày đang chờ duyệt';
  if (pending.has('FIRST_HALF')) return 'Nửa ca đầu đang chờ duyệt';
  if (pending.has('SECOND_HALF')) return 'Nửa ca sau đang chờ duyệt';
  return 'Không có';
}

function leaveSummary(day: AttendanceTimesheetDay) {
  if (!day.leave.requests.length) return 'Không có đơn nghỉ';
  const approved = day.leave.approvedLabels.length ? `Đã duyệt: ${day.leave.approvedLabels.join(' + ')}` : '';
  const pending = day.leave.pendingLabels.length ? `Chờ duyệt: ${day.leave.pendingLabels.join(' + ')}` : '';
  return [approved, pending].filter(Boolean).join(' · ');
}

function requiredWorkLabel(day: AttendanceTimesheetDay) {
  if (!day.scheduledWorkDay || day.status === 'DAY_OFF') return 'Không phải làm';
  if (day.leave.approvedFraction >= 1) return 'Không phải làm';
  if (day.requiredStartAt && day.requiredEndAt) {
    return `${timeLabel(day.requiredStartAt, day.policy?.timezone)} – ${timeLabel(day.requiredEndAt, day.policy?.timezone)}`;
  }
  return 'Theo chính sách làm việc';
}

function monthBounds(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return { from: value + '-01', to: value + '-31' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

function monthDayDate(value: string, day: number) {
  const bounds = monthBounds(value);
  const lastDay = Number(bounds.to.slice(-2));
  return day <= lastDay ? `${value}-${String(day).padStart(2, '0')}` : null;
}

function compactDayLabel(day: AttendanceTimesheetDay) {
  switch (day.status) {
    case 'COMPLETE': return '✓';
    case 'LATE': return 'Trễ';
    case 'EARLY': return 'Sớm';
    case 'LATE_AND_EARLY': return 'Trễ, sớm';
    case 'DAY_OFF': return 'Nghỉ';
    case 'APPROVED_LEAVE': return day.leave.approvedFraction < 1 ? '½ ngày phép' : 'Nghỉ phép';
    case 'PENDING_LEAVE': return 'Chờ duyệt nghỉ';
    case 'PENDING_ADJUSTMENT': return 'Chờ điều chỉnh';
    case 'UNEXCUSED_ABSENCE': return 'Vắng';
    case 'NO_ATTENDANCE_REQUIRED': return 'Không chấm công';
    case 'WORKING': return 'Đang';
    case 'OUTSIDE': return 'Ra ngoài';
    case 'UPCOMING': return '';
    case 'NOT_STARTED': return 'Chưa';
    case 'MISSING_POLICY': return 'Thiếu chính sách';
    case 'MISSING_SCHEDULE': return 'Thiếu lịch làm việc';
    default: return 'Chưa đủ công';
  }
}

function compactDayTone(day: AttendanceTimesheetDay) {
  if (day.status === 'COMPLETE') return 'good';
  if (day.status === 'DAY_OFF' || day.status === 'APPROVED_LEAVE' || day.status === 'NO_ATTENDANCE_REQUIRED' || day.status === 'UPCOMING') return 'muted';
  if (day.status === 'MISSING_POLICY' || day.status === 'MISSING_SCHEDULE' || day.status === 'PENDING_LEAVE' || day.status === 'PENDING_ADJUSTMENT' || day.status === 'LATE' || day.status === 'EARLY' || day.status === 'LATE_AND_EARLY' || day.status === 'WORKING' || day.status === 'OUTSIDE') return 'warn';
  return 'danger';
}

function timeLabel(value: string | null, timeZone = 'Asia/Ho_Chi_Minh') {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

function dateTimeLabel(value: string | null, timeZone = 'Asia/Ho_Chi_Minh') {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function minutesLabel(value: number) {
  const safe = Math.max(0, Math.round(value || 0));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (!hours) return `${minutes} phút`;
  if (!minutes) return `${hours} giờ`;
  return `${hours} giờ ${minutes} phút`;
}

function missingLabel(day: AttendanceTimesheetDay) {
  const values = [];
  if (day.unexcusedAbsenceFraction > 0) values.push(`Vắng không phép ${dayCountLabel(day.unexcusedAbsenceFraction)} ngày`);
  if (day.missingCheckIn) values.push('Thiếu giờ vào');
  if (day.missingCheckOut) values.push('Thiếu giờ ra');
  if (day.configurationIssue === 'MISSING_POLICY') values.push('Thiếu chính sách làm việc');
  if (day.configurationIssue === 'MISSING_SCHEDULE') values.push('Thiếu lịch làm việc');
  return values.length ? values.join(' · ') : 'Đủ';
}

function sourceSummary(day: AttendanceTimesheetDay) {
  const values = day.attendanceSources.map((source) => SOURCE_LABEL[source]);
  if (day.scheduleSource === 'OVERRIDE') values.push('Lịch điều chỉnh');
  else if (day.scheduleSource === 'POLICY') values.push('Lịch theo chính sách');
  if (day.leave.requests.length) values.push('Đơn nghỉ');
  return [...new Set(values)].join(' · ') || 'Chưa có thông tin';
}

function validationLabel(value: AttendanceEvent['validation_status']) {
  if (value === 'VALID') return 'Hợp lệ';
  if (value === 'PENDING') return 'Chờ xác minh';
  return 'Không hợp lệ';
}

function violationSummary(day: AttendanceTimesheetDay) {
  const evaluation = day.violationEvaluation;
  if (!evaluation) return 'Chưa đánh giá';
  if (evaluation.state === 'HAS_VIOLATIONS') {
    return evaluation.items.map((item) => item.detail).join(' · ');
  }
  if (evaluation.state === 'CLEAR') return 'Không ghi nhận';
  return evaluation.explanation;
}

function monthlyViolationSummary(row: AttendanceTimesheetMonth) {
  if (!row.violationDays) return 'Không ghi nhận';
  const parts = [`${row.violationDays} ngày`];
  if (row.lateViolationDays) parts.push(`Trễ ${row.lateViolationDays}`);
  if (row.earlyLeaveViolationDays) parts.push(`Sớm ${row.earlyLeaveViolationDays}`);
  if (row.missingAttendanceViolationDays) parts.push(`Thiếu ${row.missingAttendanceViolationDays}`);
  if (row.unexcusedAbsenceViolationDays) parts.push(`Vắng ${dayCountLabel(row.unexcusedAbsenceViolationDays)}`);
  return parts.join(' · ');
}

function employeeAttentionSummary(row: AttendanceTimesheetMonth) {
  const parts: string[] = [];
  if (row.unexcusedAbsenceDays) parts.push(`Vắng ${dayCountLabel(row.unexcusedAbsenceDays)}`);
  if (row.incompleteDays) parts.push(`Thiếu chấm công ${dayCountLabel(row.incompleteDays)}`);
  if (row.violationDays) parts.push(`Vi phạm ${row.violationDays}`);
  if (row.pendingLeaveDays) parts.push(`Chờ duyệt nghỉ ${dayCountLabel(row.pendingLeaveDays)}`);
  if (row.pendingAdjustmentDays) parts.push(`Chờ điều chỉnh ${row.pendingAdjustmentDays}`);
  if (row.configurationIssueDays) parts.push(`Thiếu thiết lập ${row.configurationIssueDays}`);
  return parts.join(' · ') || 'Không có';
}

function employeeLeaveSummary(row: AttendanceTimesheetMonth) {
  const parts: string[] = [];
  if (row.scheduledDaysOff) parts.push(`Nghỉ theo lịch ${dayCountLabel(row.scheduledDaysOff)}`);
  if (row.approvedLeaveDays) parts.push(`Phép ${dayCountLabel(row.approvedLeaveDays)}`);
  return parts.join(' · ') || '—';
}

function dayAttentionSummary(day: AttendanceTimesheetDay) {
  if (day.configurationIssue === 'MISSING_POLICY') return 'Thiếu chính sách';
  if (day.configurationIssue === 'MISSING_SCHEDULE') return 'Thiếu lịch làm việc';
  if (day.unexcusedAbsenceFraction > 0) return `Vắng ${dayCountLabel(day.unexcusedAbsenceFraction)} ngày`;
  if (day.lateMinutes && day.earlyLeaveMinutes) return `Trễ ${day.lateMinutes}′ · Sớm ${day.earlyLeaveMinutes}′`;
  if (day.lateMinutes) return `Trễ ${day.lateMinutes}′`;
  if (day.earlyLeaveMinutes) return `Sớm ${day.earlyLeaveMinutes}′`;
  if (day.missingCheckIn) return 'Thiếu giờ vào';
  if (day.missingCheckOut) return 'Thiếu giờ ra';
  if (day.leave.pendingFraction) return 'Chờ duyệt nghỉ';
  if (day.adjustment?.status === 'SUBMITTED') return 'Chờ điều chỉnh';
  return '—';
}

function monthDayWeekday(value: string, day: number) {
  const date = monthDayDate(value, day);
  return date ? new Date(`${date}T00:00:00Z`).getUTCDay() : null;
}

export default function AttendanceTimesheetWorkspace({
  initialData,
  initialFrom,
  initialTo,
  initialError,
}: {
  initialData: AttendanceTimesheetResponse | null;
  initialFrom: string;
  initialTo: string;
  initialError: string | null;
}) {
  const [data, setData] = useState(initialData);
  const [view, setView] = useState<'daily' | 'monthly'>('daily');
  const [from, setFrom] = useState(initialData?.period.from ?? initialFrom);
  const [to, setTo] = useState(initialData?.period.to ?? initialTo);
  const [month, setMonth] = useState((initialData?.period.from ?? initialFrom).slice(0, 7));
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [selectedDay, setSelectedDay] = useState<AttendanceTimesheetDay | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<AttendanceTimesheetMonth | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dayActionBusy, setDayActionBusy] = useState(false);
  const [quickExitOpen, setQuickExitOpen] = useState(false);
  const [quickExitReason, setQuickExitReason] = useState<QuickExitReason | ''>('');
  const [quickExitNote, setQuickExitNote] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustCheckIn, setAdjustCheckIn] = useState('');
  const [adjustCheckOut, setAdjustCheckOut] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const quickActionAttempt = useRef<Attempt>(null);
  const directAdjustmentAttempt = useRef<Attempt>(null);

  const employeeRows = useMemo(
    () => data && (data.view === 'employee' || data.view === 'monthly')
      ? data.rows as AttendanceTimesheetMonth[]
      : [],
    [data],
  );

  function openDay(day: AttendanceTimesheetDay) {
    setSelectedDay(day);
    setQuickExitOpen(false);
    setQuickExitReason('');
    setQuickExitNote('');
    setAdjustOpen(false);
    setAdjustCheckIn(timeInputValue(day.checkInAt, day.policy?.timezone));
    setAdjustCheckOut(timeInputValue(day.checkOutAt, day.policy?.timezone));
    setAdjustReason('');
    setError(null);
    setNotice(null);
  }

  async function postMutation<T>(path: string, payload: unknown, key: string): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    });
    const envelope = await response.json().catch(() => ({})) as ApiEnvelope<T>;
    if (!response.ok || envelope.data === undefined) {
      throw new Error(envelope.error?.message || 'Không thực hiện được thao tác');
    }
    return envelope.data;
  }

  async function submitQuickAttendance(
    action: QuickAttendanceAction,
    exitReason?: QuickExitReason,
    note?: string,
  ) {
    if (!selectedDay || !data?.capabilities.canManage) return;
    const payload = {
      employeeId: selectedDay.employee.id,
      action,
      ...(exitReason ? { exitReason } : {}),
      ...(note?.trim() ? { note: note.trim() } : {}),
    };
    const key = stableMutationKey(quickActionAttempt, 'timesheet-attendance-quick-action', payload);
    setDayActionBusy(true);
    setError(null);
    setNotice(null);
    try {
      await postMutation('/api/workforce/attendance/manual', payload, key);
      quickActionAttempt.current = null;
      setNotice(action === 'END_EXTERNAL_WORK' ? 'Đã kết thúc công việc bên ngoài.' : 'Đã ghi nhận chấm công.');
      await load(data.pagination.offset);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không ghi nhận được chấm công');
    } finally {
      setDayActionBusy(false);
    }
  }

  async function submitDirectDayAdjustment() {
    if (!selectedDay || !data?.capabilities.canManage) return;
    if (!adjustCheckIn && !adjustCheckOut) {
      setError('Cần nhập ít nhất giờ vào hoặc giờ ra.');
      return;
    }
    if (!adjustReason.trim()) {
      setError('Vui lòng ghi lý do điều chỉnh.');
      return;
    }
    const payload = {
      employeeId: selectedDay.employee.id,
      workDate: selectedDay.workDate,
      requestedCheckInAt: adjustmentInstant(selectedDay.workDate, adjustCheckIn),
      requestedCheckOutAt: adjustmentInstant(selectedDay.workDate, adjustCheckOut),
      reason: adjustReason.trim(),
    };
    const key = stableMutationKey(directAdjustmentAttempt, 'timesheet-attendance-direct-adjustment', payload);
    setDayActionBusy(true);
    setError(null);
    setNotice(null);
    try {
      await postMutation('/api/workforce/adjustments/direct', payload, key);
      directAdjustmentAttempt.current = null;
      setNotice('Đã cập nhật giờ công và lưu lịch sử điều chỉnh.');
      await load(data.pagination.offset);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không điều chỉnh được ngày công');
    } finally {
      setDayActionBusy(false);
    }
  }

  async function load(
    nextOffset = 0,
    nextView = view,
    nextPeriod?: { from: string; to: string },
  ) {
    const period = nextPeriod ?? (nextView === 'monthly' ? monthBounds(month) : { from, to });
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        view: nextView === 'daily' ? 'employee' : 'monthly',
        from: period.from,
        to: period.to,
        limit: nextView === 'daily' ? '100' : '20',
        offset: String(Math.max(0, nextOffset)),
      });
      if (employeeQuery.trim()) params.set('employeeQuery', employeeQuery.trim());
      if (branchId) params.set('branchId', branchId);
      const response = await fetch(`/api/workforce/timesheet?${params.toString()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({})) as ApiEnvelope<AttendanceTimesheetResponse>;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || 'Không tải được bảng công');
      }
      setData(payload.data);
      setView(nextView);
      setFrom(payload.data.period.from);
      setTo(payload.data.period.to);
      if (nextView === 'monthly') setMonth(payload.data.period.from.slice(0, 7));
      setSelectedDay(null);
      setSelectedEmployee(null);
      if (branchId && !payload.data.scope.branches.some((branch) => branch.id === branchId)) {
        setBranchId('');
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được bảng công');
    } finally {
      setBusy(false);
    }
  }

  function changeView(nextView: 'daily' | 'monthly') {
    if (nextView === 'monthly') {
      const nextMonth = (from || initialFrom).slice(0, 7);
      setMonth(nextMonth);
      void load(0, nextView, monthBounds(nextMonth));
      return;
    }
    void load(0, nextView, { from, to });
  }

  const actions = (
    <button
      type="button"
      className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`}
      onClick={() => void load(data?.pagination.offset ?? 0)}
      disabled={busy}
    >
      {busy ? 'Đang cập nhật…' : 'Cập nhật bảng công'}
    </button>
  );

  const rowCount = employeeRows.length;
  const total = data?.pagination.total ?? 0;
  const rangeStart = total && data ? data.pagination.offset + 1 : 0;
  const rangeEnd = data ? Math.min(data.pagination.offset + rowCount, total) : 0;
  const selectedTimeZone = selectedDay?.policy?.timezone || data?.period.timezone || 'Asia/Ho_Chi_Minh';
  const selectedIsToday = Boolean(selectedDay && selectedDay.workDate === currentWorkDate(selectedTimeZone));
  const selectedCanOperateNow = Boolean(
    selectedDay
      && selectedIsToday
      && data?.capabilities.canManage
      && (!selectedDay.periodLock || data.capabilities.canLock),
  );
  const selectedCanAdjust = Boolean(
    selectedDay
      && data?.capabilities.canManage
      && (!selectedDay.periodLock || data.capabilities.canLock),
  );
  const selectedNeedsCheckIn = Boolean(selectedDay && !selectedDay.checkInAt);
  const selectedNeedsCheckOut = Boolean(selectedDay && selectedDay.checkInAt && !selectedDay.checkOutAt);
  const selectedExternalWorkPending = Boolean(selectedDay && externalWorkPending(selectedDay));

  return (
    <AppShell
      title="Bảng công"
      subtitle="Theo dõi lịch làm, nghỉ, phép, chấm công và tình trạng xử lý theo phạm vi được cấp."
      kicker="Nhân sự"
      actions={actions}
    >
      <section className={`${styles.page} ${localStyles.timesheetPage}`} data-testid="attendance-timesheet-page">
        {(error || notice) ? (
          <div className={`${styles.banner} ${error ? styles.bannerError : styles.bannerSuccess}`} role="status">
            {error ?? notice}
          </div>
        ) : null}

        <div className={localStyles.timesheetTopbar}>
          <section className={`${styles.summaryGrid} ${localStyles.compactSummaryGrid}`} aria-label="Tóm tắt Bảng công">
            <article className={styles.summaryCard} title="Tối đa 93 ngày mỗi lần xem">
              <span>Kỳ đang xem</span>
              <strong>{dateLabel(from)} – {dateLabel(to)}</strong>
            </article>
            <article className={styles.summaryCard}>
              <span>Phạm vi</span>
              <strong>
                {data?.scope.selfOnly
                  ? 'Bản thân'
                  : data?.scope.companyScope
                    ? 'Toàn Công Ty'
                    : `${data?.scope.branches.length ?? 0} chi nhánh`}
              </strong>
            </article>
            <article className={styles.summaryCard}>
              <span>Số nhân sự</span>
              <strong>{total}</strong>
            </article>
          </section>

          <section className={`${styles.toolbar} ${localStyles.compactToolbar}`}>
          <div className={localStyles.viewSwitch} aria-label="Chế độ xem bảng công">
            <button
              type="button"
              className={view === 'daily' ? localStyles.viewActive : ''}
              onClick={() => changeView('daily')}
              disabled={busy}
            >
              Theo ngày
            </button>
            <button
              type="button"
              className={view === 'monthly' ? localStyles.viewActive : ''}
              onClick={() => changeView('monthly')}
              disabled={busy}
            >
              Theo tháng
            </button>
          </div>

          {view === 'monthly' ? (
            <div className={styles.toolbarFilter}>
              <label htmlFor="timesheet-month">Tháng</label>
              <input id="timesheet-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </div>
          ) : (
            <>
              <div className={styles.toolbarFilter}>
                <label htmlFor="timesheet-from">Từ ngày</label>
                <input id="timesheet-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </div>
              <div className={styles.toolbarFilter}>
                <label htmlFor="timesheet-to">Đến ngày</label>
                <input id="timesheet-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              </div>
            </>
          )}

          {!data?.scope.selfOnly ? (
            <div className={styles.toolbarFilter}>
              <label htmlFor="timesheet-employee">Nhân sự</label>
              <input
                id="timesheet-employee"
                value={employeeQuery}
                onChange={(event) => setEmployeeQuery(event.target.value)}
                placeholder="Mã hoặc tên nhân sự"
                maxLength={80}
              />
            </div>
          ) : null}

          {!data?.scope.selfOnly && (data?.scope.branches.length ?? 0) > 0 ? (
            <div className={styles.toolbarFilter}>
              <label htmlFor="timesheet-branch">Chi nhánh</label>
              <select id="timesheet-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                <option value="">Tất cả chi nhánh được cấp</option>
                {data?.scope.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => void load(0)} disabled={busy}>
              {busy ? 'Đang tải…' : 'Xem bảng công'}
            </button>
          </div>
          </section>
        </div>

        {view === 'daily' ? (
          <section className={`${styles.tableSection} ${localStyles.timesheetTableSection}`}>
            <div className={`${styles.tableWrap} ${localStyles.tableViewport}`}>
              <table className={`${styles.table} ${localStyles.employeeSummaryTable}`} data-testid="attendance-timesheet-daily-table">
                <thead>
                  <tr>
                    <th>Nhân sự</th>
                    <th>Ngày phải làm</th>
                    <th>Ngày đủ công</th>
                    <th>Nghỉ và phép</th>
                    <th>Cần xử lý</th>
                    <th>Giờ được tính</th>
                    <th>Điều chỉnh</th>
                    <th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeRows.map((row) => (
                    <tr key={row.employee.id}>
                      <td>
                        <button
                          type="button"
                          className={localStyles.employeeNameButton}
                          onClick={() => setSelectedEmployee(row)}
                        >
                          <strong>{row.employee.code} · {row.employee.name}</strong>
                          <small>{row.employee.branchName || 'Chưa gán chi nhánh'}</small>
                        </button>
                      </td>
                      <td>{dayCountLabel(row.workDays)}</td>
                      <td>{dayCountLabel(row.completedDays)}</td>
                      <td>{employeeLeaveSummary(row)}</td>
                      <td className={row.violationDays || row.incompleteDays || row.unexcusedAbsenceDays || row.configurationIssueDays ? localStyles.attentionCell : ''}>
                        {employeeAttentionSummary(row)}
                      </td>
                      <td>{minutesLabel(row.countedMinutes)}</td>
                      <td>
                        {row.adjustedDays ? `${row.adjustedDays} đã duyệt` : '—'}
                        {row.pendingAdjustmentDays ? <small className={localStyles.pendingText}>{row.pendingAdjustmentDays} chờ duyệt</small> : null}
                      </td>
                      <td>
                        <button type="button" className={localStyles.employeeOpenButton} onClick={() => setSelectedEmployee(row)}>
                          Xem từng ngày
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!employeeRows.length ? (
                    <tr><td colSpan={8}><div className={styles.emptyState}>Không có nhân sự trong phạm vi và kỳ đã chọn.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className={`${styles.tableSection} ${localStyles.timesheetTableSection}`}>
            <div className={localStyles.matrixLegend} aria-label="Chú thích bảng công">
              <span><strong>✓</strong> Đủ</span>
              <span><strong>Trễ, sớm</strong> Có sai lệch giờ</span>
              <span><strong>Chưa đủ</strong> Có chấm công nhưng chưa đầy đủ</span>
              <span><strong>Vắng</strong> Có lịch làm nhưng không có chấm công hoặc đơn nghỉ được duyệt</span>
              <span><strong>Nghỉ</strong> Lịch không phải làm</span>
              <span><strong>Phép</strong> Nghỉ đã được duyệt</span>
              <span><strong>Chờ duyệt nghỉ</strong> Đơn nghỉ đang chờ duyệt</span>
            </div>
            <div className={`${localStyles.matrixWrap} ${localStyles.tableViewport}`}>
              <table className={localStyles.matrixTable} data-testid="attendance-timesheet-monthly-table">
                <thead>
                  <tr>
                    <th className={localStyles.matrixSticky}>Nhân sự</th>
                    {Array.from({ length: 31 }, (_, index) => index + 1).map((dayNumber) => {
                      const weekday = monthDayWeekday(month, dayNumber);
                      const weekendClass = weekday === 6
                        ? localStyles.matrixSaturday
                        : weekday === 0
                          ? localStyles.matrixSunday
                          : '';
                      return (
                        <th className={`${localStyles.matrixDayHead} ${weekendClass}`} key={dayNumber}>
                          <span>{dayNumber}</span>
                          {weekday === 6 ? <small>T7</small> : weekday === 0 ? <small>CN</small> : null}
                        </th>
                      );
                    })}
                    <th>Ngày làm đến nay</th>
                    <th>Ngày đủ</th>
                    <th>Nghỉ theo lịch</th>
                    <th>Phép</th>
                    <th>Chờ duyệt nghỉ</th>
                    <th>Vắng</th>
                    <th>Thiếu chấm công</th>
                    <th>Thiếu thiết lập</th>
                    <th>Vi phạm</th>
                    <th>Đi trễ</th>
                    <th>Về sớm</th>
                    <th>Giờ được tính</th>
                    <th>Điều chỉnh</th>
                    <th>Ngày khóa</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeRows.map((row) => {
                    const dayMap = new Map(row.days.map((day) => [day.workDate, day]));
                    return (
                      <tr key={row.employee.id}>
                        <td className={localStyles.matrixSticky}>
                          <strong>{row.employee.code} · {row.employee.name}</strong>
                          <small>{row.employee.branchName || 'Chưa gán chi nhánh'}</small>
                        </td>
                        {Array.from({ length: 31 }, (_, index) => index + 1).map((dayNumber) => {
                          const date = monthDayDate(month, dayNumber);
                          const day = date ? dayMap.get(date) : null;
                          return (
                            <td
                              className={`${localStyles.matrixDayCell} ${monthDayWeekday(month, dayNumber) === 6 ? localStyles.matrixSaturday : monthDayWeekday(month, dayNumber) === 0 ? localStyles.matrixSunday : ''}`}
                              key={dayNumber}
                            >
                              {!date ? (
                                <span className={localStyles.matrixUnavailable}>—</span>
                              ) : day ? (
                                <button
                                  type="button"
                                  className={`${localStyles.matrixCellButton} ${localStyles[`matrixTone_${compactDayTone(day)}`]}`}
                                  onClick={() => openDay(day)}
                                  title={`${dateLabel(day.workDate)} · ${statusLabel(day)}`}
                                  aria-label={`${dateLabel(day.workDate)} · ${statusLabel(day)} · ${row.employee.name}`}
                                >
                                  {compactDayLabel(day)}
                                </button>
                              ) : (
                                <span className={localStyles.matrixUnavailable}>—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className={localStyles.matrixTotal}>{dayCountLabel(row.workDays)}</td>
                        <td className={localStyles.matrixTotal}>{dayCountLabel(row.completedDays)}</td>
                        <td className={localStyles.matrixTotal}>{dayCountLabel(row.scheduledDaysOff)}</td>
                        <td className={localStyles.matrixTotal}>{dayCountLabel(row.approvedLeaveDays)}</td>
                        <td className={localStyles.matrixTotal}>{dayCountLabel(row.pendingLeaveDays)}</td>
                        <td className={localStyles.matrixTotal}>{dayCountLabel(row.unexcusedAbsenceDays)}</td>
                        <td className={localStyles.matrixTotal}>{dayCountLabel(row.incompleteDays)}</td>
                        <td className={localStyles.matrixTotal}>{dayCountLabel(row.configurationIssueDays)}</td>
                        <td className={localStyles.matrixTotal}>{monthlyViolationSummary(row)}</td>
                        <td className={localStyles.matrixTotal}>{minutesLabel(row.lateMinutes)}</td>
                        <td className={localStyles.matrixTotal}>{minutesLabel(row.earlyLeaveMinutes)}</td>
                        <td className={localStyles.matrixTotal}>{minutesLabel(row.countedMinutes)}</td>
                        <td className={localStyles.matrixTotal}>
                          {row.adjustedDays} đã duyệt{row.pendingAdjustmentDays ? ` · ${row.pendingAdjustmentDays} chờ duyệt` : ''}
                        </td>
                        <td className={localStyles.matrixTotal}>{row.lockedDays}</td>
                      </tr>
                    );
                  })}
                  {!employeeRows.length ? (
                    <tr>
                      <td colSpan={46}><div className={styles.emptyState}>Không có nhân sự trong phạm vi và tháng đã chọn.</div></td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {selectedEmployee ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setSelectedEmployee(null)}>
            <div className={`${styles.modal} ${localStyles.employeeModal}`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.panelKicker}>Công theo ngày</p>
                  <h3>{selectedEmployee.employee.code} · {selectedEmployee.employee.name}</h3>
                  <small>{selectedEmployee.employee.branchName || 'Chưa gán chi nhánh'} · {dateLabel(selectedEmployee.period.from)} – {dateLabel(selectedEmployee.period.to)}</small>
                </div>
                <button type="button" className={styles.modalClose} onClick={() => setSelectedEmployee(null)}>Đóng</button>
              </div>

              <div className={localStyles.employeeModalSummary}>
                <div><span>Ngày phải làm</span><strong>{dayCountLabel(selectedEmployee.workDays)}</strong></div>
                <div><span>Ngày đủ công</span><strong>{dayCountLabel(selectedEmployee.completedDays)}</strong></div>
                <div><span>Nghỉ và phép</span><strong>{employeeLeaveSummary(selectedEmployee)}</strong></div>
                <div><span>Giờ được tính</span><strong>{minutesLabel(selectedEmployee.countedMinutes)}</strong></div>
              </div>

              <div className={localStyles.employeeDayTableWrap}>
                <table className={`${styles.table} ${localStyles.employeeDayTable}`}>
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Trạng thái</th>
                      <th>Lịch làm</th>
                      <th>Vào – Ra</th>
                      <th>Được tính</th>
                      <th>Cần xử lý</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedEmployee.days.map((day) => (
                      <tr key={day.workDate}>
                        <td><strong>{dateLabel(day.workDate)}</strong></td>
                        <td>{statusLabel(day)}</td>
                        <td>{day.scheduledWorkDay ? `${timeLabel(day.expectedStartAt, day.policy?.timezone)} – ${timeLabel(day.expectedEndAt, day.policy?.timezone)}` : 'Ngày nghỉ'}</td>
                        <td>{timeLabel(day.checkInAt, day.policy?.timezone)} → {timeLabel(day.checkOutAt, day.policy?.timezone)}</td>
                        <td>{minutesLabel(day.countedMinutes)}</td>
                        <td className={dayAttentionSummary(day) === '—' ? '' : localStyles.attentionCell}>{dayAttentionSummary(day)}</td>
                        <td>
                          <button type="button" className={localStyles.employeeOpenButton} onClick={() => openDay(day)}>
                            Chi tiết
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {selectedDay ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setSelectedDay(null)}>
            <div className={`${styles.modal} ${localStyles.dayModal}`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.panelKicker}>Chi tiết ngày công</p>
                  <h3>{selectedDay.employee.code} · {selectedDay.employee.name}</h3>
                </div>
                <button type="button" className={styles.modalClose} onClick={() => setSelectedDay(null)}>Đóng</button>
              </div>
              <section className={localStyles.dayQuickPanel}>
                <div className={localStyles.dayQuickHeader}>
                  <div>
                    <strong>Thao tác nhanh</strong>
                    <span>{selectedIsToday ? 'Ghi nhận trực tiếp ngay tại Bảng công.' : 'Ngày cũ chỉ sửa bằng điều chỉnh có lưu lịch sử.'}</span>
                  </div>
                  {selectedCanAdjust ? (
                    <button type="button" className={styles.secondaryButton} onClick={() => setAdjustOpen((current) => !current)} disabled={dayActionBusy}>
                      {adjustOpen ? 'Đóng sửa giờ' : 'Sửa giờ vào / ra'}
                    </button>
                  ) : null}
                </div>

                {selectedCanOperateNow ? (
                  <div className={localStyles.dayQuickActions}>
                    {selectedNeedsCheckIn ? (
                      <button type="button" className={styles.primaryButton} disabled={dayActionBusy} onClick={() => void submitQuickAttendance('CHECK_IN')}>Chấm vào</button>
                    ) : null}
                    {selectedNeedsCheckOut && !selectedExternalWorkPending ? (
                      <>
                        <button type="button" className={styles.secondaryButton} disabled={dayActionBusy} onClick={() => setQuickExitOpen((current) => !current)}>Ra ngoài</button>
                        <button type="button" className={styles.primaryButton} disabled={dayActionBusy} onClick={() => void submitQuickAttendance('CHECK_OUT')}>Kết thúc làm việc</button>
                      </>
                    ) : null}
                    {selectedExternalWorkPending ? (
                      <>
                        <button type="button" className={styles.secondaryButton} disabled={dayActionBusy} onClick={() => void submitQuickAttendance('RETURN')}>Quay lại</button>
                        <button type="button" className={styles.primaryButton} disabled={dayActionBusy} onClick={() => void submitQuickAttendance('END_EXTERNAL_WORK')}>Kết thúc công việc bên ngoài</button>
                      </>
                    ) : null}
                    {!selectedNeedsCheckIn && !selectedNeedsCheckOut ? <span className={localStyles.dayQuickDone}>Ngày làm việc đã có đủ giờ vào và giờ ra.</span> : null}
                  </div>
                ) : null}

                {quickExitOpen && selectedCanOperateNow && selectedNeedsCheckOut && !selectedExternalWorkPending ? (
                  <div className={localStyles.dayQuickExit}>
                    <strong>Mục đích ra ngoài</strong>
                    <div>
                      {(Object.keys(QUICK_EXIT_LABEL) as QuickExitReason[]).map((reason) => (
                        <button
                          type="button"
                          key={reason}
                          className={quickExitReason === reason ? localStyles.dayReasonActive : localStyles.dayReasonButton}
                          onClick={() => setQuickExitReason(reason)}
                        >
                          {QUICK_EXIT_LABEL[reason]}
                        </button>
                      ))}
                    </div>
                    {quickExitReason === 'OTHER' ? (
                      <input value={quickExitNote} onChange={(event) => setQuickExitNote(event.target.value)} maxLength={1024} placeholder="Ghi rõ lý do" />
                    ) : null}
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={dayActionBusy || !quickExitReason || (quickExitReason === 'OTHER' && !quickExitNote.trim())}
                      onClick={() => void submitQuickAttendance('TEMP_EXIT', quickExitReason as QuickExitReason, quickExitNote)}
                    >
                      Ghi nhận ra ngoài
                    </button>
                  </div>
                ) : null}

                {adjustOpen && selectedCanAdjust ? (
                  <div className={localStyles.dayAdjustForm}>
                    <label>Giờ vào<input type="time" value={adjustCheckIn} onChange={(event) => setAdjustCheckIn(event.target.value)} /></label>
                    <label>Giờ ra<input type="time" value={adjustCheckOut} onChange={(event) => setAdjustCheckOut(event.target.value)} /></label>
                    <label className={localStyles.dayAdjustReason}>Lý do<input value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} maxLength={1000} placeholder="Ví dụ: xác nhận theo thực tế công việc" /></label>
                    <button type="button" className={styles.primaryButton} onClick={() => void submitDirectDayAdjustment()} disabled={dayActionBusy}>
                      {dayActionBusy ? 'Đang lưu…' : 'Lưu điều chỉnh'}
                    </button>
                  </div>
                ) : null}
              </section>

              <div className={localStyles.dayDetailGrid}>
                <div><span>Ngày</span><strong>{dateLabel(selectedDay.workDate)}</strong></div>
                <div><span>Trạng thái</span><strong>{statusLabel(selectedDay)}</strong></div>
                <div><span>Giờ vào</span><strong>{timeLabel(selectedDay.checkInAt, selectedDay.policy?.timezone)}</strong></div>
                <div><span>Giờ ra</span><strong>{timeLabel(selectedDay.checkOutAt, selectedDay.policy?.timezone)}</strong></div>
                <div><span>Thực tế</span><strong>{minutesLabel(selectedDay.actualMinutes)}</strong></div>
                <div><span>Được tính</span><strong>{minutesLabel(selectedDay.countedMinutes)}</strong></div>
                <div><span>Thời gian nghỉ được tính công</span><strong>{minutesLabel(selectedDay.leaveCreditedMinutes)}</strong></div>
                <div><span>Thời gian phải làm</span><strong>{requiredWorkLabel(selectedDay)}</strong></div>
                <div><span>Đi trễ</span><strong>{minutesLabel(selectedDay.lateMinutes)}</strong></div>
                <div><span>Về sớm</span><strong>{minutesLabel(selectedDay.earlyLeaveMinutes)}</strong></div>
              </div>
              <div className={localStyles.dayDetailSection}>
                <strong>Lịch và đơn nghỉ</strong>
                <span>Lịch phải làm: {selectedDay.scheduledWorkDay ? `${timeLabel(selectedDay.expectedStartAt, selectedDay.policy?.timezone)} – ${timeLabel(selectedDay.expectedEndAt, selectedDay.policy?.timezone)}` : 'Không phải làm'}</span>
                <span>Phần được nghỉ: {leaveSegmentLabel(selectedDay)}</span>
                <span>{leaveSummary(selectedDay)}</span>
                {selectedDay.unexcusedAbsenceFraction > 0 ? <span>Vắng không phép: {dayCountLabel(selectedDay.unexcusedAbsenceFraction)} ngày</span> : null}
                {selectedDay.configurationIssue === 'MISSING_POLICY' ? <><span>Nhân sự chưa có Chính sách làm việc hiệu lực tại ngày này.</span><Link className={localStyles.inlineLink} href="/workforce/employees" target="_blank" rel="noreferrer">Mở danh mục nhân sự để áp dụng chính sách</Link></> : null}
                {selectedDay.configurationIssue === 'MISSING_SCHEDULE' ? <span>Cần bổ sung lịch làm việc hoặc ca làm việc.</span> : null}
                {selectedDay.leave.requests.length ? <Link className={localStyles.inlineLink} href="/workforce/leave" target="_blank" rel="noreferrer">Mở đơn nghỉ</Link> : null}
              </div>
              <div className={localStyles.dayDetailSection}>
                <strong>Kiểm soát · Nguồn dữ liệu</strong>
                <span>{sourceSummary(selectedDay)}</span>
                <span>{selectedDay.policy ? `Chính sách: ${selectedDay.policy.code} · ${selectedDay.policy.name} · lần cập nhật ${selectedDay.policy.version}` : 'Chưa có chính sách phù hợp'}</span>
                <span>{selectedDay.adjustment ? (selectedDay.adjustment.status === 'SUBMITTED' ? 'Điều chỉnh: Chờ duyệt' : selectedDay.adjustment.status === 'APPROVED' ? 'Điều chỉnh: Đã duyệt' : 'Điều chỉnh: Từ chối') : 'Chưa có điều chỉnh'}</span>
                {selectedDay.periodLock ? <span>Đã khóa kỳ công</span> : <span>Kỳ công đang mở</span>}
              </div>
              <div className={localStyles.dayDetailSection}>
                <strong>Đánh giá vi phạm</strong>
                <span>{selectedDay.violationEvaluation.explanation}</span>
                {selectedDay.violationEvaluation.items.length ? (
                  <div className={localStyles.violationList}>
                    {selectedDay.violationEvaluation.items.map((item) => (
                      <div className={localStyles.violationItem} key={item.kind}>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {selectedDay.policy ? (
                  <span>
                    Ngưỡng chính sách: trễ {selectedDay.policy.lateGraceMinutes} phút · về sớm {selectedDay.policy.earlyLeaveGraceMinutes} phút.
                  </span>
                ) : null}
                <span>Kết quả này dùng để theo dõi và xử lý theo quy trình Công Ty; Bảng công không tự điều chỉnh thu nhập.</span>
                {selectedDay.violationEvaluation.items.length ? <Link className={localStyles.inlineLink} href="/workforce/violations" target="_blank" rel="noreferrer">Mở xử lý vi phạm</Link> : null}
              </div>
              <div className={localStyles.dayDetailEvents}>
                <strong>Chi tiết sự kiện</strong>
                {selectedDay.events.map((event) => (
                  <div className={localStyles.eventItem} key={event.id}>
                    <div>
                      <strong>{event.event_type === 'CHECK_IN' ? 'Giờ vào' : 'Giờ ra'} · {SOURCE_LABEL[event.source]}</strong>
                      <small>{event.point_name || (event.source === 'MANUAL' ? 'Chấm công trực tiếp' : event.source === 'FACE' ? 'Máy chấm công khuôn mặt' : 'Không ghi nhận nơi chấm công')} · {validationLabel(event.validation_status)}</small>
                      {event.note ? <small>Ghi chú: {event.note}</small> : null}
                    </div>
                    <span>{dateTimeLabel(event.occurred_at, selectedDay.policy?.timezone)}</span>
                  </div>
                ))}
                {!selectedDay.events.length ? <div className={styles.emptyState}>Ngày này chưa có sự kiện chấm công.</div> : null}
              </div>
              <div className={styles.formActions}>
                {data?.capabilities.canManage && (!selectedDay.periodLock || data?.capabilities.canLock) ? (
                  <Link href={'/workforce/adjustments?employeeId=' + encodeURIComponent(selectedDay.employee.id) + '&workDate=' + selectedDay.workDate} target="_blank" rel="noreferrer">Mở lịch sử điều chỉnh</Link>
                ) : !selectedDay.periodLock && data?.capabilities.canSubmitOwn ? (
                  <Link href={'/workforce/adjustments?workDate=' + selectedDay.workDate} target="_blank" rel="noreferrer">Yêu cầu điều chỉnh</Link>
                ) : null}
                <button type="button" className={styles.secondaryButton} onClick={() => setSelectedDay(null)}>Đóng</button>
              </div>
            </div>
          </div>
        ) : null}

        {data ? (
          <div className={localStyles.pagination} aria-label="Phân trang bảng công">
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={busy || !data.pagination.hasPrevious}
              onClick={() => void load(Math.max(0, data.pagination.offset - data.pagination.limit))}
            >
              Trang trước
            </button>
            <span>{rangeStart}–{rangeEnd} / {total}</span>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={busy || !data.pagination.hasNext}
              onClick={() => void load(data.pagination.offset + data.pagination.limit)}
            >
              Trang sau
            </button>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
