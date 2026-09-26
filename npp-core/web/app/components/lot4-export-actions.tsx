'use client';

import type { Customer } from '../../lib/customer-types';
import type { Employee, EmploymentType } from '../../lib/employee-types';
import type { Supplier } from '../../lib/supplier-types';
import type {
  AttendanceDayStatus,
  AttendanceEvent,
  AttendanceTimesheetMonth,
  AttendanceTimesheetResponse,
  AttendanceToday,
  AttendanceViolationHandlingEntry,
  AttendanceViolationHandlingResponse,
  LeaveRequest,
  LeaveRequestListResponse,
  OvertimeListResponse,
  OvertimeRequest,
  SchedulePlanningCatalog,
  WorkSchedule,
} from '../../lib/workforce-types';
import OperationalExportActions, { type OperationalExportSheet } from './operational-export-actions';

type Cell = string | number | boolean | null | undefined;
type Paged = { pagination: { limit: number; offset: number; total: number; hasPrevious: boolean; hasNext: boolean } };
type Envelope<T> = { data?: T; error?: { message?: string } };

function sheet(sheetName: string, headers: readonly string[], rows: readonly (readonly Cell[])[]): OperationalExportSheet {
  return { sheetName, headers, rows };
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message || 'Không tải được dữ liệu để xuất.');
  return payload.data;
}

async function allPages<T extends Paged, R>(
  buildPath: (offset: number) => string,
  selectRows: (data: T) => readonly R[],
): Promise<R[]> {
  const rows: R[] = [];
  let offset = 0;
  for (let page = 0; page < 200; page += 1) {
    const data = await requestJson<T>(buildPath(offset));
    rows.push(...selectRows(data));
    if (!data.pagination.hasNext) return rows;
    const step = data.pagination.limit || selectRows(data).length;
    if (!step) return rows;
    offset += step;
  }
  throw new Error('Danh sách quá lớn để xuất trong một lần.');
}

