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
  policy_timezone: string;
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
  event_type: 'CHECK_IN' | 'CHECK_OUT';
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
  status: 'NOT_STARTED' | 'WORKING' | 'COMPLETE';
  nextAction: 'CHECK_IN' | 'CHECK_OUT' | null;
  tooSoon: boolean;
  employee: {
    id: string;
    code: string;
    full_name: string;
    branch_id: string | null;
    is_active: boolean;
  };
  policy: {
    id: string;
    code: string;
    version: number;
    name: string;
    timeMode: WorkPolicy['time_mode'];
    attendanceMethod: WorkPolicy['attendance_method'];
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
  };
};
