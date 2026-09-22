-- Issue #1140 Lô 5: overtime lifecycle and attendance closeout.
-- Additive only. Technical period locks remain the hard mutation guard; attendance_periods adds the business lifecycle.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.overtime.self-request', 'Nhân sự', 'Đăng ký tăng ca', 'Cho phép nhân viên đăng ký và xem tăng ca của chính mình theo chính sách làm việc hiệu lực.', true, now()),
  ('core.overtime.read', 'Nhân sự', 'Xem tăng ca', 'Cho phép đọc yêu cầu tăng ca trong phạm vi nhân sự được cấp.', true, now()),
  ('core.overtime.approve', 'Nhân sự', 'Duyệt và ghi nhận tăng ca', 'Cho phép duyệt, từ chối và ghi nhận thời gian tăng ca thực tế trong phạm vi được cấp.', true, now()),
  ('core.overtime.confirm', 'Nhân sự', 'Xác nhận giờ tăng ca được tính', 'Cho phép xác nhận số phút tăng ca đủ điều kiện chuyển sang đầu vào tính lương.', true, now()),
  ('core.attendance.reconcile', 'Nhân sự', 'Đối soát kỳ công', 'Cho phép tổng hợp, đối soát và chuẩn bị kỳ công trước khi chốt; chốt kỳ vẫn yêu cầu quyền khóa kỳ công.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.overtime_requests (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  requested_minutes integer NOT NULL CHECK (requested_minutes BETWEEN 1 AND 1440),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  policy_id_snapshot uuid NOT NULL,
  policy_code_snapshot text NOT NULL CHECK (char_length(policy_code_snapshot) BETWEEN 1 AND 64),
  policy_version_snapshot integer NOT NULL CHECK (policy_version_snapshot >= 1),
  overtime_requires_approval_snapshot boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'ACTUAL_RECORDED', 'CONFIRMED')),
  requested_by_actor_id text NOT NULL CHECK (char_length(requested_by_actor_id) BETWEEN 1 AND 128),
  requested_by_employee_id uuid NOT NULL,
  reviewed_by_actor_id text NULL CHECK (reviewed_by_actor_id IS NULL OR char_length(reviewed_by_actor_id) BETWEEN 1 AND 128),
  review_reason text NULL CHECK (review_reason IS NULL OR char_length(review_reason) <= 1000),
  reviewed_at timestamptz NULL,
  actual_minutes integer NULL CHECK (actual_minutes IS NULL OR actual_minutes BETWEEN 1 AND 1440),
  actual_note text NULL CHECK (actual_note IS NULL OR char_length(actual_note) <= 1000),
  actual_recorded_by_actor_id text NULL CHECK (actual_recorded_by_actor_id IS NULL OR char_length(actual_recorded_by_actor_id) BETWEEN 1 AND 128),
  actual_recorded_at timestamptz NULL,
  confirmed_minutes integer NULL CHECK (confirmed_minutes IS NULL OR confirmed_minutes BETWEEN 0 AND 1440),
  confirm_note text NULL CHECK (confirm_note IS NULL OR char_length(confirm_note) <= 1000),
  confirmed_by_actor_id text NULL CHECK (confirmed_by_actor_id IS NULL OR char_length(confirmed_by_actor_id) BETWEEN 1 AND 128),
  confirmed_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT overtime_requests_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT overtime_requests_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT overtime_requests_requested_employee_fk
    FOREIGN KEY (installation_id, requested_by_employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT overtime_requests_state_check CHECK (
    (status IN ('SUBMITTED', 'APPROVED', 'REJECTED') AND actual_minutes IS NULL AND confirmed_minutes IS NULL)
    OR (status = 'ACTUAL_RECORDED' AND actual_minutes IS NOT NULL AND confirmed_minutes IS NULL)
    OR (status = 'CONFIRMED' AND actual_minutes IS NOT NULL AND confirmed_minutes IS NOT NULL AND confirmed_minutes <= actual_minutes)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS overtime_requests_employee_day_active_unique
  ON shared.overtime_requests (installation_id, employee_id, work_date)
  WHERE status <> 'REJECTED';

CREATE INDEX IF NOT EXISTS overtime_requests_period_idx
  ON shared.overtime_requests (installation_id, work_date, status, employee_id);

CREATE TABLE IF NOT EXISTS shared.attendance_periods (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  branch_id uuid NULL,
  scope_key text NOT NULL CHECK (
    (branch_id IS NULL AND scope_key = 'COMPANY')
    OR (branch_id IS NOT NULL AND scope_key = branch_id::text)
  ),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('AGGREGATING', 'NEEDS_ACTION', 'RECONCILED', 'CLOSED')),
  issue_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(issue_summary) = 'object'),
  source_fingerprint text NULL CHECK (source_fingerprint IS NULL OR source_fingerprint ~ '^[0-9a-f]{64}$'),
  reconciled_fingerprint text NULL CHECK (reconciled_fingerprint IS NULL OR reconciled_fingerprint ~ '^[0-9a-f]{64}$'),
  reconciled_by_actor_id text NULL CHECK (reconciled_by_actor_id IS NULL OR char_length(reconciled_by_actor_id) BETWEEN 1 AND 128),
  reconciled_at timestamptz NULL,
  reconciliation_note text NULL CHECK (reconciliation_note IS NULL OR char_length(reconciliation_note) <= 1000),
  closed_by_actor_id text NULL CHECK (closed_by_actor_id IS NULL OR char_length(closed_by_actor_id) BETWEEN 1 AND 128),
  closed_at timestamptz NULL,
  lock_id uuid NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT attendance_periods_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT attendance_periods_business_unique UNIQUE (installation_id, scope_key, period_start, period_end),
  CONSTRAINT attendance_periods_range_check CHECK (period_end >= period_start),
  CONSTRAINT attendance_periods_branch_fk
    FOREIGN KEY (installation_id, branch_id)
    REFERENCES shared.branches (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT attendance_periods_lock_fk
    FOREIGN KEY (installation_id, lock_id)
    REFERENCES shared.attendance_period_locks (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS attendance_periods_period_idx
  ON shared.attendance_periods (installation_id, period_start, period_end, branch_id, status);

CREATE TABLE IF NOT EXISTS shared.attendance_period_snapshots (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  period_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT attendance_period_snapshots_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT attendance_period_snapshots_revision_unique UNIQUE (installation_id, period_id, revision),
  CONSTRAINT attendance_period_snapshots_period_fk
    FOREIGN KEY (installation_id, period_id)
    REFERENCES shared.attendance_periods (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION shared.reject_attendance_period_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'attendance_period_snapshots_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS attendance_period_snapshots_append_only ON shared.attendance_period_snapshots;
CREATE TRIGGER attendance_period_snapshots_append_only
BEFORE UPDATE OR DELETE ON shared.attendance_period_snapshots
FOR EACH ROW EXECUTE FUNCTION shared.reject_attendance_period_snapshot_mutation();

COMMENT ON TABLE shared.overtime_requests IS
  'Canonical overtime lifecycle. Attendance evidence does not imply payable overtime; only CONFIRMED minutes flow to payroll.';
COMMENT ON TABLE shared.attendance_periods IS
  'Business attendance lifecycle. Technical attendance_period_locks remains the hard mutation guard.';
COMMENT ON TABLE shared.attendance_period_snapshots IS
  'Immutable closed-period output consumed by payroll and historical reconciliation.';
