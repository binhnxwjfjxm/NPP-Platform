export type WorkPolicy = {
  id: string;
  installation_id: string;
  code: string;
  version: number;
  name: string;
  work_nature: string | null;
  time_mode: 'FIXED' | 'SHIFT' | 'FLEXIBLE' | 'NO_ATTENDANCE';
  fixed_start_time: string | null;
  fixed_end_time: string | null;
  working_days: number[];
  break_minutes: number;
  late_grace_minutes: number;
  early_leave_grace_minutes: number;
  overtime_enabled: boolean;
  overtime_requires_approval: boolean;
  attendance_method: 'QR' | 'MANUAL' | 'BOTH' | 'NONE';
  attendance_basis: 'TIME' | 'PRESENCE' | 'NONE';
  timezone: string;
  rounding_minutes: number;
  minimum_full_day_minutes: number | null;
  minimum_half_day_minutes: number | null;
  effective_from: string;
  effective_to: string | null;
  supersedes_policy_id: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string;
};

export type EmployeeWorkPolicyAssignment = {
  id: string;
  installation_id: string;
  employee_id: string;
  work_policy_id: string;
  effective_from: string;
  effective_to: string | null;
  reason: string | null;
  created_at: string;
  created_by: string;
  policy_code: string;
  policy_version: number;
  policy_name: string;
  policy_time_mode: WorkPolicy['time_mode'];
  policy_attendance_method: WorkPolicy['attendance_method'];
  policy_attendance_basis: WorkPolicy['attendance_basis'];
  policy_timezone: string;
};

export type WorkPolicyCoverageEmployee = {
  id: string;
  code: string;
  name: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  assignment: {
    id: string;
    workPolicyId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    policyCode: string;
    policyVersion: number;
    policyName: string;
  } | null;
};

export type WorkPolicyCoverage = {
  asOfDate: string;
  totalActive: number;
  assignedCount: number;
  missingCount: number;
  employees: WorkPolicyCoverageEmployee[];
};

export type BulkPolicyAssignmentResult = {
  affectedCount: number;
  bootstrap: boolean;
  targetMode: 'ALL_ACTIVE' | 'BRANCH' | 'EMPLOYEES';
  workPolicyId: string;
  effectiveFrom: string;
};

export type WorkSchedule = {
  id: string;
  installation_id: string;
  employee_id: string;
  work_policy_id: string | null;
  work_date: string;
  schedule_kind: 'WORK' | 'OFF';
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  source: 'POLICY' | 'OVERRIDE';
  override_reason: string | null;
  shift_template_id: string | null;
  week_template_id: string | null;
  company_calendar_day_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  employee_code: string;
  employee_name: string;
  employee_branch_id: string | null;
  policy_code: string | null;
  policy_version: number | null;
  policy_name: string | null;
  policy_timezone: string | null;
};



