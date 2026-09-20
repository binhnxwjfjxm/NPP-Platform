-- Issue #1110 Lô 5: attendance adjustment workflow and period locking.
-- Additive source migration only. Production execution remains a separate gated operation.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  (
    'core.attendance.self-adjust-request',
    'Nhân sự',
    'Gửi yêu cầu điều chỉnh công',
    'Cho phép nhân viên gửi và theo dõi yêu cầu điều chỉnh công của chính mình; không tự sửa dữ liệu đã duyệt.',
    true,
    now()
  ),
  (
    'core.attendance.lock',
    'Nhân sự',
    'Khóa kỳ công',
    'Cho phép khóa kỳ công và thực hiện ngoại lệ điều chỉnh sau khóa khi đồng thời có quyền điều chỉnh công.',
    true,
    now()
  )
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.attendance_adjustment_requests (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  requested_check_in_at timestamptz NULL,
  requested_check_out_at timestamptz NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  request_source text NOT NULL CHECK (request_source IN ('SELF_REQUEST', 'DIRECT')),
  status text NOT NULL CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED')),
  requested_by_actor_id text NOT NULL CHECK (char_length(requested_by_actor_id) BETWEEN 1 AND 128),
  requested_by_employee_id uuid NULL,
  reviewed_by_actor_id text NULL CHECK (reviewed_by_actor_id IS NULL OR char_length(reviewed_by_actor_id) BETWEEN 1 AND 128),
  review_reason text NULL CHECK (review_reason IS NULL OR char_length(review_reason) <= 1000),
  reviewed_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_adjustment_requests_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT attendance_adjustment_requests_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT attendance_adjustment_requests_requested_employee_fk
    FOREIGN KEY (installation_id, requested_by_employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT attendance_adjustment_requests_value_check CHECK (
    requested_check_in_at IS NOT NULL OR requested_check_out_at IS NOT NULL
  ),
  CONSTRAINT attendance_adjustment_requests_time_order_check CHECK (
    requested_check_in_at IS NULL
    OR requested_check_out_at IS NULL
    OR requested_check_out_at >= requested_check_in_at
  ),
  CONSTRAINT attendance_adjustment_requests_review_state_check CHECK (
    (status = 'SUBMITTED' AND reviewed_by_actor_id IS NULL AND reviewed_at IS NULL)
    OR
    (status IN ('APPROVED', 'REJECTED') AND reviewed_by_actor_id IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT attendance_adjustment_requests_direct_state_check CHECK (
    request_source <> 'DIRECT' OR status = 'APPROVED'
  )
);

CREATE INDEX IF NOT EXISTS attendance_adjustment_requests_employee_date_idx
  ON shared.attendance_adjustment_requests (installation_id, employee_id, work_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS attendance_adjustment_requests_status_date_idx
  ON shared.attendance_adjustment_requests (installation_id, status, work_date DESC, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_adjustment_requests_one_pending_day_idx
  ON shared.attendance_adjustment_requests (installation_id, employee_id, work_date)
  WHERE status = 'SUBMITTED';

CREATE TABLE IF NOT EXISTS shared.attendance_period_locks (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  branch_id uuid NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  locked_by_actor_id text NOT NULL CHECK (char_length(locked_by_actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  locked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_period_locks_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT attendance_period_locks_range_check CHECK (period_end >= period_start),
  CONSTRAINT attendance_period_locks_branch_fk
    FOREIGN KEY (installation_id, branch_id)
    REFERENCES shared.branches (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS attendance_period_locks_period_idx
  ON shared.attendance_period_locks (installation_id, period_start, period_end, branch_id);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_period_locks_company_exact_idx
  ON shared.attendance_period_locks (installation_id, period_start, period_end)
  WHERE branch_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_period_locks_branch_exact_idx
  ON shared.attendance_period_locks (installation_id, branch_id, period_start, period_end)
  WHERE branch_id IS NOT NULL;
