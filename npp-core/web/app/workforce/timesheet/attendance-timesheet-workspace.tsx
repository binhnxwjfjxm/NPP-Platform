'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
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

const STATUS_LABEL: Record<AttendanceDayStatus, string> = {
  UPCOMING: 'Sắp tới',
  DAY_OFF: 'Ngày nghỉ',
  NO_ATTENDANCE_REQUIRED: 'Không yêu cầu chấm công',
  MISSING_POLICY: 'Thiếu chính sách làm việc',
  MISSING_SCHEDULE: 'Thiếu lịch làm việc',
  NOT_STARTED: 'Chưa chấm công',
  WORKING: 'Đang làm việc',
  MISSING_CHECK_IN: 'Thiếu giờ vào',
  MISSING_CHECK_OUT: 'Thiếu giờ ra',
  INCOMPLETE: 'Chấm công chưa đầy đủ',
  LATE_AND_EARLY: 'Đi trễ và về sớm',
  LATE: 'Đi trễ',
  EARLY: 'Về sớm',
  COMPLETE: 'Đủ giờ vào / ra',
};

const SOURCE_LABEL: Record<AttendanceEvent['source'], string> = {
  QR: 'QR',
  MANUAL: 'Nhập tay',
  ADJUSTMENT: 'Điều chỉnh',
  SYSTEM: 'Hệ thống',
};

function dateLabel(value: string) {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
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
  if (day.missingCheckIn) values.push('Thiếu giờ vào');
  if (day.missingCheckOut) values.push('Thiếu giờ ra');
  return values.length ? values.join(' · ') : 'Đủ';
}

function sourceSummary(day: AttendanceTimesheetDay) {
  const values = day.attendanceSources.map((source) => SOURCE_LABEL[source]);
  if (day.scheduleSource === 'OVERRIDE') values.push('Lịch điều chỉnh');
  else if (day.scheduleSource === 'POLICY') values.push('Lịch chính sách');
  return [...new Set(values)].join(' · ') || 'Chưa có sự kiện';
}

function monthSourceSummary(row: AttendanceTimesheetMonth) {
  const values = row.attendanceSources.map((source) => SOURCE_LABEL[source]);
  if (row.scheduleSources.includes('OVERRIDE')) values.push('Lịch điều chỉnh');
  if (row.scheduleSources.includes('POLICY')) values.push('Lịch chính sách');
  return [...new Set(values)].join(' · ') || 'Chưa có sự kiện';
}