export type WorkShiftTemplate = {
  id: string;
  installation_id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type WorkWeekTemplateDay = {
  id: string;
  installation_id: string;
  week_template_id: string;
  weekday: number;
  schedule_kind: 'WORK' | 'OFF';
  shift_template_id: string | null;
  shift_code: string | null;
  shift_name: string | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  shift_break_minutes: number | null;
};

export type WorkWeekTemplate = {
  id: string;
  installation_id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  days: WorkWeekTemplateDay[];
};

export type CompanyCalendarDay = {
  id: string;
  installation_id: string;
  calendar_date: string;
  calendar_kind: 'PUBLIC_HOLIDAY' | 'COMPANY_DAY_OFF';
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type SchedulePlanningCatalog = {
  shiftTemplates: WorkShiftTemplate[];
  weekTemplates: WorkWeekTemplate[];
  calendarDays: CompanyCalendarDay[];
};

export type ScheduleBulkResult = {
  requestedCount: number;
  affectedCount: number;
  skippedOverrides: number;
  employeeCount: number;
  fromDate?: string;
  toDate?: string;
  sourceFrom?: string;
  sourceTo?: string;
  targetFrom?: string;
  targetTo?: string;
};

export type AttendancePoint = {
  id: string;
  installation_id: string;
  code: string;
  name: string;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  branch_code: string | null;
  branch_name: string | null;
};

export type AttendanceBranch = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type AttendanceEvent = {
  id: string;
  installation_id: string;
  employee_id: string;
  schedule_id: string | null;
  work_policy_id: string | null;
  attendance_point_id: string | null;
  event_type: 'CHECK_IN' | 'TEMP_EXIT' | 'RETURN' | 'CHECK_OUT';
  movement_reason: 'WORK_BUSINESS' | 'PERSONAL' | 'BREAK' | 'OTHER' | null;
  occurred_at: string;
  source: 'QR' | 'MANUAL' | 'ADJUSTMENT' | 'SYSTEM';
  validation_status: 'VALID' | 'PENDING' | 'INVALID';
  source_reference: string | null;
  note: string | null;
  recorded_by: string;
  request_id: string;
  created_at: string;
  point_code?: string | null;
  point_name?: string | null;
};

export type AttendanceToday = {
  workDate: string;
  status: 'NOT_STARTED' | 'WORKING' | 'OUTSIDE' | 'COMPLETE';
  nextAction: 'CHECK_IN' | 'EXIT' | 'RETURN' | null;
  tooSoon: boolean;
  employee: {
    id: string;
    code: string;
    full_name: string;
    branch_id: string | null;
    branch_code?: string | null;
    branch_name?: string | null;
    is_active: boolean;
  };
  policy: {
    id: string;
    code: string;
    version: number;
    name: string;
    timeMode: WorkPolicy['time_mode'];
    attendanceMethod: WorkPolicy['attendance_method'];
    attendanceBasis: WorkPolicy['attendance_basis'];
    timezone: string;
  };
  schedule: {
    id: string;
    kind: 'WORK' | 'OFF';
    source: 'POLICY' | 'OVERRIDE';
  } | null;
  expectedStartAt: string | null;
  expectedEndAt: string | null;
  events: AttendanceEvent[];
};

export type AttendancePointManagement = {
  points: AttendancePoint[];
  branches: AttendanceBranch[];
  companyScope: boolean;
};

export type AttendanceQrToken = {
  id: string;
  attendancePointId: string;
  pointCode: string;
  pointName: string;
  branchName: string | null;
  qrPayload: string;
  expiresAt: string;
  createdAt: string;
};

export type AttendanceRecordResult = {
  event: AttendanceEvent;
  workDate: string;
  point: {
    id: string;
    code: string;
    name: string;
    branchId: string | null;
    branchName: string | null;
  } | null;
};

export type AttendanceAdjustmentStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export type AttendanceAdjustmentRequest = {
  id: string;
  installation_id: string;
  employee_id: string;
  work_date: string;
  requested_check_in_at: string | null;
  requested_check_out_at: string | null;
  reason: string;
  request_source: 'SELF_REQUEST' | 'DIRECT';
  status: AttendanceAdjustmentStatus;
  requested_by_actor_id: string;
  requested_by_employee_id: string | null;
  reviewed_by_actor_id: string | null;
  review_reason: string | null;
  reviewed_at: string | null;
  version: number;
  request_id: string;
  created_at: string;
  updated_at: string;
  employee_code?: string;
  employee_name?: string;
  employee_branch_id?: string | null;
  branch_code?: string | null;
  branch_name?: string | null;
};

export type AttendancePeriodLock = {
  id: string;
  installation_id: string;
  branch_id: string | null;
  period_start: string;
  period_end: string;
  reason: string;
  locked_by_actor_id: string;
  request_id: string;
  locked_at: string;
  branch_code?: string | null;
  branch_name?: string | null;
};

export type AttendanceAdjustmentListResponse = {
  period: { from: string; to: string };
  selectedEmployee: {
    id: string;
    code: string;
    name: string;
    branchId: string | null;
  } | null;
  branches: AttendanceBranch[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  requests: AttendanceAdjustmentRequest[];
  capabilities: {
    selfOnly: boolean;
    canSubmitOwn: boolean;
    canManage: boolean;
    canLock: boolean;
  };
};

export type AttendancePeriodLockListResponse = {
  locks: AttendancePeriodLock[];
  branches: AttendanceBranch[];
  companyScope: boolean;
  canLock: boolean;
};

export type AttendanceAdjustmentMutationResult = {
  request: AttendanceAdjustmentRequest;
  events: AttendanceEvent[];
};

export type AttendanceViolationKind = 'LATE' | 'EARLY_LEAVE' | 'MISSING_ATTENDANCE' | 'UNEXCUSED_ABSENCE';
export type AttendanceViolationEvaluationState =
  | 'NOT_DUE'
  | 'NOT_APPLICABLE'
  | 'CONFIGURATION_ERROR'
  | 'PENDING_LEAVE'
  | 'PENDING_ADJUSTMENT'
  | 'CLEAR'
  | 'HAS_VIOLATIONS';

export type AttendanceViolation = {
  kind: AttendanceViolationKind;
  label: string;
  detail: string;
  minutes: number | null;
  dayFraction: number | null;
};

export type AttendanceViolationEvaluation = {
  state: AttendanceViolationEvaluationState;
  explanation: string;
  items: AttendanceViolation[];
};

export type AttendanceViolationCaseStatus = 'EXPLANATION_SUBMITTED' | 'UNDER_REVIEW' | 'RESOLVED';
export type AttendanceViolationOutcome = 'CONFIRMED' | 'EXCUSED';

export type AttendanceViolationCase = {
  id: string;
  installation_id: string;
  employee_id: string;
  work_date: string;
  violation_kind: AttendanceViolationKind;
  violation_label_snapshot: string;
  violation_detail_snapshot: string;
  violation_minutes_snapshot: number | null;
  violation_day_fraction_snapshot: number | string | null;
  policy_id_snapshot: string | null;
  policy_version_snapshot: number | null;
  status: AttendanceViolationCaseStatus;
  explanation: string;
  explained_by_actor_id: string;
  explained_at: string;
  reviewed_by_actor_id: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  outcome: AttendanceViolationOutcome | null;
  version: number;
  request_id: string;
  created_at: string;
  updated_at: string;
  employee_code?: string;
  employee_name?: string;
  employee_branch_id?: string | null;
  branch_code?: string | null;
  branch_name?: string | null;
};

export type AttendanceViolationHandlingEntry = {
  employee: AttendanceTimesheetDay['employee'];
  workDate: string;
  violation: AttendanceViolation | null;
  evaluationState: AttendanceViolationEvaluationState;
  case: AttendanceViolationCase | null;
};

export type AttendanceViolationHandlingResponse = {
  period: { from: string; to: string; timezone: string };
  scope: {
    companyScope: boolean;
    selfOnly: boolean;
    branches: AttendanceBranch[];
  };
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  entries: AttendanceViolationHandlingEntry[];
  capabilities: {
    selfOnly: boolean;
    canExplain: boolean;
    canReview: boolean;
  };
};

export type AttendanceDayStatus =
  | 'UPCOMING'
  | 'DAY_OFF'
  | 'NO_ATTENDANCE_REQUIRED'
  | 'MISSING_POLICY'
  | 'MISSING_SCHEDULE'
  | 'NOT_STARTED'
  | 'WORKING'
  | 'OUTSIDE'
  | 'MISSING_CHECK_IN'
  | 'MISSING_CHECK_OUT'
  | 'INCOMPLETE'
  | 'APPROVED_LEAVE'
  | 'PENDING_LEAVE'
  | 'PENDING_ADJUSTMENT'
  | 'UNEXCUSED_ABSENCE'
  | 'LATE_AND_EARLY'
  | 'LATE'
  | 'EARLY'
  | 'COMPLETE';

export type AttendanceTimesheetDay = {
  workDate: string;
  employee: {
    id: string;
    code: string;
    name: string;
    branchId: string | null;
    branchCode: string | null;
    branchName: string | null;
  };
  policy: {
    id: string;
    code: string;
    version: number;
    name: string;
    timeMode: WorkPolicy['time_mode'];
    attendanceBasis: WorkPolicy['attendance_basis'];
    timezone: string;
    breakMinutes: number;
    lateGraceMinutes: number;
    earlyLeaveGraceMinutes: number;
  } | null;
  schedule: {
    id: string;
    kind: 'WORK' | 'OFF';
    source: 'POLICY' | 'OVERRIDE';
  } | null;
  expectedStartAt: string | null;
  expectedEndAt: string | null;
  requiredStartAt: string | null;
  requiredEndAt: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  actualMinutes: number;
  countedMinutes: number;
  leaveCreditedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  missingCheckIn: boolean;
  missingCheckOut: boolean;
  scheduledWorkDay: boolean;
  validWork: boolean;
  status: AttendanceDayStatus;
  attendanceStatus: AttendanceDayStatus;
  configurationIssue: 'MISSING_POLICY' | 'MISSING_SCHEDULE' | null;
  unexcusedAbsenceFraction: number;
  violationEvaluation: AttendanceViolationEvaluation;
  leave: {
    requests: LeaveRequest[];
    approvedFraction: number;
    pendingFraction: number;
    countedAsWorkdayFraction: number;
    paidFraction: number;
    approvedSegments: LeaveDayPart[];
    pendingSegments: LeaveDayPart[];
    countedSegments: LeaveDayPart[];
    approvedLabels: string[];
    pendingLabels: string[];
  };
  attendanceSources: AttendanceEvent['source'][];
  scheduleSource: 'POLICY' | 'OVERRIDE' | null;
  adjustment: AttendanceAdjustmentRequest | null;
  periodLock: AttendancePeriodLock | null;
  events: AttendanceEvent[];
};

export type AttendanceTimesheetMonth = {
  employee: AttendanceTimesheetDay['employee'];
  period: { from: string; to: string };
  workDays: number;
  completedDays: number;
  scheduledDaysOff: number;
  approvedLeaveDays: number;
  pendingLeaveDays: number;
  unexcusedAbsenceDays: number;
  incompleteDays: number;
  configurationIssueDays: number;
  violationDays: number;
  lateViolationDays: number;
  earlyLeaveViolationDays: number;
  missingAttendanceViolationDays: number;
  unexcusedAbsenceViolationDays: number;
  missingDays: number;
  actualMinutes: number;
  countedMinutes: number;
  leaveCreditedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  adjustedDays: number;
  pendingAdjustmentDays: number;
  lockedDays: number;
  attendanceSources: AttendanceEvent['source'][];
  scheduleSources: Array<'POLICY' | 'OVERRIDE'>;
  days: AttendanceTimesheetDay[];
};

export type AttendanceTimesheetResponse = {
  view: 'daily' | 'employee' | 'monthly';
  period: { from: string; to: string; timezone: string };
  scope: {
    companyScope: boolean;
    selfOnly: boolean;
    branches: AttendanceBranch[];
  };
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  capabilities: {
    canSubmitOwn: boolean;
    canManage: boolean;
    canLock: boolean;
  };
  rows: AttendanceTimesheetDay[] | AttendanceTimesheetMonth[];
};



export type LeaveDayPart = 'FULL_DAY' | 'FIRST_HALF' | 'SECOND_HALF';
export type LeaveRequestStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type LeaveType = {
  id: string;
  installation_id: string;
  code: string;
  name: string;
  is_active: boolean;
  is_paid: boolean;
  counts_as_workday: boolean;
  requires_approval: boolean;
  allows_full_day: boolean;
  allows_half_day: boolean;
  requires_attachment: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type LeaveRequest = {
  id: string;
  installation_id: string;
  employee_id: string;
  leave_type_id: string;
  leave_type_code_snapshot: string;
  leave_type_name_snapshot: string;
  leave_is_paid_snapshot: boolean;
  leave_counts_as_workday_snapshot: boolean;
  leave_requires_approval_snapshot: boolean;
  date_from: string;
  date_to: string;
  day_part: LeaveDayPart;
  reason: string;
  attachment_reference: string | null;
  status: LeaveRequestStatus;
  requested_by_actor_id: string;
  requested_by_employee_id: string;
  reviewed_by_actor_id: string | null;
  review_reason: string | null;
  reviewed_at: string | null;
  cancelled_by_actor_id: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  version: number;
  request_id: string;
  created_at: string;
  updated_at: string;
  employee_code?: string;
  employee_name?: string;
  employee_branch_id?: string | null;
  branch_code?: string | null;
  branch_name?: string | null;
};

export type LeaveTypeListResponse = {
  leaveTypes: LeaveType[];
  capabilities: { canManage: boolean };
};

export type LeaveRequestListResponse = {
  selectedEmployee: {
    id: string;
    code: string;
    name: string;
    branchId: string | null;
  } | null;
  branches: AttendanceBranch[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  requests: LeaveRequest[];
  capabilities: {
    selfOnly: boolean;
    canSubmitOwn: boolean;
    canApprove: boolean;
    canManageTypes: boolean;
  };
};


export type OvertimeStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ACTUAL_RECORDED' | 'CONFIRMED';

export type OvertimeRequest = {
  id: string;
  installation_id: string;
  employee_id: string;
  work_date: string;
  requested_minutes: number;
  reason: string;
  policy_id_snapshot: string;
  policy_code_snapshot: string;
  policy_version_snapshot: number;
  overtime_requires_approval_snapshot: boolean;
  status: OvertimeStatus;
  requested_by_actor_id: string;
  requested_by_employee_id: string;
  reviewed_by_actor_id: string | null;
  review_reason: string | null;
  reviewed_at: string | null;
  actual_minutes: number | null;
  actual_note: string | null;
  actual_recorded_by_actor_id: string | null;
  actual_recorded_at: string | null;
  confirmed_minutes: number | null;
  confirm_note: string | null;
  confirmed_by_actor_id: string | null;
  confirmed_at: string | null;
  version: number;
  request_id: string;
  created_at: string;
  updated_at: string;
  employee_code?: string;
  employee_name?: string;
  employee_branch_id?: string | null;
  branch_code?: string | null;
  branch_name?: string | null;
};

export type OvertimeListResponse = {
  requests: OvertimeRequest[];
  branches: AttendanceBranch[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  capabilities: {
    selfOnly: boolean;
    canSubmitOwn: boolean;
    canApprove: boolean;
    canConfirm: boolean;
  };
};

export type AttendancePeriodStatus = 'AGGREGATING' | 'NEEDS_ACTION' | 'RECONCILED' | 'CLOSED';

export type AttendancePeriodIssueSummary = {
  blockers?: {
    configurationIssueDays?: number;
    pendingAdjustmentDays?: number;
    pendingLeaveDays?: number;
    outstandingOvertimeRequests?: number;
  };
  warnings?: {
    incompleteDays?: number;
    unexcusedAbsenceDays?: number;
    violationDays?: number;
  };
  postCloseCorrection?: boolean;
};

export type AttendancePeriod = {
  id: string;
  installation_id: string;
  branch_id: string | null;
  scope_key: string;
  period_start: string;
  period_end: string;
  status: AttendancePeriodStatus;
  issue_summary: AttendancePeriodIssueSummary;
  source_fingerprint: string | null;
  reconciled_fingerprint: string | null;
  reconciled_by_actor_id: string | null;
  reconciled_at: string | null;
  reconciliation_note: string | null;
  closed_by_actor_id: string | null;
  closed_at: string | null;
  lock_id: string | null;
  revision: number;
  request_id: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  branch_code?: string | null;
  branch_name?: string | null;
};

export type AttendancePeriodListResponse = {
  periods: AttendancePeriod[];
  branches: AttendanceBranch[];
  capabilities: {
    canReconcile: boolean;
    canClose: boolean;
  };
};

export type AttendancePeriodMutationResponse = {
  period: AttendancePeriod;
  issues: AttendancePeriodIssueSummary;
  snapshot: {
    id: string;
    revision: number;
    source_fingerprint: string;
    snapshot: unknown;
  } | null;
};

export type AttendancePayrollInput = {
  period: AttendancePeriod;
  revision: number;
  sourceFingerprint: string;
  payrollInput: {
    contractVersion: number;
    period: { from: string; to: string; branchId: string | null };
    issueSummary: AttendancePeriodIssueSummary;
    status: 'CLOSED';
    revision: number;
    employees: Array<{
      employeeId: string;
      employeeCode: string;
      employeeName: string;
      branchId: string | null;
      branchCode: string | null;
      branchName: string | null;
      workDays: number;
      completedDays: number;
      countedMinutes: number;
      leaveCreditedMinutes: number;
      approvedLeaveDays: number;
      paidLeaveDays: number;
      unpaidLeaveDays: number;
      unexcusedAbsenceDays: number;
      incompleteDays: number;
      configurationIssueDays: number;
      violationDays: number;
      pendingLeaveDays: number;
      pendingAdjustmentDays: number;
      confirmedOvertimeMinutes: number;
    }>;
  };
};