function dateTime(value: string | null | undefined, timeZone = 'Asia/Ho_Chi_Minh') {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

const EMPLOYMENT_LABELS: Readonly<Record<EmploymentType, string>> = Object.freeze({
  PROBATION: 'Thử việc',
  PERMANENT: 'Chính thức',
  FIXED_TERM: 'Hợp đồng có thời hạn',
  PART_TIME: 'Bán thời gian',
  TEMPORARY: 'Thời vụ',
  OTHER: 'Khác',
});

export function CustomerListExportActions({ customers, disabled = false }: { customers: readonly Customer[]; disabled?: boolean }) {
  return <OperationalExportActions
    filename="danh-sach-khach-hang.xlsx"
    disabled={disabled}
    sheets={[sheet('Khách hàng', ['Mã khách hàng', 'Tên khách hàng', 'Nhóm khách hàng', 'Nhân viên phụ trách', 'Điện thoại', 'Email', 'Mã số thuế', 'Thời hạn thanh toán (ngày)', 'Hạn mức tín dụng', 'Ghi chú', 'Trạng thái'], customers.map((row) => [
      row.code, row.name, row.group_name ?? '', row.responsible_employee_name ?? '', row.phone ?? '', row.email ?? '',
      row.tax_code ?? '', row.payment_terms_days, row.credit_limit, row.notes ?? '', row.is_active ? 'Đang hoạt động' : 'Không hoạt động',
    ]))]}
  />;
}

export function SupplierListExportActions({ suppliers, disabled = false }: { suppliers: readonly Supplier[]; disabled?: boolean }) {
  return <OperationalExportActions
    filename="danh-sach-nha-cung-cap.xlsx"
    disabled={disabled}
    sheets={[sheet('Nhà cung cấp', ['Mã Nhà cung cấp', 'Tên Nhà cung cấp', 'Mã số thuế', 'Ngân hàng', 'Số tài khoản', 'Nhân viên phụ trách mua hàng', 'Thời gian giao trung bình (ngày)', 'Trạng thái'], suppliers.map((row) => [
      row.code, row.name, row.tax_id ?? '', row.bank_name ?? '', row.bank_account ?? '', row.purchase_owner_employee_name ?? '',
      row.avg_delivery_days ?? '', row.is_active ? 'Đang hoạt động' : 'Ngừng sử dụng',
    ]))]}
  />;
}

export function EmployeeListExportActions({ employees, disabled = false }: { employees: readonly Employee[]; disabled?: boolean }) {
  return <OperationalExportActions
    filename="danh-sach-nhan-vien.xlsx"
    disabled={disabled}
    sheets={[sheet('Nhân viên', ['Mã nhân viên', 'Họ và tên', 'Điện thoại', 'Email', 'Chức danh', 'Chi nhánh', 'Phòng/Bộ phận', 'Vị trí công việc', 'Quản lý trực tiếp', 'Loại lao động', 'Trạng thái'], employees.map((row) => [
      row.code,
      row.full_name,
      row.phone ?? '',
      row.email ?? '',
      row.job_title ?? '',
      row.current_assignment?.branch_name ?? '',
      row.current_assignment?.department_name ?? '',
      row.current_assignment?.position_name ?? '',
      row.current_assignment?.manager_name ?? '',
      row.current_employment ? EMPLOYMENT_LABELS[row.current_employment.employment_type] : '',
      row.is_active ? 'Đang làm việc' : 'Đã ngừng làm việc',
    ]))]}
  />;
}

const EVENT_LABELS: Readonly<Record<AttendanceEvent['event_type'], string>> = Object.freeze({
  CHECK_IN: 'Vào làm',
  TEMP_EXIT: 'Ra ngoài',
  RETURN: 'Quay lại nơi làm việc',
  CHECK_OUT: 'Kết thúc làm việc',
});
const MOVEMENT_LABELS: Readonly<Record<NonNullable<AttendanceEvent['movement_reason']>, string>> = Object.freeze({
  WORK_BUSINESS: 'Ra ngoài làm việc',
  PERSONAL: 'Việc cá nhân',
  BREAK: 'Nghỉ giữa ca',
  OTHER: 'Lý do khác',
});
const SOURCE_LABELS: Readonly<Record<AttendanceEvent['source'], string>> = Object.freeze({
  QR: 'Mã QR',
  FACE: 'Nhận diện khuôn mặt',
  MANUAL: 'Chấm công trực tiếp',
  ADJUSTMENT: 'Điều chỉnh công',
  SYSTEM: 'Hệ thống ghi nhận',
});
const VALIDATION_LABELS: Readonly<Record<AttendanceEvent['validation_status'], string>> = Object.freeze({
  VALID: 'Hợp lệ',
  PENDING: 'Chờ xác minh',
  INVALID: 'Không hợp lệ',
});

function attendanceEventRows(employeeCode: string, employeeName: string, branchName: string, events: readonly AttendanceEvent[], timeZone = 'Asia/Ho_Chi_Minh') {
  return events.map((event) => [
    employeeCode,
    employeeName,
    branchName,
    dateTime(event.occurred_at, timeZone),
    EVENT_LABELS[event.event_type],
    event.movement_reason ? MOVEMENT_LABELS[event.movement_reason] : '',
    SOURCE_LABELS[event.source],
    event.point_name ?? event.point_code ?? '',
    VALIDATION_LABELS[event.validation_status],
    event.note ?? '',
  ]);
}

export function AttendanceTodayExportActions({ today, disabled = false }: { today: AttendanceToday | null; disabled?: boolean }) {
  if (!today) return null;
  return <OperationalExportActions
    filename="lich-su-cham-cong-hom-nay.xlsx"
    disabled={disabled}
    sheets={[sheet('Lịch sử chấm công', ['Mã nhân viên', 'Nhân viên', 'Chi nhánh', 'Thời điểm', 'Thao tác', 'Lý do ra ngoài', 'Hình thức ghi nhận', 'Nơi ghi nhận', 'Kết quả xác minh', 'Ghi chú'], attendanceEventRows(
      today.employee.code,
      today.employee.full_name,
      today.employee.branch_name ?? '',
      today.events,
      today.policy.timezone,
    ))]}
  />;
}

const DAY_STATUS_LABELS: Readonly<Partial<Record<AttendanceDayStatus, string>>> = Object.freeze({
  UPCOMING: 'Chưa đến ngày',
  DAY_OFF: 'Nghỉ theo lịch',
  NO_ATTENDANCE_REQUIRED: 'Không yêu cầu chấm công',
  COMPLETE: 'Đủ công',
  LATE: 'Đi trễ',
  EARLY: 'Về sớm',
  LATE_AND_EARLY: 'Đi trễ và về sớm',
  APPROVED_LEAVE: 'Nghỉ đã duyệt',
  PENDING_LEAVE: 'Nghỉ chờ duyệt',
  PENDING_ADJUSTMENT: 'Điều chỉnh chờ xử lý',
  UNEXCUSED_ABSENCE: 'Vắng không phép',
  WORKING: 'Đang làm việc',
  OUTSIDE: 'Đang ra ngoài',
  NOT_STARTED: 'Chưa bắt đầu',
  MISSING_POLICY: 'Thiếu chính sách làm việc',
  MISSING_SCHEDULE: 'Thiếu lịch làm việc',
  MISSING_CHECK_IN: 'Thiếu giờ vào',
  MISSING_CHECK_OUT: 'Thiếu giờ ra',
  INCOMPLETE: 'Chưa đủ công',
});

function dayStatus(value: AttendanceDayStatus) {
  return DAY_STATUS_LABELS[value] ?? 'Cần kiểm tra';
}

function timesheetSummaryRows(rows: readonly AttendanceTimesheetMonth[]) {
  return rows.map((row) => [
    row.employee.code, row.employee.name, row.employee.branchName ?? '',
    row.workDays, row.completedDays, row.scheduledDaysOff, row.approvedLeaveDays, row.pendingLeaveDays,
    row.unexcusedAbsenceDays, row.incompleteDays, row.violationDays, row.countedMinutes, row.actualMinutes,
    row.leaveCreditedMinutes, row.lateMinutes, row.earlyLeaveMinutes, row.adjustedDays, row.pendingAdjustmentDays,
  ]);
}

function timesheetDayRows(rows: readonly AttendanceTimesheetMonth[]) {
  return rows.flatMap((row) => row.days.map((day) => [
    day.workDate,
    row.employee.code,
    row.employee.name,
    row.employee.branchName ?? '',
    dayStatus(day.status),
    dateTime(day.checkInAt, day.policy?.timezone),
    dateTime(day.checkOutAt, day.policy?.timezone),
    day.actualMinutes,
    day.countedMinutes,
    day.lateMinutes,
    day.earlyLeaveMinutes,
    day.leave.approvedFraction,
    day.leave.pendingFraction,
    day.unexcusedAbsenceFraction,
    day.violationEvaluation?.state === 'HAS_VIOLATIONS'
      ? day.violationEvaluation.items.map((item) => item.label).join(' · ')
      : '',
  ]));
}

function timesheetEventRows(rows: readonly AttendanceTimesheetMonth[]) {
  return rows.flatMap((row) => row.days.flatMap((day) => attendanceEventRows(
    row.employee.code,
    row.employee.name,
    row.employee.branchName ?? '',
    day.events,
    day.policy?.timezone,
  )));
}

export function TimesheetExportActions({
  from, to, view, employeeQuery, branchId, disabled = false,
}: {
  from: string; to: string; view: 'daily' | 'monthly'; employeeQuery: string; branchId: string; disabled?: boolean;
}) {
  return <OperationalExportActions
    filename={view === 'monthly' ? 'bang-cong-thang.xlsx' : 'bang-cong-theo-ngay.xlsx'}
    disabled={disabled}
    loadSheets={async () => {
      const limit = view === 'monthly' ? 20 : 100;
      const rows = await allPages<AttendanceTimesheetResponse, AttendanceTimesheetMonth>((offset) => {
        const params = new URLSearchParams({
          view: view === 'daily' ? 'employee' : 'monthly',
          from, to, limit: String(limit), offset: String(offset),
        });
        if (employeeQuery.trim()) params.set('employeeQuery', employeeQuery.trim());
        if (branchId) params.set('branchId', branchId);
        return `/api/workforce/timesheet?${params.toString()}`;
      }, (data) => data.rows as AttendanceTimesheetMonth[]);
      return [
        sheet('Tổng hợp nhân sự', ['Mã nhân viên', 'Nhân viên', 'Chi nhánh', 'Ngày phải làm', 'Ngày đủ công', 'Nghỉ theo lịch', 'Nghỉ đã duyệt', 'Nghỉ chờ duyệt', 'Vắng không phép', 'Ngày chưa đủ công', 'Ngày có vi phạm', 'Phút được tính', 'Phút thực tế', 'Phút nghỉ được tính', 'Đi trễ (phút)', 'Về sớm (phút)', 'Ngày đã điều chỉnh', 'Ngày chờ điều chỉnh'], timesheetSummaryRows(rows)),
        sheet('Bảng công từng ngày', ['Ngày', 'Mã nhân viên', 'Nhân viên', 'Chi nhánh', 'Trạng thái', 'Giờ vào', 'Giờ ra', 'Phút thực tế', 'Phút được tính', 'Đi trễ (phút)', 'Về sớm (phút)', 'Nghỉ đã duyệt', 'Nghỉ chờ duyệt', 'Vắng không phép', 'Vi phạm'], timesheetDayRows(rows)),
        sheet('Lịch sử chấm công', ['Mã nhân viên', 'Nhân viên', 'Chi nhánh', 'Thời điểm', 'Thao tác', 'Lý do ra ngoài', 'Hình thức ghi nhận', 'Nơi ghi nhận', 'Kết quả xác minh', 'Ghi chú'], timesheetEventRows(rows)),
      ];
    }}
  />;
}

const LEAVE_STATUS: Readonly<Record<LeaveRequest['status'], string>> = Object.freeze({
  SUBMITTED: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối', CANCELLED: 'Đã hủy',
});
const LEAVE_PART: Readonly<Record<LeaveRequest['day_part'], string>> = Object.freeze({
  FULL_DAY: 'Cả ngày', FIRST_HALF: 'Nửa ca đầu', SECOND_HALF: 'Nửa ca sau',
});

export function LeaveExportActions({
  from, to, status, employeeQuery, branchId, disabled = false,
}: {
  from: string; to: string; status: string; employeeQuery: string; branchId: string; disabled?: boolean;
}) {
  return <OperationalExportActions
    filename="danh-sach-nghi-phep.xlsx"
    disabled={disabled}
    loadSheets={async () => {
      const rows = await allPages<LeaveRequestListResponse, LeaveRequest>((offset) => {
        const params = new URLSearchParams({ from, to, limit: '100', offset: String(offset) });
        if (status) params.set('status', status);
        if (employeeQuery.trim()) params.set('employeeQuery', employeeQuery.trim());
        if (branchId) params.set('branchId', branchId);
        return `/api/workforce/leave/requests?${params.toString()}`;
      }, (data) => data.requests);
      return [sheet('Nghỉ phép', ['Mã nhân viên', 'Nhân viên', 'Chi nhánh', 'Chế độ nghỉ', 'Từ ngày', 'Đến ngày', 'Phần ngày', 'Hưởng lương', 'Tính ngày công', 'Trạng thái', 'Lý do', 'Nguồn ghi nhận', 'Người duyệt phiếu giấy', 'Ý kiến xử lý', 'Lý do hủy'], rows.map((row) => [
        row.employee_code ?? '', row.employee_name ?? '', row.branch_name ?? '', row.leave_type_name_snapshot,
        row.date_from, row.date_to, LEAVE_PART[row.day_part], row.leave_is_paid_snapshot ? 'Có' : 'Không',
        row.leave_counts_as_workday_snapshot ? 'Có' : 'Không', LEAVE_STATUS[row.status], row.reason,
        row.request_source === 'MANUAL_PAPER' ? 'Phiếu giấy / nhập thủ công' : 'Phiếu điện tử',
        row.manual_approver_name ?? '', row.review_reason ?? '', row.cancel_reason ?? '',
      ]))];
    }}
  />;
}

const OVERTIME_STATUS: Readonly<Record<OvertimeRequest['status'], string>> = Object.freeze({
  SUBMITTED: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối',
  ACTUAL_RECORDED: 'Đã ghi nhận thực tế', CONFIRMED: 'Đã xác nhận giờ tính',
});

export function OvertimeExportActions({
  from, to, status, branchId, disabled = false,
}: {
  from: string; to: string; status: string; branchId: string; disabled?: boolean;
}) {
  return <OperationalExportActions
    filename="danh-sach-tang-ca.xlsx"
    disabled={disabled}
    loadSheets={async () => {
      const rows = await allPages<OvertimeListResponse, OvertimeRequest>((offset) => {
        const params = new URLSearchParams({ from, to, limit: '100', offset: String(offset) });
        if (status) params.set('status', status);
        if (branchId) params.set('branchId', branchId);
        return `/api/workforce/overtime?${params.toString()}`;
      }, (data) => data.requests);
      return [sheet('Tăng ca', ['Ngày', 'Mã nhân viên', 'Nhân viên', 'Chi nhánh', 'Phút đăng ký', 'Phút thực tế', 'Phút được tính', 'Trạng thái', 'Lý do đăng ký', 'Ý kiến duyệt', 'Ghi chú thực tế', 'Ghi chú xác nhận'], rows.map((row) => [
        row.work_date, row.employee_code ?? '', row.employee_name ?? '', row.branch_name ?? '', row.requested_minutes,
        row.actual_minutes ?? '', row.confirmed_minutes ?? '', OVERTIME_STATUS[row.status], row.reason,
        row.review_reason ?? '', row.actual_note ?? '', row.confirm_note ?? '',
      ]))];
    }}
  />;
}

const CASE_STATUS = Object.freeze({
  EXPLANATION_SUBMITTED: 'Đã gửi giải trình',
  UNDER_REVIEW: 'Đang xem xét',
  RESOLVED: 'Đã kết luận',
});
const OUTCOME = Object.freeze({ CONFIRMED: 'Xác nhận vi phạm', EXCUSED: 'Chấp nhận giải trình' });

export function ViolationExportActions({
  from, to, employeeQuery, branchId, disabled = false,
}: {
  from: string; to: string; employeeQuery: string; branchId: string; disabled?: boolean;
}) {
  return <OperationalExportActions
    filename="xu-ly-vi-pham-cham-cong.xlsx"
    disabled={disabled}
    loadSheets={async () => {
      const rows = await allPages<AttendanceViolationHandlingResponse, AttendanceViolationHandlingEntry>((offset) => {
        const params = new URLSearchParams({ from, to, limit: '100', offset: String(offset) });
        if (employeeQuery.trim()) params.set('employeeQuery', employeeQuery.trim());
        if (branchId) params.set('branchId', branchId);
        return `/api/workforce/violations?${params.toString()}`;
      }, (data) => data.entries);
      return [sheet('Vi phạm chấm công', ['Ngày', 'Mã nhân viên', 'Nhân viên', 'Chi nhánh', 'Vi phạm', 'Chi tiết', 'Số phút', 'Trạng thái xử lý', 'Giải trình', 'Kết luận', 'Ghi chú xử lý'], rows.map((row) => [
        row.workDate, row.employee.code, row.employee.name, row.employee.branchName ?? '',
        row.violation?.label ?? row.case?.violation_label_snapshot ?? '',
        row.violation?.detail ?? row.case?.violation_detail_snapshot ?? '',
        row.violation?.minutes ?? row.case?.violation_minutes_snapshot ?? '',
        row.case ? CASE_STATUS[row.case.status] : 'Chưa có giải trình',
        row.case?.explanation ?? '',
        row.case?.outcome ? OUTCOME[row.case.outcome] : '',
        row.case?.review_note ?? '',
      ]))];
    }}
  />;
}

function scheduleKind(value: WorkSchedule['schedule_kind']) {
  return value === 'WORK' ? 'Ngày làm việc' : 'Ngày nghỉ';
}
function scheduleSource(value: WorkSchedule['source']) {
  return value === 'POLICY' ? 'Theo chính sách' : 'Điều chỉnh';
}
const WEEKDAY: Readonly<Record<number, string>> = Object.freeze({
  0: 'Chủ nhật', 1: 'Thứ Hai', 2: 'Thứ Ba', 3: 'Thứ Tư', 4: 'Thứ Năm', 5: 'Thứ Sáu', 6: 'Thứ Bảy',
});

export function ScheduleExportActions({
  from, to, employeeId, disabled = false,
}: {
  from: string; to: string; employeeId: string; disabled?: boolean;
}) {
  return <OperationalExportActions
    filename="ca-va-lich-lam-viec.xlsx"
    disabled={disabled}
    loadSheets={async () => {
      const params = new URLSearchParams({ from, to });
      if (employeeId) params.set('employeeId', employeeId);
      const [schedules, catalog] = await Promise.all([
        requestJson<WorkSchedule[]>(`/api/workforce/schedules?${params.toString()}`),
        requestJson<SchedulePlanningCatalog>('/api/workforce/schedule-planning'),
      ]);
      return [
        sheet('Lịch làm việc', ['Ngày', 'Mã nhân viên', 'Nhân viên', 'Loại ngày', 'Bắt đầu', 'Kết thúc', 'Nguồn lịch', 'Chính sách', 'Lý do điều chỉnh'], schedules.map((row) => [
          row.work_date, row.employee_code, row.employee_name, scheduleKind(row.schedule_kind),
          dateTime(row.scheduled_start_at, row.policy_timezone ?? 'Asia/Ho_Chi_Minh'),
          dateTime(row.scheduled_end_at, row.policy_timezone ?? 'Asia/Ho_Chi_Minh'),
          scheduleSource(row.source), row.policy_name ?? row.policy_code ?? '', row.override_reason ?? '',
        ])),
        sheet('Ca mẫu', ['Mã ca', 'Tên ca', 'Giờ bắt đầu', 'Giờ kết thúc', 'Nghỉ giữa ca (phút)', 'Trạng thái'], catalog.shiftTemplates.map((row) => [
          row.code, row.name, row.start_time, row.end_time, row.break_minutes, row.is_active ? 'Đang áp dụng' : 'Ngừng áp dụng',
        ])),
        sheet('Lịch tuần', ['Mã lịch tuần', 'Tên lịch tuần', 'Ngày', 'Loại ngày', 'Ca làm việc', 'Giờ bắt đầu', 'Giờ kết thúc', 'Nghỉ giữa ca (phút)', 'Trạng thái'], catalog.weekTemplates.flatMap((week) => week.days.map((day) => [
          week.code, week.name, WEEKDAY[day.weekday] ?? 'Ngày khác', day.schedule_kind === 'WORK' ? 'Ngày làm việc' : 'Ngày nghỉ',
          day.shift_name ?? '', day.shift_start_time ?? '', day.shift_end_time ?? '', day.shift_break_minutes ?? '',
          week.is_active ? 'Đang áp dụng' : 'Ngừng áp dụng',
        ]))),
      ];
    }}
  />;
}
