-- Issue #1110 Lô 6: leave/absence canonical domain.
-- Source migration only. Production execution remains a separate gated operation.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.leave.self.read', 'Nhân sự', 'Xem đơn nghỉ của bản thân', 'Cho phép nhân viên xem trạng thái và lịch sử đơn nghỉ của chính mình.', true, now()),
  ('core.leave.self.request', 'Nhân sự', 'Gửi đơn nghỉ', 'Cho phép nhân viên gửi và tự hủy đơn nghỉ đang chờ duyệt của chính mình.', true, now()),
  ('core.leave.read', 'Nhân sự', 'Xem đơn nghỉ', 'Cho phép đọc đơn nghỉ của nhân viên trong phạm vi được cấp.', true, now()),
  ('core.leave.approve', 'Nhân sự', 'Duyệt đơn nghỉ', 'Cho phép duyệt, từ chối hoặc hủy đơn nghỉ trong phạm vi được cấp; mọi thay đổi có audit.', true, now()),
  ('core.leave-type.manage', 'Nhân sự', 'Quản lý chế độ nghỉ', 'Cho phép cấu hình chế độ nghỉ dùng cho Công Ty.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.leave_types (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  is_active boolean NOT NULL DEFAULT true,
  is_paid boolean NOT NULL DEFAULT false,
  counts_as_workday boolean NOT NULL DEFAULT false,
  requires_approval boolean NOT NULL DEFAULT true,
  allows_full_day boolean NOT NULL DEFAULT true,
  allows_half_day boolean NOT NULL DEFAULT false,
  requires_attachment boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT leave_types_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT leave_types_code_unique UNIQUE (installation_id, code),
  CONSTRAINT leave_types_day_mode_check CHECK (allows_full_day OR allows_half_day)
);

CREATE INDEX IF NOT EXISTS leave_types_active_name_idx
  ON shared.leave_types (installation_id, is_active DESC, name, code);

CREATE TABLE IF NOT EXISTS shared.leave_requests (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  leave_type_code_snapshot text NOT NULL CHECK (char_length(leave_type_code_snapshot) BETWEEN 1 AND 32),
  leave_type_name_snapshot text NOT NULL CHECK (char_length(btrim(leave_type_name_snapshot)) BETWEEN 1 AND 100),
  leave_is_paid_snapshot boolean NOT NULL,
  leave_counts_as_workday_snapshot boolean NOT NULL,
  leave_requires_approval_snapshot boolean NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  day_part text NOT NULL CHECK (day_part IN ('FULL_DAY', 'FIRST_HALF', 'SECOND_HALF')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  attachment_reference text NULL CHECK (attachment_reference IS NULL OR char_length(attachment_reference) <= 1000),
  status text NOT NULL CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by_actor_id text NOT NULL CHECK (char_length(requested_by_actor_id) BETWEEN 1 AND 128),
  requested_by_employee_id uuid NOT NULL,
  reviewed_by_actor_id text NULL CHECK (reviewed_by_actor_id IS NULL OR char_length(reviewed_by_actor_id) BETWEEN 1 AND 128),
  review_reason text NULL CHECK (review_reason IS NULL OR char_length(review_reason) <= 1000),
  reviewed_at timestamptz NULL,
  cancelled_by_actor_id text NULL CHECK (cancelled_by_actor_id IS NULL OR char_length(cancelled_by_actor_id) BETWEEN 1 AND 128),
  cancel_reason text NULL CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 1 AND 1000),
  cancelled_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT leave_requests_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT leave_requests_requested_employee_fk
    FOREIGN KEY (installation_id, requested_by_employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT leave_requests_leave_type_fk
    FOREIGN KEY (installation_id, leave_type_id)
    REFERENCES shared.leave_types (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT leave_requests_period_check CHECK (date_to >= date_from),
  CONSTRAINT leave_requests_half_day_check CHECK (day_part = 'FULL_DAY' OR date_from = date_to),
  CONSTRAINT leave_requests_state_check CHECK (
    (status = 'SUBMITTED'
      AND reviewed_by_actor_id IS NULL AND reviewed_at IS NULL
      AND cancelled_by_actor_id IS NULL AND cancelled_at IS NULL)
    OR
    (status IN ('APPROVED', 'REJECTED')
      AND reviewed_by_actor_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND cancelled_by_actor_id IS NULL AND cancelled_at IS NULL)
    OR
    (status = 'CANCELLED'
      AND cancelled_by_actor_id IS NOT NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS leave_requests_employee_period_idx
  ON shared.leave_requests (installation_id, employee_id, date_from DESC, date_to DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS leave_requests_status_period_idx
  ON shared.leave_requests (installation_id, status, date_from DESC, date_to DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS leave_requests_type_period_idx
  ON shared.leave_requests (installation_id, leave_type_id, date_from DESC, date_to DESC);

COMMENT ON TABLE shared.leave_types IS 'Canonical leave/absence configuration for the Công Ty workforce domain.';
COMMENT ON TABLE shared.leave_requests IS 'Canonical leave requests. Attendance events remain immutable and are not rewritten by leave approval.';
