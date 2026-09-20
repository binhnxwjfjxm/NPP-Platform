-- Issue #1110 Lô 1: Nhân sự & Chấm công foundation.
-- Additive source migration only. Production execution remains a separate gated operation.
-- Canonical employee identity stays in shared.employees + shared.users.employee_id.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.work-policy.read', 'Nhân sự', 'Xem chính sách làm việc', 'Cho phép đọc chính sách làm việc và phiên bản hiệu lực trong phạm vi được cấp.', true, now()),
  ('core.work-policy.manage', 'Nhân sự', 'Quản lý chính sách làm việc', 'Cho phép tạo phiên bản chính sách làm việc và gán chính sách cho nhân viên trong phạm vi được cấp.', true, now()),
  ('core.work-schedule.read', 'Nhân sự', 'Xem ca và lịch làm việc', 'Cho phép đọc ca và lịch làm việc trong phạm vi nhân sự được cấp.', true, now()),
  ('core.work-schedule.manage', 'Nhân sự', 'Quản lý ca và lịch làm việc', 'Cho phép tạo hoặc điều chỉnh lịch làm việc theo ngày trong phạm vi nhân sự được cấp.', true, now()),
  ('core.attendance.self.read', 'Nhân sự', 'Xem công của bản thân', 'Cho phép nhân viên xem trạng thái và lịch sử chấm công của chính mình.', true, now()),
  ('core.attendance.self.record', 'Nhân sự', 'Chấm công cho bản thân', 'Cho phép nhân viên ghi nhận sự kiện chấm công của chính mình qua phương thức được chính sách cho phép.', true, now()),
  ('core.attendance.read', 'Nhân sự', 'Xem bảng công', 'Cho phép đọc bảng công của nhân viên trong phạm vi được cấp.', true, now()),
  ('core.attendance.adjust', 'Nhân sự', 'Điều chỉnh công', 'Cho phép tạo hoặc duyệt điều chỉnh công trong phạm vi được cấp; mọi thay đổi phải có lý do và audit.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.work_policies (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64 AND code ~ '^[A-Z0-9_-]{1,64}$'),
  version integer NOT NULL CHECK (version >= 1),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 256),
  work_nature text NULL CHECK (work_nature IS NULL OR char_length(work_nature) <= 128),
  time_mode text NOT NULL CHECK (time_mode IN ('FIXED', 'SHIFT', 'FLEXIBLE', 'NO_ATTENDANCE')),
  fixed_start_time time NULL,
  fixed_end_time time NULL,
  working_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 720),
  late_grace_minutes integer NOT NULL DEFAULT 0 CHECK (late_grace_minutes BETWEEN 0 AND 240),
  early_leave_grace_minutes integer NOT NULL DEFAULT 0 CHECK (early_leave_grace_minutes BETWEEN 0 AND 240),
  overtime_enabled boolean NOT NULL DEFAULT false,
  overtime_requires_approval boolean NOT NULL DEFAULT true,
  attendance_method text NOT NULL CHECK (attendance_method IN ('QR', 'MANUAL', 'BOTH', 'NONE')),
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  rounding_minutes integer NOT NULL DEFAULT 0 CHECK (rounding_minutes BETWEEN 0 AND 60),
  minimum_full_day_minutes integer NULL CHECK (minimum_full_day_minutes IS NULL OR minimum_full_day_minutes BETWEEN 1 AND 1440),
  minimum_half_day_minutes integer NULL CHECK (minimum_half_day_minutes IS NULL OR minimum_half_day_minutes BETWEEN 1 AND 1440),
  effective_from date NOT NULL,
  effective_to date NULL,
  supersedes_policy_id uuid NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT work_policies_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT work_policies_code_version_unique UNIQUE (installation_id, code, version),
  CONSTRAINT work_policies_effective_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT work_policies_working_days_check CHECK (
    cardinality(working_days) BETWEEN 1 AND 7
    AND working_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
  ),
  CONSTRAINT work_policies_fixed_time_check CHECK (
    time_mode <> 'FIXED' OR (fixed_start_time IS NOT NULL AND fixed_end_time IS NOT NULL)
  ),
  CONSTRAINT work_policies_no_attendance_check CHECK (
    time_mode <> 'NO_ATTENDANCE' OR attendance_method = 'NONE'
  ),
  CONSTRAINT work_policies_supersedes_fk
    FOREIGN KEY (installation_id, supersedes_policy_id)
    REFERENCES shared.work_policies (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS work_policies_installation_code_idx
  ON shared.work_policies (installation_id, code, effective_from DESC, version DESC);

CREATE INDEX IF NOT EXISTS work_policies_installation_active_idx
  ON shared.work_policies (installation_id, is_active, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS shared.employee_work_policy_assignments (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  work_policy_id uuid NOT NULL,
  effective_from date NOT NULL,
  effective_to date NULL,
  reason text NULL CHECK (reason IS NULL OR char_length(reason) <= 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT employee_work_policy_assignments_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT employee_work_policy_assignments_start_unique UNIQUE (installation_id, employee_id, effective_from),
  CONSTRAINT employee_work_policy_assignments_effective_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT employee_work_policy_assignments_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT employee_work_policy_assignments_policy_fk
    FOREIGN KEY (installation_id, work_policy_id)
    REFERENCES shared.work_policies (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS employee_work_policy_assignments_lookup_idx
  ON shared.employee_work_policy_assignments (installation_id, employee_id, effective_from DESC, effective_to);

CREATE TABLE IF NOT EXISTS shared.work_schedules (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  work_policy_id uuid NULL,
  work_date date NOT NULL,
  schedule_kind text NOT NULL CHECK (schedule_kind IN ('WORK', 'OFF')),
  scheduled_start_at timestamptz NULL,
  scheduled_end_at timestamptz NULL,
  source text NOT NULL CHECK (source IN ('POLICY', 'OVERRIDE')),
  override_reason text NULL CHECK (override_reason IS NULL OR char_length(override_reason) <= 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT work_schedules_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT work_schedules_employee_day_unique UNIQUE (installation_id, employee_id, work_date),
  CONSTRAINT work_schedules_time_check CHECK (
    (schedule_kind = 'OFF' AND scheduled_start_at IS NULL AND scheduled_end_at IS NULL)
    OR
    (schedule_kind = 'WORK' AND scheduled_start_at IS NOT NULL AND scheduled_end_at IS NOT NULL AND scheduled_end_at > scheduled_start_at)
  ),
  CONSTRAINT work_schedules_override_reason_check CHECK (
    source <> 'OVERRIDE' OR (override_reason IS NOT NULL AND char_length(btrim(override_reason)) > 0)
  ),
  CONSTRAINT work_schedules_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT work_schedules_policy_fk
    FOREIGN KEY (installation_id, work_policy_id)
    REFERENCES shared.work_policies (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS work_schedules_employee_date_idx
  ON shared.work_schedules (installation_id, employee_id, work_date DESC);

CREATE INDEX IF NOT EXISTS work_schedules_date_idx
  ON shared.work_schedules (installation_id, work_date, employee_id);

CREATE TABLE IF NOT EXISTS shared.attendance_events (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  schedule_id uuid NULL,
  work_policy_id uuid NULL,
  event_type text NOT NULL CHECK (event_type IN ('CHECK_IN', 'CHECK_OUT')),
  occurred_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('QR', 'MANUAL', 'ADJUSTMENT', 'SYSTEM')),
  validation_status text NOT NULL DEFAULT 'PENDING' CHECK (validation_status IN ('VALID', 'PENDING', 'INVALID')),
  source_reference text NULL CHECK (source_reference IS NULL OR char_length(source_reference) BETWEEN 1 AND 256),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 1024),
  recorded_by text NOT NULL CHECK (char_length(recorded_by) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_events_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT attendance_events_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT attendance_events_schedule_fk
    FOREIGN KEY (installation_id, schedule_id)
    REFERENCES shared.work_schedules (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT attendance_events_policy_fk
    FOREIGN KEY (installation_id, work_policy_id)
    REFERENCES shared.work_policies (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS attendance_events_employee_time_idx
  ON shared.attendance_events (installation_id, employee_id, occurred_at DESC, id);

CREATE INDEX IF NOT EXISTS attendance_events_schedule_idx
  ON shared.attendance_events (installation_id, schedule_id, occurred_at, id)
  WHERE schedule_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_events_source_reference_unique
  ON shared.attendance_events (installation_id, source, source_reference)
  WHERE source_reference IS NOT NULL;