function validationLabel(value: AttendanceEvent['validation_status']) {
  if (value === 'VALID') return 'Hợp lệ';
  if (value === 'PENDING') return 'Chờ kiểm tra';
  return 'Không hợp lệ';
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
  const [view, setView] = useState<'daily' | 'monthly'>(initialData?.view ?? 'daily');
  const [from, setFrom] = useState(initialData?.period.from ?? initialFrom);
  const [to, setTo] = useState(initialData?.period.to ?? initialTo);
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const dailyRows = useMemo(
    () => data?.view === 'daily' ? data.rows as AttendanceTimesheetDay[] : [],
    [data],
  );
  const monthlyRows = useMemo(
    () => data?.view === 'monthly' ? data.rows as AttendanceTimesheetMonth[] : [],
    [data],
  );

  async function load(nextOffset = 0, nextView = view) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        view: nextView,
        from,
        to,
        limit: nextView === 'monthly' ? '20' : '50',
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
    setView(nextView);
    void load(0, nextView);
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

  const rowCount = data?.view === 'daily' ? dailyRows.length : monthlyRows.length;
  const total = data?.pagination.total ?? 0;
  const rangeStart = total && data ? data.pagination.offset + 1 : 0;
  const rangeEnd = data ? Math.min(data.pagination.offset + rowCount, total) : 0;

  return (
    <AppShell
      title="Bảng công"
      subtitle="Theo dõi giờ vào, giờ ra và tình trạng chấm công theo lịch làm việc trong phạm vi được cấp."
      kicker="Nhân sự"
      actions={actions}
    >
      <section className={styles.page} data-testid="attendance-timesheet-page">
        {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="status">{error}</div> : null}

        <section className={styles.summaryGrid}>
          <article className={styles.summaryCard}>
            <span>Kỳ đang xem</span>
            <strong>{dateLabel(from)} – {dateLabel(to)}</strong>
            <small>Tối đa 93 ngày mỗi lần xem</small>
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
            <small>Dữ liệu ngoài phạm vi được cấp không được hiển thị</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Số dòng</span>
            <strong>{total}</strong>
            <small>{view === 'daily' ? 'Theo ngày công' : 'Theo nhân sự trong kỳ'}</small>
          </article>
        </section>

        <section className={styles.toolbar}>
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

          <div className={styles.toolbarFilter}>
            <label htmlFor="timesheet-from">Từ ngày</label>
            <input id="timesheet-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="timesheet-to">Đến ngày</label>
            <input id="timesheet-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>

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

        <div className={styles.banner} role="note">
          Thời gian được tính là thời gian chấm công hợp lệ nằm trong khung làm việc, sau khi trừ thời gian nghỉ theo chính sách.
          Đây là dữ liệu theo dõi công, chưa phải dữ liệu tính lương.
        </div>

        {data?.view === 'daily' ? (
          <section className={styles.tableSection}>
            <div className={styles.sectionHeader}>
              <div><p className={styles.panelKicker}>Theo ngày</p><h2>Chi tiết ngày công</h2></div>
              <span className={styles.panelChip}>{total} dòng</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table} data-testid="attendance-timesheet-daily-table">
                <thead>
                  <tr>
                    <th>Ngày</th><th>Nhân sự</th><th>Chi nhánh</th><th>Trạng thái</th>
                    <th>Giờ vào</th><th>Giờ ra</th><th>Thực tế</th><th>Được tính</th>
                    <th>Đi trễ</th><th>Về sớm</th><th>Thiếu chấm công</th><th>Nguồn dữ liệu</th><th>Kiểm soát</th><th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRows.map((day) => (
                    <tr key={`${day.employee.id}-${day.workDate}`}>
                      <td>{dateLabel(day.workDate)}</td>
                      <td><strong>{day.employee.code} · {day.employee.name}</strong></td>
                      <td>{day.employee.branchName || 'Chưa gán chi nhánh'}</td>
                      <td>{STATUS_LABEL[day.status]}</td>
                      <td>{timeLabel(day.checkInAt, day.policy?.timezone)}</td>
                      <td>{timeLabel(day.checkOutAt, day.policy?.timezone)}</td>
                      <td>{minutesLabel(day.actualMinutes)}</td>
                      <td>{minutesLabel(day.countedMinutes)}</td>
                      <td>{minutesLabel(day.lateMinutes)}</td>
                      <td>{minutesLabel(day.earlyLeaveMinutes)}</td>
                      <td>{missingLabel(day)}</td>
                      <td>{sourceSummary(day)}</td>
                      <td>
                        <div className={localStyles.detailMeta}>
                          {day.periodLock ? <strong>Đã khóa kỳ</strong> : <span>Kỳ đang mở</span>}
                          {day.adjustment ? <span>{day.adjustment.status === 'SUBMITTED' ? 'Điều chỉnh: Chờ duyệt' : day.adjustment.status === 'APPROVED' ? 'Điều chỉnh: Đã duyệt' : 'Điều chỉnh: Từ chối'}</span> : <span>Chưa có điều chỉnh</span>}
                          {data?.capabilities.canManage && (!day.periodLock || data?.capabilities.canLock) ? (
                            <Link href={'/workforce/adjustments?employeeId=' + encodeURIComponent(day.employee.id) + '&workDate=' + day.workDate}>Điều chỉnh</Link>
                          ) : !day.periodLock && data?.capabilities.canSubmitOwn ? (
                            <Link href={'/workforce/adjustments?workDate=' + day.workDate}>Yêu cầu điều chỉnh</Link>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <details className={localStyles.details}>
                          <summary>Chi tiết sự kiện ({day.events.length})</summary>
                          <div className={localStyles.detailBody}>
                            <div className={localStyles.detailMeta}>
                              <span>Dự kiến vào: <strong>{timeLabel(day.expectedStartAt, day.policy?.timezone)}</strong></span>
                              <span>Dự kiến ra: <strong>{timeLabel(day.expectedEndAt, day.policy?.timezone)}</strong></span>
                              <span>Chính sách: <strong>{day.policy ? `${day.policy.code} · ${day.policy.name} · bản ${day.policy.version}` : 'Chưa có'}</strong></span>
                            </div>
                            {day.events.map((event) => (
                              <div className={localStyles.eventItem} key={event.id}>
                                <div>
                                  <strong>{event.event_type === 'CHECK_IN' ? 'Giờ vào' : 'Giờ ra'} · {SOURCE_LABEL[event.source]}</strong>
                                  <small>{event.point_name || 'Không có điểm chấm công'} · {validationLabel(event.validation_status)}</small>
                                  {event.note ? <small>Ghi chú: {event.note}</small> : null}
                                </div>
                                <span>{dateTimeLabel(event.occurred_at, day.policy?.timezone)}</span>
                              </div>
                            ))}
                            {!day.events.length ? <div className={styles.emptyState}>Ngày này chưa có sự kiện chấm công.</div> : null}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                  {!dailyRows.length ? (
                    <tr><td colSpan={14}><div className={styles.emptyState}>Không có dữ liệu bảng công trong kỳ đã chọn.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className={styles.tableSection}>
            <div className={styles.sectionHeader}>
              <div><p className={styles.panelKicker}>Theo tháng</p><h2>Tổng hợp theo nhân sự</h2></div>
              <span className={styles.panelChip}>{total} nhân sự</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table} data-testid="attendance-timesheet-monthly-table">
                <thead>
                  <tr>
                    <th>Nhân sự</th><th>Chi nhánh</th><th>Kỳ</th><th>Ngày làm việc</th><th>Hoàn tất</th>
                    <th>Ngày thiếu</th><th>Thực tế</th><th>Được tính</th><th>Đi trễ</th><th>Về sớm</th>
                    <th>Điều chỉnh</th><th>Ngày khóa</th><th>Nguồn dữ liệu</th><th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map((row) => (
                    <tr key={row.employee.id}>
                      <td><strong>{row.employee.code} · {row.employee.name}</strong></td>
                      <td>{row.employee.branchName || 'Chưa gán chi nhánh'}</td>
                      <td>{dateLabel(row.period.from)} – {dateLabel(row.period.to)}</td>
                      <td>{row.workDays}</td>
                      <td>{row.completedDays}</td>
                      <td>{row.missingDays}</td>
                      <td>{minutesLabel(row.actualMinutes)}</td>
                      <td>{minutesLabel(row.countedMinutes)}</td>
                      <td>{minutesLabel(row.lateMinutes)}</td>
                      <td>{minutesLabel(row.earlyLeaveMinutes)}</td>
                      <td>{row.adjustedDays} đã duyệt{row.pendingAdjustmentDays ? ` · ${row.pendingAdjustmentDays} chờ duyệt` : ''}</td>
                      <td>{row.lockedDays}</td>
                      <td>{monthSourceSummary(row)}</td>
                      <td>
                        <details className={localStyles.details}>
                          <summary>Xem từng ngày</summary>
                          <div className={localStyles.dayList}>
                            {row.days.map((day) => (
                              <div className={localStyles.dayItem} key={day.workDate}>
                                <strong>{dateLabel(day.workDate)} · {STATUS_LABEL[day.status]}</strong>
                                <span>
                                  Vào {timeLabel(day.checkInAt, day.policy?.timezone)} · Ra {timeLabel(day.checkOutAt, day.policy?.timezone)}
                                  {' · '}Được tính {minutesLabel(day.countedMinutes)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                  {!monthlyRows.length ? (
                    <tr><td colSpan={14}><div className={styles.emptyState}>Không có nhân sự trong phạm vi và kỳ đã chọn.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        )}

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
